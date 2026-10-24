import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { build } from 'vite';
import { serveFrontend } from '../../../src/api/frontend.ts';
import { fixture } from '../../../tests/helpers.mjs';

// Isolated browser fixture, no native runtime or model calls.
test('edit patches render safely, switch layout and preserve raw output in Chromium', {
  timeout: 60000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const bundle = await build({
    configFile: false,
    base: '/assets/',
    logLevel: 'warn',
    esbuild: { jsx: 'automatic' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL('./edit-diff-page.mjs', import.meta.url)),
        formats: ['es'],
        name: 'EditDiffTest',
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const directory = join(root, 'frontend');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await Promise.all(
    output.map(async (item) => {
      const path = join(directory, 'assets', item.fileName);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, item.type === 'chunk' ? item.code : item.source);
    }),
  );
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
  const css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
  await writeFile(
    join(directory, 'assets', 'fixture.css'),
    'body { margin: 0; background: #18181b; color: white; } main { width: 360px; max-width: 100%; } * { box-sizing: border-box; }',
  );
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/fixture.css">${css.map((item) => `<link rel="stylesheet" href="/assets/${item.fileName}">`).join('')}<script type="module" src="/assets/${entry.fileName}"></script>`,
  );
  const result = Promise.withResolvers();
  const server = Fastify();
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
    () => result.reject(new Error(`Browser timed out\n${diagnostics}`)),
    20000,
  );
  try {
    const report = await result.promise;
    assert.equal(report.error, undefined, report.error);
    assert.equal(report.passed, true);
  } finally {
    clearTimeout(timeout);
  }
});
