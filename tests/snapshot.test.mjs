import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Coordinator } from '../dist/coordinator.js';
import { Events } from '../dist/events.js';
import { parseCommand } from '../dist/rpc/protocol.js';
import { fixture } from './helpers.mjs';

test('active snapshots include partial text and tools without opening a competing writer', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const events = new Events();
  const coordinator = new Coordinator(config, catalog, events, env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  const initial = await coordinator.snapshot(created.id);
  assert.equal(initial.session.ownership.phase, 'unowned');
  assert.deepEqual(initial.view.messages, []);
  assert.equal(initial.controls.model, null);
  assert.equal(initial.controls.contextUsage, null);
  const active = await coordinator.start(created.id, 0);
  await coordinator.command(created.id, active.ownership.generation, {
    type: 'prompt',
    message: 'snapshot-stream',
  });
  const before = readFileSync(created.file, 'utf8');
  const snapshot = await coordinator.snapshot(created.id);
  assert.equal(snapshot.epoch, events.epoch);
  assert.equal(snapshot.cursor, events.checkpoint().cursor);
  assert.equal(snapshot.session.ownership.generation, active.ownership.generation);
  assert.equal(snapshot.view.messages[0].content, 'snapshot-stream');
  assert.equal(snapshot.view.partial.content[0].text, 'hello');
  assert.equal(snapshot.view.running, true);
  assert.equal(snapshot.view.tools[0].id, 'call');
  assert.equal(readFileSync(created.file, 'utf8'), before);
  await coordinator.stop(created.id, active.ownership.generation);
  const stopped = await coordinator.snapshot(created.id);
  assert.equal(stopped.session.ownership.phase, 'unowned');
  assert.equal(stopped.view.running, false);
  assert.equal(stopped.view.partial, null);
  assert.deepEqual(stopped.view.tools, []);
  assert.equal(stopped.view.messages[0].content, 'snapshot-stream');
});

test('model and thinking changes remain available during runs and refresh snapshot controls', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const events = new Events();
  const coordinator = new Coordinator(config, catalog, events, env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  const active = await coordinator.start(created.id, 0);
  const command = (raw) =>
    coordinator.command(created.id, active.ownership.generation, parseCommand(raw));
  await command({ type: 'prompt', message: 'snapshot-stream' });
  await command({ type: 'set_thinking_level', level: 'high' });
  const thinking = await coordinator.snapshot(created.id);
  assert.equal(thinking.view.running, true);
  assert.equal(thinking.controls.thinkingLevel, 'high');
  assert.deepEqual(thinking.controls.contextUsage, {
    tokens: 60000,
    contextWindow: 200000,
    percent: 30,
  });
  assert.equal(thinking.controls.models.length, 2);
  const before = events.checkpoint().cursor;
  await command({ type: 'set_model', provider: 'fake', modelId: 'second' });
  assert.equal(events.checkpoint().cursor, before + 1);
  const switched = await coordinator.snapshot(created.id);
  assert.equal(switched.controls.model.id, 'second');
  assert.equal(switched.controls.thinkingLevel, 'off');
  assert.deepEqual(switched.controls.thinkingLevels, ['off']);
  assert.equal(switched.view.running, true);
  await assert.rejects(
    coordinator.command(created.id, 0, parseCommand({ type: 'set_thinking_level', level: 'high' })),
  );
  assert.throws(() => parseCommand({ type: 'set_thinking_level', level: 'invalid' }));
  assert.throws(() => parseCommand({ type: 'set_model', provider: 'fake' }));
  assert.deepEqual(parseCommand({ type: 'get_available_models' }), {
    type: 'get_available_models',
  });
  assert.deepEqual(parseCommand({ type: 'get_available_thinking_levels' }), {
    type: 'get_available_thinking_levels',
  });
});

test('snapshot preserves unknown context usage after compaction', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  env.PIM_FAKE_CONTEXT_UNKNOWN = 'true';
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  await coordinator.start(created.id, 0);
  assert.deepEqual((await coordinator.snapshot(created.id)).controls.contextUsage, {
    tokens: null,
    contextWindow: 200000,
    percent: null,
  });
});

test('snapshot reads retry when state changes between RPC responses', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  env.PIM_FAKE_SNAPSHOT_RACE = 'once';
  const events = new Events();
  const coordinator = new Coordinator(config, catalog, events, env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  await coordinator.start(created.id, 0);
  const snapshot = await coordinator.snapshot(created.id);
  assert.equal(snapshot.state.pendingMessageCount, 1);
  assert.deepEqual(snapshot.view.steering, ['raced-1']);
  assert.equal(snapshot.cursor, events.checkpoint().cursor);
});

test('continuous changes reject inconsistent snapshots with a bounded retry count', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  env.PIM_FAKE_SNAPSHOT_RACE = 'always';
  const events = new Events();
  const coordinator = new Coordinator(config, catalog, events, env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  const active = await coordinator.start(created.id, 0);
  const before = events.checkpoint().cursor;
  await assert.rejects(coordinator.snapshot(created.id), (error) => error.status === 409);
  assert.equal(events.checkpoint().cursor - before, 5);
  assert.equal(catalog.get(created.id).ownership.generation, active.ownership.generation);
});

test('unknown ownership snapshots never reopen files or spawn runtimes', async (t) => {
  const { config, env, catalog, defer } = fixture(t);
  const coordinator = new Coordinator(config, catalog, new Events(), env);
  defer(() => coordinator.shutdown());
  const created = coordinator.create('test');
  catalog.change(created.id, 'claim', 0);
  catalog.change(created.id, 'uncertain', 1);
  const snapshot = await coordinator.snapshot(created.id);
  assert.equal(snapshot.session.ownership.phase, 'unknown');
  assert.equal(snapshot.session.ownership.generation, 2);
  assert.deepEqual(snapshot.view.messages, []);
  const first = new Events();
  const restarted = new Events();
  assert.notEqual(first.epoch, restarted.epoch);
});
