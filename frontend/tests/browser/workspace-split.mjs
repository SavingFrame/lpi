import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { fixture } from '../../../tests/helpers.mjs';
import { boundary, id } from '../live-fixture.mjs';

// Actual app and browser layout, with isolated HTTP fixtures and no native Pi or model calls.
test('split diff tabs preserve chat, route closes to the focused group and respect pane visibility', {
  timeout: 60000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const directory = join(root, 'frontend');
  await build({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../..', import.meta.url)),
    logLevel: 'error',
    build: { outDir: directory, emptyOutDir: true },
  });
  const page = await readFile(new URL('./workspace-split-page.mjs', import.meta.url), 'utf8');
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  const projectId = 'a'.repeat(64);
  const snapshot = boundary(0, id);
  snapshot.session.projectId = projectId;
  snapshot.state.sessionName = 'Split fixture';
  const session = {
    ...snapshot.session,
    title: 'Split fixture',
    activity: 'idle',
    archived: false,
    managedRuntime: false,
    readState: snapshot.readState,
  };
  let patch = ['one.ts', 'two.ts']
    .map(
      (name) =>
        `diff --git a/${name} b/${name}\nindex 1111111..2222222 100644\n--- a/${name}\n+++ b/${name}\n@@ -1,30 +1,30 @@\n${Array.from({ length: 30 }, (_, i) => `-old ${i}\n`).join('')}${Array.from({ length: 30 }, (_, i) => `+new ${i}\n`).join('')}`,
    )
    .join('');
  const bootstrap = `<script>
    const closeListeners = new Set();
    window.closeActiveTab = () => [...closeListeners].forEach(listener => listener());
    window.lpiDesktop = {
      onCloseTab: listener => { closeListeners.add(listener); return () => closeListeners.delete(listener); },
      getZoom: async () => 1, setZoom: async value => value,
      onZoomChanged: () => () => {}, notify: async () => {}, onNotificationClicked: () => () => {}
    };
    window.diffSockets = new Set();
    window.WebSocket = class {
      readyState = 1;
      constructor(url) {
        const diff = String(url).includes('/diff/events');
        if (diff) window.diffSockets.add(this);
        setTimeout(() => this.onmessage?.({data: JSON.stringify(diff ? {type:'diff-ready'} : {type:'connected',epoch:'server-one',cursor:0})}), 0);
      }
      close() { this.readyState = 3; window.diffSockets.delete(this); }
    };
  </script>`;
  let commands = 0;
  let reads = 0;
  let snapshots = 0;
  const result = Promise.withResolvers();
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://fixture').pathname;
    const json = (value) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(value));
    };
    if (path === '/result' || path.endsWith('/viewed')) {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (path === '/result') {
        result.resolve(body);
        response.end();
      } else {
        reads++;
        snapshot.readState.viewedCompletionId = body.completionId;
        json({
          requestId: body.requestId,
          outcome: 'acknowledged',
          data: { readState: snapshot.readState },
        });
      }
    } else if (path === '/split-test.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><script type="module" src="/split-test.js"></script>');
    } else if (path === '/split-test.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(page);
    } else if (path === '/projects') {
      json({ projects: [{ id: projectId, name: 'Fixture', directory: '/tmp/project' }] });
    } else if (path === '/sessions') {
      json({ sessions: [session] });
    } else if (path.endsWith('/snapshot')) {
      snapshots++;
      json(snapshot);
    } else if (path.endsWith('/tree')) {
      json({ sessionId: id, generation: 3, connected: true, activeLeafId: null, nodes: [] });
    } else if (path.endsWith('/diff')) {
      json({ patch, truncated: false });
    } else if (path === '/fixture/stats') {
      json({ commands, reads, snapshots });
    } else if (path === '/fixture/edit') {
      patch = patch.replaceAll('+new ', '+updated ');
      json({});
    } else if (path === '/fixture/complete') {
      snapshot.readState.completionId = '33333333-3333-3333-3333-333333333333';
      json({});
    } else if (path.endsWith('/commands')) {
      commands++;
      response.writeHead(500);
      json({ error: 'Unexpected command' });
    } else if (path === '/usage') {
      response.writeHead(503);
      response.end('{}');
    } else if (path.startsWith('/assets/')) {
      try {
        response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
        response.end(await readFile(join(directory, path)));
      } catch {
        response.writeHead(404).end();
      }
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(index.replace('</head>', `${bootstrap}</head>`));
    }
  });
  defer(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = spawn(
    process.env.CHROMIUM_BIN || 'chromium',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1000',
      `--user-data-dir=${root}/chromium`,
      `http://127.0.0.1:${server.address().port}/split-test.html`,
    ],
    {
      detached: true,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_CACHE_HOME: join(home, '.cache'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let diagnostics = '';
  browser.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  browser.once('error', result.reject);
  browser.once('exit', (code) =>
    result.reject(new Error(`Chromium exited: ${code}\n${diagnostics}`)),
  );
  defer(async () => {
    if (browser.pid && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit');
      process.kill(-browser.pid, 'SIGKILL');
      await exited;
    }
  });
  const timeout = setTimeout(
    () => result.reject(new Error(`Split test timed out\n${diagnostics}`)),
    30000,
  );
  try {
    const report = await result.promise;
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.passed, true);
    assert.equal(commands, 0, 'Layout and tab operations never dispatch agent commands');
  } finally {
    clearTimeout(timeout);
  }
});
