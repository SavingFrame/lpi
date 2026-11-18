import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from '../../tests/helpers.mjs';
import { RelaySettings } from '../relay-settings.ts';

test('relay settings persist names and normalized origins without checking reachability', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'settings', 'relay-profiles.json');
  const settings = new RelaySettings(path, 'http://127.0.0.1:3141');
  const [initial] = settings.profiles;
  settings.save([
    { name: 'PC', origin: initial.origin },
    { name: 'Homelab', origin: 'https://Offline.invalid:443/' },
  ]);
  const restored = new RelaySettings(path, 'https://alternative.invalid');
  const [pc, lab] = restored.profiles;
  assert.equal(pc.id, initial.id);
  assert.equal(pc.name, 'PC');
  assert.equal(lab.origin, 'https://offline.invalid');
  assert.notEqual(pc.id, lab.id);
  restored.save([{ name: 'Lab renamed', origin: lab.origin }]);
  assert.deepEqual(new RelaySettings(path, initial.origin).profiles, [
    { ...lab, name: 'Lab renamed' },
  ]);
  restored.save([{ name: 'Lab renamed', origin: 'https://replacement.invalid' }]);
  assert.notEqual(restored.profiles[0].id, lab.id);
});

test('invalid or duplicate endpoints do not change the saved profile list', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'relays.json');
  const settings = new RelaySettings(path, 'https://lab.example');
  const [lab] = settings.profiles;
  settings.save([lab]);
  const saved = readFileSync(path, 'utf8');
  const entries = [
    { name: 'Duplicate', origin: 'https://LAB.example:443/' },
    { name: 'Not HTTPS', origin: 'http://remote.example' },
    { name: 'Credentials', origin: 'https://user:pass@remote.example' },
    { name: 'Path', origin: 'https://remote.example/hidden/..' },
    { name: 'Query', origin: 'https://remote.example/?' },
    { name: 'Fragment', origin: 'https://remote.example/#' },
    { name: 'Invalid host', origin: 'https://remote;host.example' },
    { name: 'Invalid origin', origin: 42 },
  ];
  for (const entry of entries) {
    assert.throws(() => settings.save([lab, entry]));
    assert.deepEqual(settings.profiles, [lab]);
    assert.equal(readFileSync(path, 'utf8'), saved);
  }
});
