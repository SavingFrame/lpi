import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { NativeCommands } from '../dist/extensions/pim/native/commands.js';
import { NativeQueue } from '../dist/extensions/pim/native/queue.js';
import { bridgeCommand } from '../dist/src/shared/commands.js';
import { pendingQueue } from '../dist/src/shared/queue.js';

function setup(t) {
  const listeners = new Set();
  const manager = { getSessionId: () => 'native', getSessionFile: () => '/isolated/native.jsonl' };
  const context = { sessionManager: manager };
  const session = Object.assign(Object.create(AgentSession.prototype), {
    sessionManager: manager,
    _steeringMessages: ['first'],
    _followUpMessages: ['later'],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    agent: { clearAllQueues() {} },
    _emitQueueUpdate() {
      for (const listener of listeners) {
        listener({ type: 'queue_update' });
      }
    },
  });
  const queue = new NativeQueue();
  queue.start(() => context);
  t.after(() => queue.dispose());
  const pi = { registerCommand() {} };
  const state = { context, queue, view: { compacting: false } };
  const commands = new NativeCommands(pi, state);
  const connection = {
    generation: 1,
    session: { id: 'native', file: '/isolated/native.jsonl' },
    isCurrent: () => true,
  };
  let sequence = 0;
  const clear = (expectedRevision, generation = 1) =>
    commands.execute(
      { id: `clear-${sequence++}`, generation, command: { type: 'clear_queue', expectedRevision } },
      connection,
    );
  return { session, queue, context, listeners, clear };
}

test('native queue clearing uses the captured session, revision and command generation', async (t) => {
  const { session, queue, context, listeners, clear } = setup(t);
  assert.equal(queue.snapshot(), null);
  assert.match((await clear('uncaptured')).error, /unavailable/);
  session.getSteeringMessages();
  const initial = queue.snapshot();
  assert.deepEqual(pendingQueue(initial), initial);
  assert.deepEqual(initial.steering, ['first']);
  assert.deepEqual(initial.followUp, ['later']);
  assert.match((await clear(initial.revision, 0)).error, /Stale/);
  session._steeringMessages.push('new');
  session._emitQueueUpdate();
  assert.match((await clear(initial.revision)).error, /queue changed/);
  assert.deepEqual(session.getSteeringMessages(), ['first', 'new']);
  const latest = queue.snapshot();
  const result = await clear(latest.revision);
  assert.equal(result.outcome, 'acknowledged');
  assert.equal(result.sync, true);
  assert.deepEqual(queue.snapshot().steering, []);
  assert.deepEqual(queue.snapshot().followUp, []);
  assert.notEqual(queue.snapshot().revision, latest.revision);
  context.sessionManager = { ...context.sessionManager, getSessionId: () => 'replacement' };
  assert.equal(queue.snapshot(), null);
  assert.match((await clear(queue.snapshot()?.revision ?? 'replacement')).error, /Stale/);
  queue.dispose();
  queue.dispose();
  assert.equal(listeners.size, 0);
});

test('queue hooks clean up on restart and reject clearing during compaction', (t) => {
  const prompt = AgentSession.prototype.prompt;
  const steering = AgentSession.prototype.getSteeringMessages;
  const { queue, session, context, listeners } = setup(t);
  session.getSteeringMessages();
  const revision = queue.snapshot().revision;
  session._compactionAbortController = new AbortController();
  assert.throws(() => queue.validate(revision), /compaction/);
  session._compactionAbortController = undefined;
  assert.doesNotThrow(() => queue.validate(revision));
  queue.start(() => context);
  assert.equal(listeners.size, 0);
  assert.equal(queue.snapshot(), null);
  session.getSteeringMessages();
  assert.equal(listeners.size, 1);
  assert.notEqual(queue.snapshot().revision, revision);
  queue.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(AgentSession.prototype.prompt, prompt);
  assert.equal(AgentSession.prototype.getSteeringMessages, steering);
});

test('queue cleanup preserves another extension’s later prototype patch', (t) => {
  const original = AgentSession.prototype.prompt;
  const { queue } = setup(t);
  t.after(() => {
    AgentSession.prototype.prompt = original;
  });
  const laterPatch = async () => {};
  AgentSession.prototype.prompt = laterPatch;
  queue.dispose();
  assert.equal(AgentSession.prototype.prompt, laterPatch);
});

test('queue wire contracts reject malformed state and require a revision for clearing', () => {
  assert.equal(pendingQueue(undefined), null);
  assert.throws(() => pendingQueue({ revision: 'one', steering: [4], followUp: [] }));
  assert.throws(() => bridgeCommand({ type: 'clear_queue' }));
  assert.deepEqual(bridgeCommand({ type: 'clear_queue', expectedRevision: 'one' }), {
    type: 'clear_queue',
    expectedRevision: 'one',
  });
});
