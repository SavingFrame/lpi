import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { emptyView, reduceEvent } from '../../src/client-state.ts';
import { sessionControls } from '../../src/session-controls.ts';
import { ApiError, operate, projects, session } from '../src/api.ts';
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
      piSessionId: 'native-id',
      connection: 'connected',
      generation: 3,
    },
    state: { isStreaming: false, hasPendingMessages: false },
    controls: {
      model: { provider: 'fake', id: 'first', name: 'First' },
      thinkingLevel: 'medium',
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
      .send({ epoch: 'server-one', cursor, sessionId: id, generation, type: 'pi-event', data });
  return { live, sockets, requests, send, invalidations: () => invalidations };
}

test('native snapshots and authoritative partials synchronize through the browser', async (t) => {
  const { live, requests, send, sockets } = setup(t);
  const native = boundary();
  native.state = { nativeTui: true, isStreaming: true, hasPendingMessages: false };
  requests[0].resolve(Response.json(native));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  send(1, {
    type: 'message_update',
    message: { ...partial, content: [{ type: 'text', text: 'Native partial' }] },
  });
  assert.equal(live.getState().snapshot.view.partial.content[0].text, 'Native partial');
  sockets[0].send({
    epoch: 'server-one',
    cursor: 2,
    sessionId: id,
    generation: 3,
    type: 'bridge-sync',
    data: null,
  });
  assert.equal(live.getState().status, 'syncing');
  const changed = structuredClone(native);
  changed.cursor = 2;
  changed.view.messages = [{ role: 'user', content: 'Current branch', timestamp: 1 }];
  requests[1].resolve(Response.json(changed));
  await setImmediate();
  assert.equal(live.getState().snapshot.view.messages[0].content, 'Current branch');
  sockets[0].send({
    epoch: 'server-one',
    cursor: 3,
    sessionId: id,
    generation: 4,
    type: 'connection',
    data: { connection: 'disconnected' },
  });
  assert.equal(live.getState().status, 'syncing');
  changed.cursor = 3;
  changed.session.connection = 'disconnected';
  changed.session.generation = 4;
  changed.state = { readOnly: true, bridgeConnected: false };
  requests[2].resolve(Response.json(changed));
  await setImmediate();
  assert.equal(live.getState().snapshot.session.connection, 'disconnected');
  assert.equal(live.getState().snapshot.state.bridgeConnected, false);
});

test('session validation requires native identity and valid connection metadata', () => {
  const native = boundary().session;
  assert.equal(session(native).connection, 'connected');
  assert.throws(() => session({ ...native, piSessionId: undefined }));
  assert.throws(() => session({ ...native, connection: 'invalid' }));
  assert.throws(() => session({ ...native, generation: -1 }));
});

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

test('native partials replace content authoritatively and settlement clears transient state', () => {
  let view = reduceEvent(emptyView(), { type: 'agent_start' });
  view = reduceEvent(view, { type: 'message_start', message: partial });
  const streamed = {
    ...partial,
    content: [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'reason' },
      { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } },
    ],
  };
  view = reduceEvent(view, { type: 'message_update', message: streamed });
  assert.deepEqual(view.partial.content, streamed.content);
  const final = { ...partial, content: [{ type: 'text', text: 'final' }], stopReason: 'stop' };
  view = reduceEvent(view, { type: 'message_end', message: final });
  assert.equal(view.messages.length, 1);
  assert.equal(view.partial, null);
  view = reduceEvent(view, { type: 'agent_end' });
  assert.equal(view.running, true);
  assert.equal(reduceEvent(view, { type: 'agent_settled' }).running, false);
});

test('distinct messages with the same timestamp are preserved', () => {
  const first = { role: 'user', timestamp: 1, content: 'first' };
  let view = reduceEvent(emptyView(), { type: 'message_end', message: first });
  view = reduceEvent(view, { type: 'message_end', message: { ...first, content: 'second' } });
  assert.deepEqual(
    view.messages.map((item) => item.content),
    ['first', 'second'],
  );
});

test('snapshot boundary drops old events and applies buffered native partials once', async (t) => {
  const { live, requests, send } = setup(t);
  send(1, { type: 'message_start', message: partial });
  send(2, {
    type: 'message_update',
    message: { ...partial, content: [{ type: 'text', text: 'hello' }] },
  });
  const snapshot = boundary(1);
  snapshot.view.partial = partial;
  requests[0].resolve(Response.json(snapshot));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.cursor, 2);
  assert.equal(live.getState().snapshot.view.partial.content[0].text, 'hello');
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
  assert.throws(() => sessionControls({ ...controls, model: {} }));
});

test('native status refreshes model, thinking, queue presence and context', async (t) => {
  const { live, requests, send, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  sockets[0].send({
    epoch: 'server-one',
    cursor: 1,
    sessionId: id,
    generation: 3,
    type: 'bridge-status',
    data: null,
  });
  assert.equal(live.getState().status, 'syncing');
  const updated = boundary(1);
  updated.controls.thinkingLevel = 'high';
  updated.controls.model = { provider: 'fake', id: 'second', name: 'Second' };
  updated.state.hasPendingMessages = true;
  requests[1].resolve(Response.json(updated));
  await setImmediate();
  assert.equal(live.getState().snapshot.controls.thinkingLevel, 'high');
  assert.equal(live.getState().snapshot.controls.model.id, 'second');
  assert.equal(live.getState().snapshot.state.hasPendingMessages, true);
  for (const [index, type] of ['agent_settled', 'compaction_end'].entries()) {
    send(2 + index, { type });
    assert.equal(live.getState().status, 'syncing');
    requests[2 + index].resolve(Response.json(boundary(2 + index)));
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
    type: 'connection',
    data: { connection: 'disconnected' },
  });
  assert.equal(live.getState().status, 'syncing');
  const snapshot = boundary(1);
  snapshot.session.connection = 'disconnected';
  snapshot.session.generation = 4;
  requests[1].resolve(Response.json(snapshot));
  await setImmediate();
  assert.equal(live.getState().snapshot.session.connection, 'disconnected');
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
  send(1, { type: 'message_update', message: { ...partial, content: 'x'.repeat(1024 * 1024) } });
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
    operate(id, 3, { type: 'prompt', message: 'hello' }),
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
    operate(id, 3, { type: 'abort' }),
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
      data: { disposition: 'dispatched' },
    });
  });
  const result = await operate(id, 3, { type: 'steer', message: 'hello' });
  assert.equal(result.data.disposition, 'dispatched');
});
