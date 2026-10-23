import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createApi } from '../../dist/src/api/http.js';
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
  const server = await createApi(
    config,
    sessions,
    bridges,
    events,
    join(root, 'no-relay-frontend'),
  );
  defer(async () => {
    await server.close();
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  config.port = server.server.address().port;
  const origin = `http://127.0.0.1:${config.port}`;
  config.origins = [origin, 'pim-app://app', 'http://127.0.0.1:5173'];
  const uiRequests = [];
  const requestOrigins = [];
  const requestMethods = [];
  server.server.on('request', (request) => {
    if (request.url === '/' || request.url === '/display' || request.url.startsWith('/assets/')) {
      uiRequests.push(request.url);
    }
    requestOrigins.push(request.headers.origin);
    requestMethods.push(request.method);
  });
  let eventConnections = 0;
  server.server.on('upgrade', (request) => {
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
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_ENTRY;
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

  // Reserve an isolated development port instead of interfering with a running app.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const devPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const devOrigin = `http://127.0.0.1:${devPort}`;
  config.origins.push(devOrigin);
  await t.test('electron-vite development launch and shutdown', async () => {
    const previousConnections = eventConnections;
    const dev = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../node_modules/electron-vite/bin/electron-vite.js', import.meta.url),
        ),
        'dev',
        '--config',
        'desktop/electron.vite.config.ts',
        '--watch',
        '--logLevel',
        'warn',
      ],
      {
        env: {
          ...env,
          PIM_DESKTOP_DEV_PORT: String(devPort),
          PIM_DEV_SERVER: 'https://unused.invalid',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
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
    for (let i = 0; eventConnections === previousConnections && i < 200; i++) {
      assert.equal(dev.exitCode, null, devOutput);
      await delay(50);
    }
    assert.ok(
      eventConnections > previousConnections,
      `Dev renderer connected to relay\n${devOutput}`,
    );
    const projects = await fetch(`${devOrigin}/projects`);
    assert.equal((await projects.json()).projects[0].id, 'test', 'Vite proxy works');
    const devExit = once(dev, 'exit');
    dev.kill('SIGTERM');
    const [devCode] = await devExit;
    assert.ok(devCode === 0 || devCode === 143, devOutput);
    await assert.rejects(fetch(devOrigin), 'electron-vite closes Vite');
    assert.equal((await fetch(`${origin}/projects`)).status, 200, 'relay survives dev shutdown');
  });

  // Local assets must still render when there is no relay at all.
  await server.close();
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
