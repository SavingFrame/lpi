import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'vite';
import { fixture } from '../../../tests/helpers.mjs';

test('chat search highlights only messages, navigates and updates live content', {
  timeout: 30000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const bundle = await build({
    configFile: false,
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./chat-search-page.mjs', import.meta.url)),
        formats: ['iife'],
        name: 'ChatSearchTest',
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const script = output.find((entry) => entry.type === 'chunk').code;
  const css = output.find(
    (entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'),
  ).source;
  const server = createServer((request, response) => {
    if (request.url === '/test.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(script);
    } else if (request.url === '/test.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(css);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<!doctype html><link rel="stylesheet" href="/test.css"><body><script src="/test.js"></script></body>',
      );
    }
  });
  defer(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { stdout } = await promisify(execFile)(
    process.env.CHROMIUM_BIN || 'chromium',
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${root}/chromium`,
      '--dump-dom',
      '--virtual-time-budget=5000',
      '--timeout=10000',
      `http://127.0.0.1:${server.address().port}/`,
    ],
    {
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: `${home}/.config`,
        XDG_CACHE_HOME: `${home}/.cache`,
      },
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.match(stdout, /data-result="passed"/, stdout);
});
