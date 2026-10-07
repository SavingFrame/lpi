import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApi } from '../dist/api/http.js';
import { attachWebSockets } from '../dist/api/websocket.js';
import { Coordinator } from '../dist/coordinator.js';
import { Events } from '../dist/events.js';
import { fixture } from './helpers.mjs';

test('unauthenticated REST, host/origin checks, WebSocket events and detached client lifetime', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const events = new Events();
  const coordinator = new Coordinator(config, catalog, events, env);
  const server = createApi(config, coordinator);
  const closeSockets = attachWebSockets(server, config, events);
  defer(async () => {
    closeSockets();
    server.close();
    server.closeAllConnections();
    await coordinator.shutdown();
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
  const create = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'create', projectId: 'test' }),
  });
  const { session } = await create.json();
  const event = once(socket, 'message');
  const start = await fetch(`${base}/sessions/${session.id}/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'start', generation: 0 }),
  });
  const active = (await start.json()).session;
  assert.equal(active.ownership.phase, 'rpc');
  const snapshotResponse = await fetch(`${base}/sessions/${session.id}/snapshot`, { headers });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.epoch, handshake.epoch);
  assert.equal(snapshot.session.ownership.generation, active.ownership.generation);
  assert.equal(JSON.parse(String((await event)[0])).sessionId, session.id);
  const duplicate = await fetch(`${base}/sessions/${session.id}/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'start', generation: 0 }),
  });
  assert.equal(duplicate.status, 409);
  socket.close();
  await once(socket, 'close');
  assert.equal(catalog.get(session.id).ownership.phase, 'rpc');
  const badCommand = await fetch(`${base}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'config',
      generation: active.ownership.generation,
      command: { type: 'set_auto_retry', enabled: false },
    }),
  });
  assert.equal(badCommand.status, 400);
});

test('production frontend serves deep links and assets without bypassing origin checks', async (t) => {
  const { root, config, env, catalog, defer } = fixture(t);
  const directory = join(root, 'frontend');
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Pim test</title>');
  writeFileSync(join(directory, 'assets', 'test.js'), 'console.log("test");');
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  const server = createApi(config, coordinator, directory);
  defer(async () => {
    server.close();
    server.closeAllConnections();
    await coordinator.shutdown();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const page = await fetch(`${base}/app/projects/test/sessions/anything`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
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
