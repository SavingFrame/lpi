import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { emptyView, reduceRpc } from '../../src/client-state.ts';
import { sessionControls } from '../../src/session-controls.ts';
import { ApiError, operate, projects } from '../src/api.ts';
import { LiveSession } from '../src/live.ts';

const id = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const partial = { role: 'assistant', timestamp: 2, content: [], stopReason: 'pending' };

function boundary(cursor = 0, sessionId = id, epoch = 'server-one') {
  return {
    epoch,
    cursor,
    session: {
      id: sessionId,
      projectId: 'test',
      directory: '/tmp/project',
      file: '/tmp/session.jsonl',
      createdAt: '2026-01-01T00:00:00Z',
      ownership: { phase: 'rpc', generation: 3, interrupted: false },
    },
    state: { pendingMessageCount: 0 },
    controls: {
      model: { provider: 'fake', id: 'first', name: 'First' },
      thinkingLevel: 'medium',
      models: [{ provider: 'fake', id: 'first', name: 'First' }],
      thinkingLevels: ['off', 'medium', 'high'],
      contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 },
    },
    view: emptyView(),
  };
}

function setup(t) {
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      sockets.push(this);
    }
    send(record) {
      this.onmessage?.({ data: JSON.stringify(record) });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  globalThis.window = { location: { href: 'http://127.0.0.1:3141/' } };
  const requests = [];
  t.mock.method(
    globalThis,
    'fetch',
    (path, options) => new Promise((resolve) => requests.push({ path, options, resolve })),
  );
  let invalidations = 0;
  const live = new LiveSession(() => invalidations++);
  t.after(() => {
    live.disconnect();
    globalThis.WebSocket = original;
    delete globalThis.window;
  });
  live.select(id);
  live.connect();
  sockets[0].send({ type: 'connected', epoch: 'server-one', cursor: 0 });
  const send = (cursor, data, generation = 3) =>
    sockets
      .at(-1)
      .send({ epoch: 'server-one', cursor, sessionId: id, generation, type: 'rpc', data });
  return { live, sockets, requests, send, invalidations: () => invalidations };
}

test('project queries preserve discovered folder names', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      projects: [{ id: 'a'.repeat(64), name: 'notes', directory: '/tmp/Projects/notes' }],
    }),
  );
  assert.deepEqual(await projects(), [
    { id: 'a'.repeat(64), name: 'notes', directory: '/tmp/Projects/notes' },
  ]);
});

test('delta reconstruction uses authoritative block endings and final messages', () => {
  let view = reduceRpc(emptyView(), { type: 'agent_start' });
  view = reduceRpc(view, { type: 'message_start', message: partial });
  for (const update of [
    { type: 'text_start', contentIndex: 0 },
    { type: 'text_delta', contentIndex: 0, delta: 'hello' },
    { type: 'thinking_start', contentIndex: 1 },
    { type: 'thinking_delta', contentIndex: 1, delta: 'reason' },
    { type: 'toolcall_start', contentIndex: 2, id: 'call', toolName: 'bash' },
    { type: 'toolcall_delta', contentIndex: 2, delta: '{"command":' },
  ]) {
    view = reduceRpc(view, { type: 'message_update', assistantMessageEvent: update });
  }
  assert.equal(view.partial.content[0].text, 'hello');
  assert.equal(view.partial.content[1].thinking, 'reason');
  assert.equal(view.partial.content[2].argumentsText, '{"command":');
  view = reduceRpc(view, {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'authoritative' },
  });
  assert.equal(view.partial.content[0].text, 'authoritative');
  const final = { ...partial, content: [{ type: 'text', text: 'final' }], stopReason: 'stop' };
  view = reduceRpc(view, { type: 'message_end', message: final });
  assert.equal(view.messages.length, 1);
  assert.equal(view.partial, null);
  view = reduceRpc(view, { type: 'agent_end' });
  assert.equal(view.running, true);
  assert.equal(reduceRpc(view, { type: 'agent_settled' }).running, false);
});

test('distinct messages with the same timestamp are preserved', () => {
  const first = { role: 'user', timestamp: 1, content: 'first' };
  let view = reduceRpc(emptyView(), { type: 'message_end', message: first });
  view = reduceRpc(view, { type: 'message_end', message: { ...first, content: 'second' } });
  assert.deepEqual(
    view.messages.map((item) => item.content),
    ['first', 'second'],
  );
});

test('snapshot boundary drops old events and applies buffered streaming deltas once', async (t) => {
  const { live, requests, send } = setup(t);
  send(1, { type: 'message_start', message: partial });
  send(2, {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
  });
  const snapshot = boundary(1);
  snapshot.view.partial = partial;
  requests[0].resolve(Response.json(snapshot));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.cursor, 2);
  assert.equal(live.getState().snapshot.view.partial.content[0].text, 'hello');
  send(3, { type: 'queue_update', steering: ['next'], followUp: ['later'] });
  assert.equal(live.getState().snapshot.state.pendingMessageCount, 2);
  send(4, { type: 'queue_update', steering: [], followUp: [] });
  assert.equal(live.getState().snapshot.state.pendingMessageCount, 0);
});

test('context usage preserves unknown values and rejects malformed statistics', () => {
  const controls = boundary().controls;
  assert.equal(sessionControls(controls).contextUsage.percent, 30);
  controls.contextUsage.tokens = null;
  controls.contextUsage.percent = null;
  assert.deepEqual(sessionControls(controls).contextUsage, {
    tokens: null,
    contextWindow: 200000,
    percent: null,
  });
  assert.throws(() => sessionControls({ ...controls, contextUsage: { tokens: 1 } }));
  assert.throws(() => sessionControls({ ...controls, models: [{}] }));
});

test('settings and turn boundaries refresh authoritative model, thinking and context', async (t) => {
  const { live, requests, send, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  send(1, { type: 'thinking_level_changed', level: 'high' });
  assert.equal(live.getState().status, 'syncing');
  const updated = boundary(1);
  updated.controls.thinkingLevel = 'high';
  requests[1].resolve(Response.json(updated));
  await setImmediate();
  assert.equal(live.getState().snapshot.controls.thinkingLevel, 'high');
  sockets[0].send({
    epoch: 'server-one',
    cursor: 2,
    sessionId: id,
    generation: 3,
    type: 'settings-changed',
    data: null,
  });
  assert.equal(live.getState().status, 'syncing');
  const switched = boundary(2);
  switched.controls.model = { provider: 'fake', id: 'second', name: 'Second' };
  switched.controls.thinkingLevel = 'off';
  switched.controls.thinkingLevels = ['off'];
  requests[2].resolve(Response.json(switched));
  await setImmediate();
  assert.equal(live.getState().snapshot.controls.model.id, 'second');
  assert.deepEqual(live.getState().snapshot.controls.thinkingLevels, ['off']);
  for (const [index, type] of ['turn_end', 'agent_settled', 'compaction_end'].entries()) {
    send(3 + index, { type });
    assert.equal(live.getState().status, 'syncing');
    requests[3 + index].resolve(Response.json(boundary(3 + index)));
    await setImmediate();
    assert.equal(live.getState().status, 'ready');
  }
});

test('selection change ignores an outstanding response for the previous session', async (t) => {
  const { live, requests } = setup(t);
  live.select(otherId);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  assert.equal(live.getState().snapshot, null);
  requests[1].resolve(Response.json(boundary(0, otherId)));
  await setImmediate();
  assert.equal(live.getState().snapshot.session.id, otherId);
});

test('generation changes disable mutations until a fresh snapshot arrives', async (t) => {
  const { live, requests, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  sockets[0].send({
    epoch: 'server-one',
    cursor: 1,
    sessionId: id,
    generation: 4,
    type: 'ownership',
    data: { phase: 'stopping' },
  });
  assert.equal(live.getState().status, 'syncing');
  const snapshot = boundary(1);
  snapshot.session.ownership = { phase: 'unowned', generation: 5, interrupted: false };
  requests[1].resolve(Response.json(snapshot));
  await setImmediate();
  assert.equal(live.getState().snapshot.session.ownership.phase, 'unowned');
});

test('cursor gaps and restart epochs close the stream instead of applying uncertain events', async (t) => {
  const { live, sockets, send, requests } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  send(2, { type: 'agent_start' });
  assert.equal(sockets[0].readyState, 3);
  assert.equal(live.getState().status, 'offline');
  live.connect();
  sockets[1].send({ type: 'connected', epoch: 'server-two', cursor: 0 });
  requests[1].resolve(Response.json(boundary(0, id, 'server-two')));
  await setImmediate();
  assert.equal(live.getState().snapshot.epoch, 'server-two');
  assert.equal(live.getState().status, 'ready');
});

test('mismatched snapshot epoch and bounded buffer overflow require reconnection', async (t) => {
  const { live, requests, sockets, send } = setup(t);
  requests[0].resolve(Response.json(boundary(0, id, 'different-server')));
  await setImmediate();
  assert.equal(live.getState().status, 'offline');
  live.connect();
  sockets[1].send({ type: 'connected', epoch: 'server-one', cursor: 0 });
  send(1, { type: 'extension_error', error: 'x'.repeat(1024 * 1024) });
  assert.equal(live.getState().status, 'offline');
});

test('lost mutation responses are unknown and never automatically retried', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(typeof body.requestId, 'string');
    assert.equal(body.generation, 3);
    throw new Error('connection lost');
  });
  await assert.rejects(
    operate(id, 3, 'commands', { type: 'prompt', message: 'hello' }),
    (error) => error instanceof ApiError && error.outcome === 'unknown',
  );
  assert.equal(calls, 1);
});

test('invalid successful mutation acknowledgments remain unknown', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ outcome: 'acknowledged', requestId: 'wrong-request' });
  });
  await assert.rejects(
    operate(id, 3, 'commands', { type: 'abort' }),
    (error) => error instanceof ApiError && error.outcome === 'unknown',
  );
  assert.equal(calls, 1);
});

test('correlated mutation acceptance is returned without retrying', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    const body = JSON.parse(options.body);
    return Response.json({
      requestId: body.requestId,
      outcome: 'acknowledged',
      data: { disposition: 'queued' },
    });
  });
  const result = await operate(id, 3, 'commands', { type: 'steer', message: 'hello' });
  assert.equal(result.data.disposition, 'queued');
});
