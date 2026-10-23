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
import { boundary } from '../live-fixture.mjs';

test('windowed sidebar search, project controls and settings work in desktop and compact layouts', {
  timeout: 30000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const directory = join(root, 'frontend');
  await build({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../..', import.meta.url)),
    logLevel: 'error',
    build: { outDir: directory, emptyOutDir: true },
  });
  const page = await readFile(new URL('./sidebar-layout-page.mjs', import.meta.url), 'utf8');
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  // Native settings capability only. No Electron APIs, real relay, or agent commands.
  const bootstrap = `<script>
    if (!new URLSearchParams(location.search).has('browser')) {
      window.lpiDesktop = {
        getZoom: async () => 1,
        setZoom: async value => value,
        onZoomChanged: () => () => {},
        notify: async () => {},
        onNotificationClicked: () => () => {}
      };
    }
    const headerFixture = new URLSearchParams(location.search).has('header');
    window.WebSocket = class {
      readyState = headerFixture ? 1 : 0;
      constructor() {
        if (headerFixture) {
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'connected', epoch: 'server-one', cursor: 0 }) }), 0);
        }
      }
      close() { this.readyState = 3; }
    };
    if (headerFixture) {
      const originalFetch = window.fetch;
      const pending = [];
      window.releaseSnapshots = () => pending.splice(0).forEach(resolve => resolve());
      window.fetch = async (url, options) => {
        if (window.holdSnapshots && String(url).endsWith('/snapshot')) {
          await new Promise(resolve => pending.push(resolve));
        }
        return originalFetch(url, options);
      };
    }
  </script>`;
  const projects = Array.from({ length: 80 }, (_, index) => ({
    id: String(index),
    name: `Project ${index + 1}`,
    directory: `/fixture/project-${String(index + 1).padStart(3, '0')}`,
  }));
  const sessions = projects.flatMap((project, projectIndex) =>
    Array.from({ length: 15 }, (_, index) => ({
      id: `11111111-1111-1111-1111-${String(projectIndex * 15 + index).padStart(12, '0')}`,
      projectId: project.id,
      directory: project.directory,
      file: `${project.directory}/${index}.jsonl`,
      piSessionId: `native-${projectIndex}-${index}`,
      title: `Session ${projectIndex}-${index} with a variable length title for row measurement`,
      createdAt: '2026-01-01T00:00:00Z',
      connection: 'disconnected',
      generation: 1,
      activity: 'unknown',
      archived: false,
      managedRuntime: false,
      readState: { completionId: null, viewedCompletionId: null },
    })),
  );
  const snapshot = boundary(0, sessions[0].id);
  snapshot.session = { ...sessions[0], connection: 'connected' };
  snapshot.state.sessionName =
    'A long session title that wraps on compact layouts without moving during synchronization';
  snapshot.state.managedRuntime = true;
  const result = Promise.withResolvers();
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://fixture').pathname;
    if (path === '/result') {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      result.resolve(JSON.parse(Buffer.concat(chunks).toString()));
      response.end();
    } else if (path === '/layout-test.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><script type="module" src="/layout-test.js"></script>');
    } else if (path === '/layout-test.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(page);
    } else if (path === '/projects' || path === '/sessions') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(path === '/projects' ? { projects } : { sessions }));
    } else if (path.endsWith('/snapshot') || path.endsWith('/tree')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          path.endsWith('/snapshot')
            ? snapshot
            : {
                sessionId: snapshot.session.id,
                generation: snapshot.session.generation,
                connected: true,
                activeLeafId: null,
                nodes: [],
              },
        ),
      );
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
      '--window-size=1280,900',
      `--user-data-dir=${root}/chromium`,
      `http://127.0.0.1:${server.address().port}/layout-test.html`,
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
    () => result.reject(new Error(`Layout timed out\n${diagnostics}`)),
    15000,
  );
  try {
    const report = await result.promise;
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.passed, true);
  } finally {
    clearTimeout(timeout);
  }
});
