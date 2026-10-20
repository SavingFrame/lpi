import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { EVENT_BUFFER_LIMIT, imageAttachments } from '../../src/attachments.ts';
import { emptyView, reduceEvent } from '../../src/client-state.ts';
import { sessionControls } from '../../src/session-controls.ts';
import { ApiError, operate, projects, session } from '../src/api.ts';
import { LiveSession } from '../src/live.ts';
import { transcriptState } from '../src/transcript-state.ts';

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
      availableModels: [{ provider: 'fake', id: 'first', name: 'First' }],
      model: { provider: 'fake', id: 'first', name: 'First' },
      thinkingLevel: 'medium',
      availableThinkingLevels: ['off', 'low', 'medium', 'high'],
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

test('transcript pairs parallel tool results by ID without changing native messages', () => {
  const calls = {
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'thinking', thinking: 'Inspect files' },
      { type: 'toolCall', id: 'first', name: 'read', arguments: { path: 'a' } },
      { type: 'text', text: 'Also checking another file.' },
      { type: 'toolCall', id: 'second', name: 'read', arguments: { path: 'b' } },
    ],
  };
  const second = {
    role: 'toolResult',
    timestamp: 2,
    toolCallId: 'second',
    content: [{ type: 'text', text: 'failed' }],
    isError: true,
  };
  const first = {
    role: 'toolResult',
    timestamp: 3,
    toolCallId: 'first',
    content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
  };
  const orphan = { role: 'toolResult', timestamp: 4, toolCallId: 'missing', content: 'kept' };
  const hidden = { role: 'toolResult', timestamp: 5, toolCallId: 'first', display: false };
  const view = { ...emptyView(), messages: [calls, second, first, orphan, hidden] };
  const projected = transcriptState(view);
  assert.deepEqual(projected.messages, [calls, orphan]);
  assert.equal(projected.tools.get('first').result, first);
  assert.equal(projected.tools.get('first').status, 'Completed');
  assert.equal(projected.tools.get('second').result, second);
  assert.equal(projected.tools.get('second').status, 'Failed');
  assert.equal(view.messages.length, 5);
});

test('transcript keeps one tool block through streaming, progress and completion', () => {
  const call = {
    ...partial,
    content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } }],
  };
  let view = { ...emptyView(), running: true, partial: call };
  assert.equal(transcriptState(view).tools.get('call').status, 'Pending');
  view = reduceEvent(view, { type: 'message_end', message: call });
  view = reduceEvent(view, {
    type: 'tool_execution_start',
    toolCallId: 'call',
    toolName: 'bash',
    args: { command: 'true' },
  });
  const progress = { content: [{ type: 'text', text: 'working' }] };
  view = reduceEvent(view, {
    type: 'tool_execution_update',
    toolCallId: 'call',
    toolName: 'bash',
    args: { command: 'true' },
    partialResult: progress,
  });
  assert.equal(transcriptState(view).tools.get('call').status, 'Running');
  assert.equal(transcriptState(view).tools.get('call').progress, progress);
  assert.deepEqual(transcriptState(view).unpaired, []);
  view = reduceEvent(view, { type: 'tool_execution_end', toolCallId: 'call' });
  const result = { role: 'toolResult', timestamp: 3, toolCallId: 'call', content: 'done' };
  view = reduceEvent(view, { type: 'message_end', message: result });
  const projected = transcriptState(view);
  assert.deepEqual(projected.messages, [call]);
  assert.deepEqual(projected.tools.get('call').result, result);
  assert.equal(projected.tools.get('call').status, 'Completed');
});

test('transcript preserves unmatched activity and marks missing saved results honestly', () => {
  const view = {
    ...emptyView(),
    messages: [{ ...partial, content: [{ type: 'toolCall', id: 'old', name: 'bash' }] }],
    tools: [{ id: 'unknown', name: 'read', args: { path: 'a' } }],
  };
  const projected = transcriptState(view);
  assert.equal(projected.tools.get('old').status, 'No result');
  assert.deepEqual(projected.unpaired, view.tools);
  assert.equal(projected.tools.get('unknown').status, 'Running');
});

test('transcript groups consecutive authors across tools but not across user turns', () => {
  const user = { role: 'user', timestamp: 1, content: 'Check this' };
  const call = {
    role: 'assistant',
    timestamp: 2,
    content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } }],
  };
  const result = { role: 'toolResult', timestamp: 3, toolCallId: 'call', content: 'done' };
  const answer = { role: 'assistant', timestamp: 4, content: 'Checked.' };
  const nextUser = { ...user, timestamp: 5, content: 'Continue' };
  const nextAnswer = { ...answer, timestamp: 6, content: 'Continuing.' };
  const view = { ...emptyView(), messages: [user, call, result, answer, nextUser, nextAnswer] };
  const { groups } = transcriptState(view);
  assert.deepEqual(
    groups.map((group) => group.author),
    ['You', 'Pi', 'You', 'Pi'],
  );
  assert.deepEqual(
    groups.map((group) => group.messages),
    [[user], [call, answer], [nextUser], [nextAnswer]],
  );
  assert.equal(view.messages.length, 6);
  assert.deepEqual(
    transcriptState({ ...emptyView(), messages: [user, nextUser] }).groups[0].messages,
    [user, nextUser],
  );
});

test('streaming content joins its author group and stays grouped after completion', () => {
  const first = { role: 'assistant', timestamp: 1, content: 'Checking.' };
  const streamed = { ...partial, content: [{ type: 'text', text: 'Done.' }] };
  const view = { ...emptyView(), messages: [first], partial: streamed };
  const { groups } = transcriptState(view);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].streaming, true);
  assert.deepEqual(groups[0].messages, [first, streamed]);
  const completed = transcriptState(reduceEvent(view, { type: 'message_end', message: streamed }));
  assert.equal(completed.groups.length, 1);
  assert.equal(completed.groups[0].streaming, false);
  assert.deepEqual(completed.groups[0].messages, groups[0].messages);
  const onlyPartial = transcriptState({ ...emptyView(), partial: streamed });
  assert.equal(onlyPartial.groups[0].author, 'Pi');
  assert.equal(onlyPartial.groups[0].streaming, true);
});

test('unmatched tool output retains separate authors and breaks assistant groups', () => {
  const first = { role: 'assistant', timestamp: 1, content: 'Checking.' };
  const read = { role: 'toolResult', toolName: 'read', timestamp: 2, content: 'file' };
  const bash = { role: 'toolResult', toolName: 'bash', timestamp: 3, content: 'output' };
  const answer = { ...first, timestamp: 4, content: 'Done.' };
  const { groups } = transcriptState({ ...emptyView(), messages: [first, read, bash, answer] });
  assert.deepEqual(
    groups.map((group) => group.author),
    ['Pi', 'read', 'bash', 'Pi'],
  );
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

test('image events fit the synchronization buffer and remain in conversation content', async (t) => {
  const { live, requests, send } = setup(t);
  const image = { type: 'image', mimeType: 'image/png', data: 'A'.repeat(3 * 1024 * 1024) };
  send(1, { type: 'message_end', message: { role: 'user', timestamp: 1, content: [image] } });
  assert.equal(live.getState().status, 'syncing');
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.deepEqual(live.getState().snapshot.view.messages[0].content, [image]);
});

test('shared image validation accepts raster attachments and rejects invalid clipboard data', () => {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  };
  assert.deepEqual(imageAttachments([image]), [image]);
  assert.throws(() => imageAttachments([{ ...image, mimeType: 'image/svg+xml' }]));
  assert.throws(() => imageAttachments([{ ...image, data: 'not-base64' }]));
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
  assert.deepEqual(sessionControls(controls).availableModels, controls.availableModels);
  assert.throws(() => sessionControls({ ...controls, availableModels: [{}] }));
  assert.throws(() => sessionControls({ ...controls, thinkingLevel: 'invalid' }));
  assert.throws(() => sessionControls({ ...controls, availableThinkingLevels: ['invalid'] }));
  assert.deepEqual(
    sessionControls({ ...controls, thinkingLevel: 'max', availableThinkingLevels: ['high', 'max'] })
      .availableThinkingLevels,
    ['high', 'max'],
  );
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
  updated.controls.thinkingLevel = 'max';
  updated.controls.availableThinkingLevels = ['high', 'max'];
  updated.controls.model = { provider: 'fake', id: 'second', name: 'Second' };
  updated.state.hasPendingMessages = true;
  requests[1].resolve(Response.json(updated));
  await setImmediate();
  assert.equal(live.getState().snapshot.controls.thinkingLevel, 'max');
  assert.deepEqual(live.getState().snapshot.controls.availableThinkingLevels, ['high', 'max']);
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
  send(1, {
    type: 'message_update',
    message: { ...partial, content: 'x'.repeat(EVENT_BUFFER_LIMIT) },
  });
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
