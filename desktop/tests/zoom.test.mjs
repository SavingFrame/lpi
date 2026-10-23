import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from '../../tests/helpers.mjs';
import { steppedZoom, validZoom, ZoomSettings } from '../zoom.ts';

test('UI scale is bounded and shortcuts use the same 5% steps', () => {
  assert.equal(validZoom(1.25), 1.25);
  assert.equal(steppedZoom(1.25, 1), 1.3);
  assert.equal(steppedZoom(0.75, -1), 0.75);
  assert.equal(steppedZoom(2, 1), 2);
  for (const value of [null, '1.25', NaN, Infinity, 0.5, 3, 1.234]) {
    assert.throws(() => validZoom(value));
  }
});

test('UI scale survives restart, tolerates corrupt preferences and preserves state on save failure', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'desktop-settings.json');
  const settings = new ZoomSettings(path);
  assert.equal(settings.factor, 1);
  settings.set(1.25);
  assert.equal(new ZoomSettings(path).factor, 1.25);
  assert.throws(() => settings.set(50));
  assert.equal(settings.factor, 1.25);
  assert.equal(new ZoomSettings(path).factor, 1.25);
  writeFileSync(path, '{"zoomFactor":999}');
  assert.equal(new ZoomSettings(path).factor, 1);
  writeFileSync(path, 'not json');
  assert.equal(new ZoomSettings(path).factor, 1);
  const blocked = join(root, 'blocked.json');
  mkdirSync(blocked);
  const failing = new ZoomSettings(blocked);
  assert.throws(() => failing.set(1.25));
  assert.equal(failing.factor, 1);
});
