import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Coordinator } from '../dist/coordinator.js';
import { Events } from '../dist/events.js';
import { fixture } from './helpers.mjs';

test('competing starts, stale commands, persistence and confirmed shutdown', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const session = coordinator.create('test');
  const first = coordinator.start(session.id, 0);
  await assert.rejects(coordinator.start(session.id, 0), /Stale/);
  const active = await first;
  const gen = active.ownership.generation;
  await assert.rejects(coordinator.command(session.id, 0, { type: 'abort' }), /stale/);
  await coordinator.command(session.id, gen, { type: 'prompt', message: 'marker' });
  await assert.rejects(
    coordinator.command(session.id, gen, { type: 'prompt', message: '/management' }),
    /blocked/,
  );
  await coordinator.command(session.id, gen, { type: 'prompt', message: '/skill:test' });
  await coordinator.stop(session.id, gen);
  assert.equal(catalog.get(session.id).ownership.phase, 'unowned');
  const resumed = await coordinator.start(session.id, catalog.get(session.id).ownership.generation);
  const data = await coordinator.command(session.id, resumed.ownership.generation, {
    type: 'get_messages',
  });
  assert.equal(data.messages[0].content, 'marker');
});

test('transport failure blocks reclaim until the existing child has exited', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const session = coordinator.create('test');
  const active = await coordinator.start(session.id, 0);
  await assert.rejects(
    coordinator.command(session.id, active.ownership.generation, {
      type: 'prompt',
      message: 'malformed',
    }),
    /Invalid RPC/,
  );
  const blocked = catalog.get(session.id);
  assert.equal(blocked.ownership.phase, 'unknown');
  await assert.rejects(coordinator.start(session.id, blocked.ownership.generation), /Cannot/);
  const released = await coordinator.stop(session.id, blocked.ownership.generation);
  assert.equal(released.ownership.phase, 'unowned');
  assert.equal(released.ownership.interrupted, true);
});

test('ownership storage failure still stops children and leaves coordinator blocked', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const session = coordinator.create('test');
  await coordinator.start(session.id, 0);
  rmSync(config.dataDirectory, { recursive: true });
  assert.equal(await coordinator.shutdown(), false);
  assert.throws(() => coordinator.create('test'), /blocked/);
});

test('unexpected child exit is interrupted, not transparently retried', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const session = coordinator.create('test');
  const active = await coordinator.start(session.id, 0);
  await assert.rejects(
    coordinator.command(session.id, active.ownership.generation, {
      type: 'prompt',
      message: 'exit',
    }),
    /exited/,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const owner = catalog.get(session.id).ownership;
  assert.equal(owner.phase, 'unowned');
  assert.equal(owner.interrupted, true);
});
