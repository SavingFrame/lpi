import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createApi } from '../dist/api/http.js';
import { attachWebSockets } from '../dist/api/websocket.js';
import extension from '../dist/bridge/extension.js';
import { bridgeCommand } from '../dist/bridge/protocol.js';
import { NativeBridges } from '../dist/bridge/server.js';
import { emptyView } from '../dist/client-state.js';
import { Events } from '../dist/events.js';
import { Sessions } from '../dist/sessions.js';
import { SessionDiscovery } from '../dist/storage/discovery.js';
import { fixture } from './helpers.mjs';

async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) {
      return;
    }
    await delay(10);
  }
  assert.fail('Bridge condition did not become true');
}

async function setup(t, timeout = 1000) {
  const base = fixture(t);
  const { root, config, defer } = base;
  const sessions = join(root, 'home', '.pi', 'agent', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const file = join(sessions, 'native.jsonl');
  const header = {
    type: 'session',
    version: 3,
    id: 'native-pi-session',
    timestamp: '2026-01-01T00:00:00Z',
    cwd: config.projects[0].directory,
  };
  const entry = {
    type: 'message',
    id: 'first',
    parentId: null,
    timestamp: header.timestamp,
    message: { role: 'user', content: 'Original native history', timestamp: 1 },
  };
  writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
  const events = new Events();
  const discovery = new SessionDiscovery([sessions], config.projects);
  const bridges = new NativeBridges(config, events, timeout);
  const inventory = new Sessions(discovery, bridges, events);
  const api = createApi(config, inventory, bridges);
  const closeSockets = attachWebSockets(api, config, events, bridges);
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  config.port = api.address().port;
  defer(async () => {
    closeSockets();
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });
  const url = `ws://127.0.0.1:${config.port}/bridge`;
  const identity = { file, cwd: header.cwd, id: header.id, createdAt: header.timestamp };
  const snapshot = {
    state: { isStreaming: false, hasPendingMessages: false },
    controls: {
      model: null,
      thinkingLevel: 'off',
      contextUsage: null,
    },
    view: { ...emptyView(), messages: [entry.message] },
  };
  async function open() {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'attach', session: identity, snapshot }));
    const attached = JSON.parse(String((await response)[0]));
    return { socket, attached };
  }
  return {
    ...base,
    file,
    header,
    entry,
    identity,
    url,
    snapshot,
    open,
    inventory,
    bridges,
    events,
  };
}

function fakePi(header, file, entry) {
  const handlers = new Map();
  const commands = new Map();
  const sent = [];
  const notifications = [];
  const statuses = new Map();
  const state = { idle: true, pending: false, aborts: 0, entries: [entry] };
  const ctx = {
    mode: 'tui',
    cwd: header.cwd,
    sessionManager: {
      getSessionFile: () => file,
      getSessionId: () => header.id,
      getHeader: () => header,
      getBranch: () => state.entries,
      getSessionName: () => 'Native session',
    },
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    abort: () => {
      state.aborts++;
    },
    getContextUsage: () => undefined,
    ui: {
      setStatus: (key, value) => statuses.set(key, value),
      notify: (text) => notifications.push(text),
      confirm: async () => true,
    },
  };
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command.handler),
    getThinkingLevel: () => 'off',
    sendUserMessage: (message, options) => sent.push({ message, ...options }),
  };
  extension(pi);
  const emit = async (type, extra = {}) => handlers.get(type)?.({ type, ...extra }, ctx);
  return { ctx, emit, commands, sent, state, notifications, statuses };
}

test('native extension streams history, partial responses, tools and routes commands into the same runtime', async (t) => {
  const { config, defer, file, header, entry, url, inventory, bridges, events } = await setup(t);
  const original = readFileSync(file);
  const savedUrl = process.env.PIM_BRIDGE_URL;
  process.env.PIM_BRIDGE_URL = url;
  const fake = fakePi(header, file, entry);
  defer(async () => {
    await fake.emit('session_shutdown');
    if (savedUrl === undefined) {
      delete process.env.PIM_BRIDGE_URL;
    } else {
      process.env.PIM_BRIDGE_URL = savedUrl;
    }
  });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const generation = session.generation;
  assert.equal(inventory.list().filter((item) => item.file === file).length, 1);
  const initial = await inventory.snapshot(session.id);
  assert.equal(initial.state.nativeTui, true);
  assert.equal(initial.view.messages[0].content, 'Original native history');
  assert.equal(initial.session.connection, 'connected');
  assert.equal(initial.epoch, events.epoch);
  const response = await fetch(`http://127.0.0.1:${config.port}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'browser-prompt',
      generation,
      command: { type: 'prompt', message: 'Browser prompt' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.disposition, 'dispatched');
  assert.equal(fake.sent[0].message, 'Browser prompt');
  assert.equal(fake.sent[0].expandPromptTemplates, false);
  const duplicate = await fetch(`http://127.0.0.1:${config.port}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'browser-prompt',
      generation,
      command: { type: 'prompt', message: 'Browser prompt' },
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(fake.sent.length, 1);
  fake.state.idle = false;
  await fake.emit('agent_start');
  await fake.emit('message_start', { message: { role: 'assistant', timestamp: 2, content: [] } });
  await fake.emit('message_update', {
    message: { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Streaming' }] },
  });
  await waitFor(() => bridges.snapshot(session.id).view.partial?.content[0]?.text === 'Streaming');
  await fake.emit('tool_execution_start', {
    toolCallId: 'tool',
    toolName: 'read',
    args: { path: 'example' },
  });
  await waitFor(() => bridges.snapshot(session.id).view.tools.length === 1);
  assert.equal((await inventory.snapshot(session.id)).view.running, true);
  await bridges.command(session.id, generation, { type: 'steer', message: 'Focus' });
  await bridges.command(session.id, generation, { type: 'follow_up', message: 'Next task' });
  assert.equal(fake.sent[1].deliverAs, 'steer');
  assert.equal(fake.sent[2].deliverAs, 'followUp');
  await assert.rejects(
    bridges.command(session.id, generation, { type: 'prompt', message: 'Busy' }),
    /busy/,
  );
  await bridges.command(session.id, generation, { type: 'abort' });
  assert.equal(fake.state.aborts, 1);
  await fake.emit('ui_prompt_start', { kind: 'confirm' });
  await waitFor(() => bridges.snapshot(session.id).view.notice?.includes('terminal'));
  await fake.emit('ui_prompt_end', { kind: 'confirm' });
  await waitFor(() => bridges.snapshot(session.id).view.notice === null);
  fake.state.idle = true;
  await fake.emit('agent_settled');
  await waitFor(() => !bridges.snapshot(session.id).view.running);
  assert.deepEqual(readFileSync(file), original);
  await fake.commands.get('pim-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  const offline = await inventory.snapshot(session.id);
  assert.equal(offline.state.bridgeConnected, false);
  assert.match(offline.view.notice, /may still be running/);
  await assert.rejects(
    bridges.command(session.id, generation, { type: 'prompt', message: 'Offline' }),
  );
});

test('duplicate connections and stale generations are blocked; reloaded instances can reconnect', async (t) => {
  const { open, bridges, url, identity, snapshot } = await setup(t);
  const { socket, attached } = await open();
  const conflict = new WebSocket(url);
  conflict.on('error', () => {});
  await once(conflict, 'open');
  const conflictClosed = once(conflict, 'close');
  conflict.send(JSON.stringify({ type: 'attach', session: identity, snapshot }));
  assert.equal((await conflictClosed)[0], 1008);
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation - 1, { type: 'abort' }),
    /stale/,
  );
  socket.terminate();
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  const reconnected = await open();
  assert.ok(reconnected.attached.generation > attached.generation);
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  reconnected.socket.terminate();
});

test('lost acknowledgments are unknown and never replayed', async (t) => {
  const { open, bridges } = await setup(t, 50);
  const { socket, attached } = await open();
  let commands = 0;
  socket.on('message', () => commands++);
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation, {
      type: 'prompt',
      message: 'Uncertain',
    }),
    (error) => error.outcome === 'unknown',
  );
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  assert.equal(commands, 1);
  await assert.rejects(bridges.command(attached.sessionId, attached.generation, { type: 'abort' }));
  assert.equal(commands, 1);
});

test('bridge socket needs no token but rejects browser origins and unknown hosts', async (t) => {
  const { open, url } = await setup(t);
  const { socket: connected } = await open();
  connected.terminate();
  for (const headers of [
    { Origin: 'http://localhost:5173' },
    { Origin: 'https://evil.example' },
    { Host: 'evil.example' },
  ]) {
    const socket = new WebSocket(url, { headers });
    socket.on('error', () => {});
    const response = await once(socket, 'unexpected-response');
    assert.equal(response[1].statusCode, 403);
    response[1].resume();
    socket.terminate();
  }
});

test('native command policy rejects management, slash commands, and unsupported queue/settings mutations', () => {
  for (const command of [
    { type: 'prompt', message: '/new' },
    { type: 'steer', message: '/compact' },
    { type: 'clear_queue' },
    { type: 'set_model', provider: 'fake', modelId: 'fake' },
    { type: 'set_thinking_level', level: 'high' },
  ]) {
    assert.throws(() => bridgeCommand(command));
  }
});
