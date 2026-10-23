import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import Fastify from 'fastify';
import { build } from 'vite';
import { serveFrontend } from '../../../src/api/frontend.ts';
import { fixture } from '../../../tests/helpers.mjs';

test('Chromium allows cross-origin chart assets while isolating saved visual replies', {
  timeout: 60000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const bundle = await build({
    configFile: false,
    plugins: [tailwindcss()],
    logLevel: 'warn',
    esbuild: { jsx: 'automatic' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL('./display-page.mjs', import.meta.url)),
        formats: ['es'],
        name: 'DisplayTest',
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const directory = join(root, 'frontend');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await Promise.all(
    output.map((item) =>
      writeFile(
        join(directory, 'assets', item.fileName),
        item.type === 'chunk' ? item.code : item.source,
      ),
    ),
  );
  // A separate local origin stands in for a CDN. Tests make no public network requests.
  const cdnRequests = [];
  const cdn = createServer((request, response) => {
    cdnRequests.push(request.url);
    const assets = {
      '/chart.js': [
        'text/javascript',
        "window.fixtureChart = function(canvas) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2dd4bf'; ctx.fillRect(0, 0, 10, 10); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };",
      ],
      '/chart.css': ['text/css', '.cdn-probe { color: rgb(12, 34, 56); }'],
    };
    const asset = assets[request.url];
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset[0],
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(asset[1]);
  });
  defer(async () => {
    cdn.closeAllConnections();
    await new Promise((resolve) => cdn.close(resolve));
  });
  cdn.listen(0, '127.0.0.1');
  await once(cdn, 'listening');
  const cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
  const css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><meta name="viewport" content="width=device-width"><meta name="fixture-cdn" content="${cdnOrigin}">${css.map((item) => `<link rel="stylesheet" href="/assets/${item.fileName}">`).join('')}<script type="module" src="/assets/${entry.fileName}"></script>`,
  );
  const result = Promise.withResolvers();
  const leaks = [];
  const server = Fastify();
  server.all('/leak', async (request) => {
    leaks.push(request.url);
    return 'unexpected network access';
  });
  server.post('/result', async (request) => {
    result.resolve(JSON.parse(request.body));
    return 'ok';
  });
  server.get('/*', async (request, response) => {
    if (!(await serveFrontend(request.url, response, directory))) {
      response.code(404).send();
    }
  });
  defer(() => server.close());
  await server.listen({ port: 0, host: '127.0.0.1' });
  const browser = spawn(
    process.env.CHROMIUM_BIN || 'chromium',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${root}/chromium`,
      `http://127.0.0.1:${server.server.address().port}/`,
    ],
    {
      detached: true,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: `${home}/.config`,
        XDG_CACHE_HOME: `${home}/.cache`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let diagnostics = '';
  browser.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-6000);
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
    () => result.reject(new Error(`Browser timed out\n${diagnostics}`)),
    25000,
  );
  try {
    const report = await result.promise;
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.passed, true);
    assert.ok(cdnRequests.includes('/chart.js'), 'cross-origin script was requested');
    assert.ok(cdnRequests.includes('/chart.css'), 'cross-origin stylesheet was requested');
    assert.deepEqual(
      leaks,
      [],
      'external images, API calls, forms and self-navigation stay blocked',
    );
  } finally {
    clearTimeout(timeout);
  }
});
