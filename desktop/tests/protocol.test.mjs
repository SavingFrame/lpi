import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bundledResponse } from '../../dist/desktop/protocol.js';
import { fixture } from '../../tests/helpers.mjs';

test('bundled UI serves local assets, deep links and visuals without forwarding API requests', async (t) => {
  const { root } = fixture(t);
  const directory = join(root, 'bundle');
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), '<html><head></head><body>Pim</body></html>');
  writeFileSync(join(directory, 'assets', 'app.js'), 'window.bundleLoaded = true;');
  writeFileSync(join(root, 'secret'), 'must not be exposed');
  symlinkSync(join(root, 'secret'), join(directory, 'assets', 'escape.js'));
  const relay = 'http://127.0.0.1:3141';
  const request = (path, method = 'GET') =>
    bundledResponse(new Request(`pim-app://app${path}`, { method }), directory, relay);

  for (const path of ['/', '/app', '/app/projects/a/sessions/b?branch=c']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(
      await response.text(),
      /name="pim-relay-origin" content="http:\/\/127.0.0.1:3141"/,
    );
    const csp = response.headers.get('Content-Security-Policy');
    assert.match(csp, /connect-src 'self' http:\/\/127.0.0.1:3141 ws:\/\/127.0.0.1:3141;/);
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  }
  const asset = await request('/assets/app.js');
  assert.match(asset.headers.get('Content-Type'), /javascript/);
  assert.match(await asset.text(), /bundleLoaded/);
  const display = await request('/display');
  assert.match(display.headers.get('Content-Security-Policy'), /sandbox allow-scripts/);
  assert.match(await display.text(), /sandbox="allow-scripts"/);
  assert.equal(await (await request('/', 'HEAD')).text(), '');
  assert.equal((await request('/', 'POST')).status, 405);
  for (const path of [
    '/sessions',
    '/projects',
    '/events',
    '/assets/missing.js',
    '/assets/escape.js',
    '/assets/%2e%2e%2f%2e%2e%2fsecret',
    '/assets/%00.js',
  ]) {
    assert.equal((await request(path)).status, 404, path);
  }
  for (const url of [
    'pim-app://other/',
    'pim-app://app:123/',
    'file://app/',
    'pim-app://user@app/',
  ]) {
    assert.equal(
      (await bundledResponse({ url, method: 'GET' }, directory, relay)).status,
      404,
      url,
    );
  }
});
