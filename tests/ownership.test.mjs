import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transition } from '../dist/ownership.js';
import { Catalog } from '../dist/storage/catalog.js';
import { acquireCoordinatorLock } from '../dist/storage/files.js';
import { fixture } from './helpers.mjs';

test('generations serialize claims and unknown never grants ownership', () => {
  const initial = { phase: 'unowned', generation: 0, interrupted: false };
  const claimed = transition(initial, 'claim', 0);
  assert.throws(() => transition(claimed, 'claim', 0), /Stale/);
  assert.throws(() => transition(claimed, 'claim', 1), /Cannot/);
  const unknown = transition(claimed, 'uncertain', 1);
  assert.throws(() => transition(unknown, 'claim', 2), /Cannot/);
  assert.equal(transition(unknown, 'confirm-release', 2).phase, 'unowned');
});

test('exclusive coordinator lock cannot be stolen, even in the same PID', (t) => {
  const { config } = fixture(t);
  const release = acquireCoordinatorLock(config.dataDirectory);
  assert.throws(() => acquireCoordinatorLock(config.dataDirectory), /EEXIST/);
  release();
  acquireCoordinatorLock(config.dataDirectory)();
});

test('restart converts active ownership to unknown and requires explicit confirmation', (t) => {
  const { config, catalog } = fixture(t);
  const session = catalog.create(config.projects[0]);
  const header = readFileSync(session.file, 'utf8');
  assert.ok(header.endsWith('\n'));
  assert.equal(JSON.parse(header).version, 3);
  catalog.change(session.id, 'claim', 0);
  const restarted = new Catalog(config.dataDirectory, config.projects);
  const owner = restarted.get(session.id).ownership;
  assert.equal(owner.phase, 'unknown');
  assert.equal(owner.interrupted, true);
  assert.throws(() => restarted.change(session.id, 'claim', owner.generation), /Cannot/);
  const again = new Catalog(config.dataDirectory, config.projects);
  assert.equal(again.get(session.id).ownership.generation, owner.generation);
  again.change(session.id, 'confirm-release', owner.generation);
  assert.equal(again.get(session.id).ownership.phase, 'unowned');
});

test('catalog rejects a project moved underneath persisted sessions', (t) => {
  const { config, catalog } = fixture(t);
  catalog.create(config.projects[0]);
  assert.throws(
    () => new Catalog(config.dataDirectory, [{ id: 'test', directory: '/elsewhere' }]),
    /relocated/,
  );
});
