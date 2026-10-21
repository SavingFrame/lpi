import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from '../../../tests/helpers.mjs';

// Opt-in real-layout check. No application server, Pi runtime, user profile, or model calls.
test('Chromium scroll following, reader control, disclosures and cleanup', {
  timeout: 15000,
}, async (t) => {
  const { root, home, defer } = fixture(t);
  const controller = stripTypeScriptTypes(
    readFileSync(new URL('../../src/chat-scroll.ts', import.meta.url), 'utf8'),
  );
  const page = readFileSync(new URL('./chat-scroll-page.mjs', import.meta.url), 'utf8');
  const result = Promise.withResolvers();
  const server = createServer(async (request, response) => {
    if (request.url === '/result' && request.method === 'POST') {
      try {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        result.resolve(JSON.parse(Buffer.concat(chunks).toString()));
        response.end('ok');
      } catch (error) {
        result.reject(error);
        response.writeHead(400).end();
      }
      return;
    }
    const sources = {
      '/': ['text/html', '<!doctype html><script type="module" src="/page.js"></script>'],
      '/page.js': ['text/javascript', page],
      '/chat-scroll.js': ['text/javascript', controller],
    };
    const source = sources[request.url];
    if (!source) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': source[0],
      'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'",
    });
    response.end(source[1]);
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
      `--user-data-dir=${join(root, 'chromium')}`,
      `http://127.0.0.1:${server.address().port}/`,
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
  browser.once('error', (error) => result.reject(error));
  browser.once('exit', (code, signal) => {
    result.reject(new Error(`Chromium exited before reporting: ${code ?? signal}\n${diagnostics}`));
  });
  defer(() => {
    rmSync(join(root, 'chromium'), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  defer(async () => {
    if (browser.pid && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit');
      // Chromium has child processes that can still write the isolated profile.
      process.kill(-browser.pid, 'SIGKILL');
      await exited;
    }
  });
  const timeout = setTimeout(
    () => result.reject(new Error(`Browser check timed out\n${diagnostics}`)),
    10000,
  );
  let report;
  try {
    report = await result.promise;
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(report.error, undefined, report.error);
  assert.deepEqual(report.passed, [
    'streaming and resize',
    'manual scroll',
    'disclosures',
    'cleanup',
  ]);
});
