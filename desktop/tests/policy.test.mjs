import assert from 'node:assert/strict';
import test from 'node:test';
import { DESKTOP_ORIGIN, desktopRelayOrigin } from '../../src/shared/desktop.ts';
import { allowedExternalUrl, allowedNavigation, desktopDevelopmentOrigin } from '../policy.ts';

test('desktop configuration accepts only an explicit safe relay origin', () => {
  assert.equal(desktopRelayOrigin(), 'http://127.0.0.1:3141');
  for (const url of ['http://localhost:5173/', 'http://[::1]:3141', 'https://lpi.example']) {
    assert.equal(desktopRelayOrigin(url), new URL(url).origin);
  }
  for (const url of [
    'file:///tmp/index.html',
    'javascript:alert(1)',
    'http://lpi.example',
    'https://user:secret@lpi.example',
    'https://lpi.example/app',
    'https://lpi.example/?token=secret',
    'https://lpi.example/#fragment',
    'not a URL',
  ]) {
    assert.throws(() => desktopRelayOrigin(url));
  }
});

test('electron-vite renderer URLs stay on an explicit loopback origin', () => {
  assert.equal(desktopDevelopmentOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(desktopDevelopmentOrigin('http://127.0.0.1:43210'), 'http://127.0.0.1:43210');
  for (const url of [
    'https://external.example',
    'http://localhost:5173',
    'http://127.0.0.1:5173/',
    'http://user@127.0.0.1:5173',
    'file:///tmp/index.html',
  ]) {
    assert.throws(() => desktopDevelopmentOrigin(url));
  }
});

test('external links allow only HTTP(S) without credentials', () => {
  for (const url of ['https://example.com/docs?q=hello#section', 'http://localhost:3141/']) {
    assert.equal(allowedExternalUrl(url), true, url);
  }
  for (const url of [
    'https://user:secret@example.com/',
    'https://user@example.com/',
    'file:///tmp/file',
    'javascript:alert(1)',
    'data:text/html,hello',
    'mailto:user@example.com',
    'lpi-app://app/app',
    'custom://example.com',
    'about:blank',
    '/app',
    'not a URL',
  ]) {
    assert.equal(allowedExternalUrl(url), false, url);
  }
});

test('navigation stays within lpi routes and the existing visual frame contract', () => {
  const origin = DESKTOP_ORIGIN;
  for (const path of ['/', '/app', '/app/projects/a/sessions/b?branch=c']) {
    assert.equal(allowedNavigation(origin + path, origin, true), true);
  }
  for (const url of [
    'lpi-app://app.evil/app',
    'lpi-app://app:123/app',
    'lpi-app://user:secret@app/app',
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
    'lpi:///?session=a',
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
