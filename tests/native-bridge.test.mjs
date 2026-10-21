import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { WebSocketServer } from 'ws';
import extension from '../dist/bridge/extension.js';
import { NativeCommands } from '../dist/bridge/native/commands.js';
import { NativeState } from '../dist/bridge/native/state.js';
import { NativeTransport } from '../dist/bridge/native/transport.js';
import { BRIDGE_LIMIT } from '../dist/bridge/protocol.js';
import { ASK_PROMPT } from '../dist/extension-support/ask-user-question/contract.js';
import { prompt as askPrompt } from '../src/extension-support/ask-user-question/tests/fixtures.mjs';
import { fixture } from './helpers.mjs';

async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) {
      return;
    }
    await delay(10);
  }
  assert.fail('Native bridge condition did not become true');
}

function setup(t) {
  const base = fixture(t);
  const keys = ['HOME', 'PI_CODING_AGENT_DIR', 'PIM_LAUNCH_ID', 'PIM_TMUX_SESSION'];
  const previous = keys.map((key) => process.env[key]);
  process.env.HOME = base.home;
  process.env.PI_CODING_AGENT_DIR = join(base.home, '.pi', 'agent');
  delete process.env.PIM_LAUNCH_ID;
  delete process.env.PIM_TMUX_SESSION;
  base.defer(() => {
    for (const [index, key] of keys.entries()) {
      if (previous[index] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[index];
      }
    }
  });
  const handlers = new Map();
  const registered = new Map();
  const sent = [];
  const entries = [];
  const model = { provider: 'fake', id: 'first', name: 'First', reasoning: false };
  let file = join(base.root, 'native.jsonl');
  let sessionId = 'native';
  const context = {
    mode: 'tui',
    cwd: base.config.projects[0].directory,
    model,
    scopedModels: [],
    modelRegistry: { getAvailable: () => [model] },
    sessionManager: {
      getSessionFile: () => file,
      getSessionId: () => sessionId,
      getHeader: () => ({ timestamp: '2026-01-01T00:00:00Z' }),
      getBranch: () => entries,
      getSessionName: () => 'Native test',
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    getContextUsage: () => undefined,
    abort() {},
    shutdown() {},
    ui: { setStatus() {}, notify() {}, confirm: async () => true },
  };
  const pi = {
    events: createEventBus(),
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, options) => registered.set(name, options.handler),
    registerEntryRenderer() {},
    getThinkingLevel: () => 'off',
    setThinkingLevel() {},
    setModel: async () => true,
    sendUserMessage: (message) => sent.push(message),
    appendEntry() {},
  };
  const state = new NativeState(pi);
  const commands = new NativeCommands(pi, state);
  const transport = new NativeTransport(state, commands);
  const forward = (event, ctx = context) => {
    if (state.observe(event, ctx)) {
      transport.forward(event);
    }
  };
  state.open(context, forward);
  base.defer(() => {
    transport.stop();
    state.dispose();
    pi.events.clear();
  });
  return {
    ...base,
    pi,
    context,
    state,
    commands,
    transport,
    forward,
    handlers,
    registered,
    sent,
    entries,
    switchIdentity(nextFile, nextId) {
      file = nextFile;
      sessionId = nextId;
    },
  };
}

async function relay(base) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  base.defer(async () => {
    for (const socket of server.clients) {
      socket.terminate();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  base.transport.url = `ws://127.0.0.1:${server.address().port}/bridge`;
  let generation = 0;
  async function connect() {
    const opened = once(server, 'connection');
    base.transport.start();
    const [socket] = await opened;
    const frames = [];
    socket.on('message', (data) => frames.push(JSON.parse(String(data))));
    await waitFor(() => frames.some((frame) => frame.type === 'attach'));
    socket.send(JSON.stringify({ type: 'attached', generation: ++generation }));
    await waitFor(() => frames.some((frame) => frame.type === 'sync'));
    return { socket, frames, generation };
  }
  return { connect };
}

test('extension load and non-TUI session hooks never start transport resources', async (t) => {
  const base = setup(t);
  t.mock.method(globalThis, 'setInterval', () => assert.fail('Unexpected interval'));
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('Unexpected timeout'));
  extension(base.pi);
  for (const mode of ['rpc', 'json', 'print']) {
    const context = { ...base.context, mode };
    await base.handlers.get('session_start')({ type: 'session_start' }, context);
    await base.registered.get('pim-connect')('', context);
    await base.handlers.get('session_shutdown')({ type: 'session_shutdown' }, context);
  }
});

test('native state snapshots rebuild branch history while preserving offline transient state', (t) => {
  const { state, context, forward, entries, transport } = setup(t);
  const message = { role: 'user', timestamp: 1, content: 'Current branch' };
  entries.push({ type: 'message', id: 'first', parentId: null, message });
  const partial = { role: 'assistant', timestamp: 2, content: 'Still working' };
  forward({ type: 'agent_start' });
  forward({ type: 'message_update', message: partial });
  forward({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: {} });
  transport.stop();
  state.resume(context);
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.view.messages, [message]);
  assert.deepEqual(snapshot.view.partial, partial);
  assert.equal(snapshot.view.tools[0].id, 'read-1');
  assert.deepEqual(state.view.messages, []);
  entries.length = 0;
  assert.deepEqual(state.snapshot().view.messages, []);
});

test('session replacement clears transients and support state, unlike a transport stop', (t) => {
  const { state, context, pi, forward, transport } = setup(t);
  pi.events.emit(ASK_PROMPT, askPrompt());
  forward({ type: 'message_update', message: { role: 'assistant', timestamp: 2, content: [] } });
  state.prompt('confirm', context);
  transport.stop();
  assert.equal(state.view.extensions['ask-user-question'].length, 1);
  assert.ok(state.view.partial);
  assert.match(state.view.notice, /supported questions/);
  state.open(context, forward);
  assert.deepEqual(state.view.extensions, {});
  assert.equal(state.view.partial, null);
  assert.equal(state.view.notice, null);
  state.prompt('confirm', context);
  assert.match(state.view.notice, /confirm/);
  state.prompt(null, context);
  assert.equal(state.view.notice, null);
  state.dispose();
  state.dispose();
  pi.events.emit(ASK_PROMPT, askPrompt());
  assert.equal(state.extensions, undefined);
});

test('native dispatch checks generations and both identities before calling Pi, consuming IDs', async (t) => {
  const base = setup(t);
  const connection = { generation: 3, session: base.state.identity() };
  const frame = { id: 'stale', generation: 2, command: { type: 'prompt', message: 'Hello' } };
  const rejected = await base.commands.execute(frame, connection);
  assert.equal(rejected.outcome, 'rejected');
  assert.match(rejected.error, /Stale/);
  await assert.rejects(base.commands.execute({ ...frame, generation: 3 }, connection), /Duplicate/);
  for (const [file, id] of [
    [join(base.root, 'different.jsonl'), connection.session.id],
    [connection.session.file, 'different-id'],
  ]) {
    base.switchIdentity(file, id);
    const result = await base.commands.execute({ ...frame, id, generation: 3 }, connection);
    assert.equal(result.outcome, 'rejected');
    assert.match(result.error, /Stale/);
  }
  assert.deepEqual(base.sent, []);
});

test('settings changes guard concurrent commands and dispatch failures remain uncertain', async (t) => {
  const base = setup(t);
  const connection = { generation: 3, session: base.state.identity() };
  let finish;
  base.pi.setModel = () => new Promise((resolve) => (finish = resolve));
  const pending = base.commands.execute(
    {
      id: 'model',
      generation: 3,
      command: { type: 'set_model', provider: 'fake', modelId: 'first' },
    },
    connection,
  );
  const blocked = await base.commands.execute(
    { id: 'prompt', generation: 3, command: { type: 'prompt', message: 'Blocked' } },
    connection,
  );
  assert.equal(blocked.outcome, 'rejected');
  assert.match(blocked.error, /settings change/);
  finish(true);
  assert.deepEqual(await pending, { id: 'model', outcome: 'acknowledged', sync: true });
  base.pi.sendUserMessage = () => {
    throw new Error('Dispatch interrupted');
  };
  await assert.rejects(
    base.commands.execute(
      { id: 'unknown', generation: 3, command: { type: 'prompt', message: 'Uncertain' } },
      connection,
    ),
    /Dispatch interrupted/,
  );
});

test('transport flushes partials before terminal events and snapshots discard their pending timer', async (t) => {
  const base = setup(t);
  const { connect } = await relay(base);
  const { frames } = await connect();
  const partial = { role: 'assistant', timestamp: 2, content: 'Latest partial' };
  base.forward({ type: 'message_update', message: { ...partial, content: 'Older partial' } });
  base.forward({ type: 'message_update', message: partial });
  base.forward({ type: 'message_end', message: { ...partial, content: 'Final' } });
  await waitFor(() => frames.filter((frame) => frame.type === 'event').length === 2);
  assert.deepEqual(
    frames.filter((frame) => frame.type === 'event').map((frame) => frame.event.type),
    ['message_update', 'message_end'],
  );
  assert.equal(
    frames.find((frame) => frame.type === 'event').event.message.content,
    'Latest partial',
  );
  base.forward({ type: 'message_update', message: partial });
  base.transport.sync();
  await waitFor(() => frames.filter((frame) => frame.type === 'sync').length === 2);
  await delay(70);
  assert.equal(frames.filter((frame) => frame.type === 'event').length, 2);
  assert.equal(
    frames.filter((frame) => frame.type === 'sync')[1].snapshot.view.partial.content,
    'Latest partial',
  );
});

test('oversized outbound snapshots disconnect without discarding native transient state', async (t) => {
  const base = setup(t);
  const { connect } = await relay(base);
  const { socket, frames } = await connect();
  const closed = once(socket, 'close');
  base.forward({
    type: 'message_update',
    message: { role: 'assistant', timestamp: 2, content: 'x'.repeat(BRIDGE_LIMIT) },
  });
  base.transport.sync();
  await closed;
  assert.equal(frames.filter((frame) => frame.type === 'sync').length, 1);
  assert.equal(base.state.view.partial.content.length, BRIDGE_LIMIT);
});

test('dispatch exceptions close the connection without rejection or automatic replay', async (t) => {
  const base = setup(t);
  const { connect } = await relay(base);
  const original = await connect();
  let calls = 0;
  base.pi.sendUserMessage = () => {
    calls++;
    throw new Error('Interrupted after dispatch');
  };
  const closed = once(original.socket, 'close');
  original.socket.send(
    JSON.stringify({
      type: 'command',
      id: 'uncertain',
      generation: original.generation,
      command: { type: 'prompt', message: 'Do not replay' },
    }),
  );
  await closed;
  assert.equal(
    original.frames.some((frame) => frame.type === 'ack'),
    false,
  );
  await connect();
  assert.equal(calls, 1);
});

test('late model acceptance never acknowledges or syncs a replacement connection', async (t) => {
  const base = setup(t);
  const { connect } = await relay(base);
  const original = await connect();
  let finish;
  base.pi.setModel = () => new Promise((resolve) => (finish = resolve));
  original.socket.send(
    JSON.stringify({
      type: 'command',
      id: 'old-model',
      generation: original.generation,
      command: { type: 'set_model', provider: 'fake', modelId: 'first' },
    }),
  );
  await waitFor(() => finish !== undefined);
  const replacement = await connect();
  finish(true);
  replacement.socket.send(
    JSON.stringify({
      type: 'command',
      id: 'new-prompt',
      generation: replacement.generation,
      command: { type: 'prompt', message: 'New connection' },
    }),
  );
  await waitFor(() => replacement.frames.some((frame) => frame.type === 'ack'));
  assert.deepEqual(
    replacement.frames.filter((frame) => frame.type === 'ack').map((frame) => frame.id),
    ['new-prompt'],
  );
  assert.equal(replacement.frames.filter((frame) => frame.type === 'sync').length, 1);
  assert.deepEqual(base.sent, ['New connection']);
});
