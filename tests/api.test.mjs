import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApi } from '../dist/api/http.js';
import { attachWebSockets } from '../dist/api/websocket.js';
import { NativeBridges } from '../dist/bridge/server.js';
import { Events } from '../dist/events.js';
import { Sessions } from '../dist/sessions.js';
import { SessionDiscovery } from '../dist/storage/discovery.js';
import { fixture } from './helpers.mjs';

test('relay REST, host/origin checks, WebSocket events and removed runtime endpoints', async (t) => {
  const { config, defer } = fixture(t);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const sessions = new Sessions(new SessionDiscovery([], config.projects), bridges, events);
  const server = createApi(config, sessions, bridges);
  const closeSockets = attachWebSockets(server, config, events, bridges);
  defer(async () => {
    closeSockets();
    server.close();
    server.closeAllConnections();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const headers = { 'Content-Type': 'application/json', Origin: config.origins[0] };
  const projectResponse = await fetch(`${base}/projects`, { headers });
  assert.deepEqual((await projectResponse.json()).projects, config.projects);
  assert.equal(config.projects[0].name, 'test');
  assert.equal((await fetch(`${base}/sessions`)).status, 200);
  assert.equal((await fetch(`${base}/sessions`, { headers })).status, 200);
  const lanOrigin = 'http://192.168.1.20:3141';
  const tailscaleOrigin = 'http://pim.example.ts.net:3141';
  config.origins.push(lanOrigin, tailscaleOrigin);
  for (const origin of [lanOrigin, tailscaleOrigin]) {
    const request = get(`${base}/sessions`, {
      headers: { Host: new URL(origin).host, Origin: origin },
    });
    const [response] = await once(request, 'response');
    assert.equal(response.statusCode, 200);
    response.resume();
  }
  const invalidHost = get(`${base}/sessions`, { headers: { Host: 'evil.example' } });
  const [rejected] = await once(invalidHost, 'response');
  assert.equal(rejected.statusCode, 403);
  rejected.resume();
  assert.equal((await fetch(`${base}/sessions`, { method: 'OPTIONS' })).status, 403);
  assert.equal(
    (await fetch(`${base}/sessions`, { headers: { ...headers, Origin: 'https://evil.example' } }))
      .status,
    403,
  );
  const preflight = await fetch(`${base}/sessions`, {
    method: 'OPTIONS',
    headers: { Origin: config.origins[0] },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/events`, { headers });
  const connected = once(socket, 'message');
  await once(socket, 'open');
  const handshake = JSON.parse(String((await connected)[0]));
  assert.equal(handshake.epoch, events.epoch);
  assert.equal(handshake.cursor, 0);
  const id = '11111111-1111-1111-1111-111111111111';
  const event = once(socket, 'message');
  events.publish(id, 1, 'connection', { connection: 'connected' });
  assert.equal(JSON.parse(String((await event)[0])).sessionId, id);
  const largeEvent = once(socket, 'message');
  const image = { type: 'image', mimeType: 'image/png', data: 'A'.repeat(3 * 1024 * 1024) };
  events.publish(id, 1, 'pi-event', {
    type: 'message_end',
    message: { role: 'user', content: [image] },
  });
  assert.deepEqual(JSON.parse(String((await largeEvent)[0])).data.message.content, [image]);
  assert.equal((await fetch(`${base}/sessions`, { method: 'POST', headers })).status, 400);
  for (const path of [`/sessions/${id}/start`, `/sessions/${id}/stop`]) {
    assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers })).status, 404);
  }
  assert.equal((await fetch(`${base}/sessions/${id}/snapshot`)).status, 404);
  socket.close();
  await once(socket, 'close');
  assert.deepEqual(sessions.list(), []);
});

test('launch API correlates create/resume requests and rejects replay', async (t) => {
  const { config, defer } = fixture(t);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const sessions = new Sessions(new SessionDiscovery([], config.projects), bridges, events);
  const id = '11111111-1111-1111-1111-111111111111';
  const calls = [];
  const launches = {
    start: async (...args) => {
      calls.push(args);
      return { id, projectId: 'test' };
    },
  };
  const server = createApi(config, sessions, bridges, 'frontend/dist', launches);
  defer(() => {
    bridges.close();
    server.close();
    server.closeAllConnections();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const headers = { 'Content-Type': 'application/json', Origin: config.origins[0] };
  const create = () =>
    fetch(`${base}/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: 'create-1', projectId: 'test' }),
    });
  const response = await create();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    requestId: 'create-1',
    outcome: 'acknowledged',
    data: { session: { id, projectId: 'test' } },
  });
  assert.deepEqual(calls, [['test', undefined, false]]);
  assert.equal((await create()).status, 409);
  sessions.get = () => ({ id, projectId: 'test' });
  const resumed = await fetch(`${base}/sessions/${id}/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'resume-1', confirmedOffline: true }),
  });
  assert.equal(resumed.status, 200);
  assert.deepEqual(calls[1], ['test', id, true]);
});

test('production frontend serves deep links and assets without bypassing origin checks', async (t) => {
  const { root, config, defer } = fixture(t);
  const directory = join(root, 'frontend');
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Pim test</title>');
  writeFileSync(join(directory, 'assets', 'test.js'), 'console.log("test");');
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const sessions = new Sessions(new SessionDiscovery([], config.projects), bridges, events);
  const server = createApi(config, sessions, bridges, directory);
  defer(async () => {
    server.close();
    server.closeAllConnections();
    bridges.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const page = await fetch(`${base}/app/projects/test/sessions/anything`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('Content-Security-Policy'), /img-src 'self' data:/);
  assert.match(await page.text(), /Pim test/);
  const asset = await fetch(`${base}/assets/test.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('Content-Type'), /javascript/);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/assets/%2e%2e%2fsrc%2fmain.ts`)).status, 404);
  assert.equal(
    (await fetch(`${base}/app/projects/test`, { headers: { Origin: 'https://evil.example' } }))
      .status,
    403,
  );
});
