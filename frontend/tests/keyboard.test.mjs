import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingError, defaults, parseBindings, shortcut } from '../src/keyboard/shortcuts.ts';

test('keyboard defaults separate send, newline and thinking and match exact modifiers', () => {
  assert.equal(bindingError(defaults), null);
  assert.equal(defaults.send, 'Enter');
  assert.equal(defaults.newline, 'Shift+Enter');
  assert.equal(defaults.thinking, 'Shift+Tab');
  const event = { key: 'H', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(shortcut(event), defaults.left);
  assert.notEqual(shortcut({ ...event, shiftKey: true }), defaults.left);
  assert.equal(shortcut({ ...event, key: 'Control' }), null);
});

test('conflicts and reserved keys cannot silently replace shortcuts or normal typing', () => {
  assert.match(bindingError({ ...defaults, right: defaults.left }), /already assigned/);
  assert.match(bindingError({ ...defaults, left: 'h' }), /modifier/);
  assert.match(bindingError({ ...defaults, left: 'Tab' }), /reserved/);
  assert.match(bindingError({ ...defaults, left: 'Ctrl+-' }), /UI scale/);
  assert.equal(bindingError({ ...defaults, send: 'Shift+Enter', newline: 'Enter' }), null);
  assert.equal(bindingError({ ...defaults, left: '', right: 'Ctrl+h' }), null);
});

test('stored bindings round trip and invalid settings fall back to usable defaults', () => {
  const custom = { ...defaults, send: 'Alt+Enter', newline: 'Enter', right: 'Meta+l' };
  assert.deepEqual(parseBindings(JSON.parse(JSON.stringify(custom))), custom);
  for (const invalid of [null, [], {}, { ...custom, send: 1 }, { ...custom, right: custom.left }]) {
    assert.deepEqual(parseBindings(invalid), defaults);
  }
});
