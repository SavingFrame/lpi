import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createApi } from '../../dist/src/api/http.js';
import { attachWebSockets } from '../../dist/src/api/websocket.js';
import { NativeBridges } from '../../dist/src/bridge/server.js';
import { Events } from '../../dist/src/events.js';
import { Sessions } from '../../dist/src/sessions.js';
import { SessionDiscovery } from '../../dist/src/storage/discovery.js';
import { SessionReadStore } from '../../dist/src/storage/read-state.js';
import { fixture } from '../../tests/helpers.mjs';

test('real Electron loads the frontend, restricts navigation, and closes without stopping the relay', {
  timeout: 30000,
  skip: process.platform !== 'linux',
}, async (t) => {
  const { root, home, config, defer } = fixture(t);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const states = new SessionReadStore(join(root, 'state.sqlite'));
  const sessions = new Sessions(new SessionDiscovery([], config.projects), bridges, events, states);
  const server = createApi(config, sessions, bridges, join(root, 'no-relay-frontend'));
  const closeSockets = attachWebSockets(server, config, events, bridges);
  defer(async () => {
    closeSockets();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const origin = `http://127.0.0.1:${config.port}`;
  config.origins = [origin, 'pim-app://app', 'http://127.0.0.1:5173'];
  const uiRequests = [];
  const requestOrigins = [];
  const requestMethods = [];
  server.on('request', (request) => {
    if (request.url === '/' || request.url === '/display' || request.url.startsWith('/assets/')) {
      uiRequests.push(request.url);
    }
    requestOrigins.push(request.headers.origin);
    requestMethods.push(request.method);
  });
  let eventConnections = 0;
  server.on('upgrade', (request) => {
    if (request.url === '/events') {
      eventConnections++;
    }
  });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    PI_CODING_AGENT_DIR: join(home, '.pi'),
    PIM_DESKTOP_SERVER: origin,
    PIM_DESKTOP_DEV: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [fileURLToPath(new URL('./smoke-app.mjs', import.meta.url))], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  defer(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, `Electron exited ${code}/${signal}\n${output}`);
  assert.match(output, /DESKTOP_SMOKE_OK/);
  assert.deepEqual(uiRequests, [], 'desktop UI and visuals never come from the relay');
  assert.ok(
    requestOrigins.includes('pim-app://app'),
    'custom origin stays explicit on HTTP requests',
  );
  assert.ok(requestMethods.includes('OPTIONS'), 'cross-origin JSON mutations use CORS preflight');
  assert.equal((await fetch(`${origin}/projects`)).status, 200, 'relay survives window close');

  // Launch the actual dev supervisor and renderer against the same isolated relay.
  const previousConnections = eventConnections;
  const dev = spawn(process.execPath, ['desktop/dev.mjs'], {
    env: { ...env, PIM_DEV_SERVER: 'https://unused.invalid' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let devOutput = '';
  dev.stdout.on('data', (chunk) => {
    devOutput += chunk;
  });
  dev.stderr.on('data', (chunk) => {
    devOutput += chunk;
  });
  defer(() => {
    if (dev.exitCode === null && dev.signalCode === null) {
      dev.kill('SIGKILL');
    }
  });
  for (let i = 0; eventConnections === previousConnections && i < 100; i++) {
    assert.equal(dev.exitCode, null, devOutput);
    await delay(50);
  }
  assert.ok(
    eventConnections > previousConnections,
    `Vite renderer connected to relay\n${devOutput}`,
  );
  const projects = await fetch('http://127.0.0.1:5173/projects');
  assert.equal((await projects.json()).projects[0].id, 'test', 'Vite proxy works');
  const devExit = once(dev, 'exit');
  dev.kill('SIGTERM');
  const [devCode] = await devExit;
  assert.equal(devCode, 0, devOutput);
  await assert.rejects(fetch('http://127.0.0.1:5173/'), 'launcher closes Vite');
  assert.equal((await fetch(`${origin}/projects`)).status, 200, 'relay survives dev shutdown');

  // Local assets must still render when there is no relay at all.
  closeSockets();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const offline = spawn(electron, [fileURLToPath(new URL('./smoke-app.mjs', import.meta.url))], {
    env: { ...env, PIM_SMOKE_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let offlineOutput = '';
  offline.stdout.on('data', (chunk) => {
    offlineOutput += chunk;
  });
  offline.stderr.on('data', (chunk) => {
    offlineOutput += chunk;
  });
  defer(() => {
    if (offline.exitCode === null && offline.signalCode === null) {
      offline.kill('SIGKILL');
    }
  });
  const [offlineCode] = await once(offline, 'exit');
  assert.equal(offlineCode, 0, offlineOutput);
  assert.match(offlineOutput, /DESKTOP_OFFLINE_OK/);
});
