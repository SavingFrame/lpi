import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedNavigation } from '../../dist/desktop/policy.js';
import { DESKTOP_ORIGIN, desktopRelayOrigin } from '../../dist/src/shared/desktop.js';

test('desktop configuration accepts only an explicit safe relay origin', () => {
  assert.equal(desktopRelayOrigin(), 'http://127.0.0.1:3141');
  for (const url of ['http://localhost:5173/', 'http://[::1]:3141', 'https://pim.example']) {
    assert.equal(desktopRelayOrigin(url), new URL(url).origin);
  }
  for (const url of [
    'file:///tmp/index.html',
    'javascript:alert(1)',
    'http://pim.example',
    'https://user:secret@pim.example',
    'https://pim.example/app',
    'https://pim.example/?token=secret',
    'https://pim.example/#fragment',
    'not a URL',
  ]) {
    assert.throws(() => desktopRelayOrigin(url));
  }
});

test('navigation stays within Pim routes and the existing visual frame contract', () => {
  const origin = DESKTOP_ORIGIN;
  for (const path of ['/', '/app', '/app/projects/a/sessions/b?branch=c']) {
    assert.equal(allowedNavigation(origin + path, origin, true), true);
  }
  for (const url of [
    'pim-app://app.evil/app',
    'pim-app://app:123/app',
    'pim-app://user:secret@app/app',
    'untrusted://app/app',
    'http://127.0.0.1:31410/app',
    'http://127.0.0.1.evil.example:3141/app',
    'http://127.0.0.1:5173/app',
    'https://127.0.0.1:3141/app',
    'http://user:secret@127.0.0.1:3141/app',
    `${origin}/sessions`,
    `${origin}/display`,
    `${origin}/application`,
    'file:///tmp/file',
    'data:text/html,hello',
    'javascript:alert(1)',
    'pim:///?session=a',
    'about:blank',
    'about:srcdoc',
  ]) {
    assert.equal(allowedNavigation(url, origin, true), false, url);
  }
  for (const url of [`${origin}/display`, 'about:blank', 'about:srcdoc']) {
    assert.equal(allowedNavigation(url, origin, false), true, url);
  }
  for (const url of [`${origin}/app`, 'https://external.example/display', 'file:///tmp/file']) {
    assert.equal(allowedNavigation(url, origin, false), false, url);
  }
});
