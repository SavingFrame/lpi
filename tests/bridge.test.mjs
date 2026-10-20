import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import { buildSessionContext } from '@earendil-works/pi-coding-agent';
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
      availableModels: [],
      model: null,
      thinkingLevel: 'off',
      availableThinkingLevels: [],
      contextUsage: null,
    },
    view: { ...emptyView(), messages: [entry.message] },
  };
  async function open(launchId) {
    const socket = new WebSocket(url);
    socket.on('error', () => {});
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'attach', launchId, session: identity, snapshot }));
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
  const renderers = new Map();
  const appended = [];
  const sent = [];
  const notifications = [];
  const statuses = new Map();
  const models = [
    { provider: 'fake', id: 'first', name: 'First', reasoning: false },
    {
      provider: 'fake',
      id: 'second',
      name: 'Second',
      reasoning: true,
      thinkingLevelMap: { minimal: null, xhigh: null, max: 'max' },
    },
  ];
  const state = {
    idle: true,
    pending: false,
    aborts: 0,
    shutdowns: 0,
    entries: [entry],
    thinkingLevel: 'off',
    authenticated: true,
  };
  const ctx = {
    mode: 'tui',
    cwd: header.cwd,
    model: models[0],
    modelRegistry: { getAvailable: () => models },
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
    shutdown: () => {
      state.shutdowns++;
      handlers.get('session_shutdown')?.({ type: 'session_shutdown' }, ctx);
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
    registerEntryRenderer: (name, renderer) => renderers.set(name, renderer),
    appendEntry: (customType, data) => {
      const custom = {
        type: 'custom',
        id: `custom-${appended.length}`,
        parentId: state.entries.at(-1).id,
        timestamp: header.timestamp,
        customType,
        data,
      };
      appended.push(custom);
      state.entries.push(custom);
    },
    getThinkingLevel: () => state.thinkingLevel,
    setThinkingLevel: (level) => {
      state.thinkingLevel = clampThinkingLevel(ctx.model, level);
    },
    setModel: async (model) => {
      if (!state.authenticated) {
        return false;
      }
      ctx.model = model;
      return true;
    },
    sendUserMessage: (message, options) => sent.push({ message, ...options }),
  };
  extension(pi);
  const emit = async (type, extra = {}) => handlers.get(type)?.({ type, ...extra }, ctx);
  return { ctx, emit, commands, renderers, appended, sent, state, notifications, statuses };
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
  assert.equal(fake.appended.length, 0);
  await fake.commands.get('pim-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  const offline = await inventory.snapshot(session.id);
  assert.equal(offline.state.bridgeConnected, false);
  assert.match(offline.view.notice, /may still be running/);
  await assert.rejects(
    bridges.command(session.id, generation, { type: 'prompt', message: 'Offline' }),
  );
});

test('model and thinking settings update native Pi and synchronize authoritative controls', async (t) => {
  const { defer, file, header, entry, url, bridges } = await setup(t);
  const previous = process.env.PIM_BRIDGE_URL;
  process.env.PIM_BRIDGE_URL = url;
  const fake = fakePi(header, file, entry);
  defer(async () => {
    await fake.emit('session_shutdown');
    if (previous === undefined) {
      delete process.env.PIM_BRIDGE_URL;
    } else {
      process.env.PIM_BRIDGE_URL = previous;
    }
  });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const modelCommand = { type: 'set_model', provider: 'fake', modelId: 'second' };
  const thinkingCommand = { type: 'set_thinking_level', level: 'xhigh' };
  assert.equal(bridges.snapshot(session.id).controls.availableModels.length, 2);
  assert.deepEqual(bridges.snapshot(session.id).controls.availableThinkingLevels, ['off']);
  await bridges.command(session.id, session.generation, modelCommand);
  assert.equal(fake.ctx.model.id, 'second');
  assert.equal(bridges.snapshot(session.id).controls.model.id, 'second');
  assert.deepEqual(bridges.snapshot(session.id).controls.availableThinkingLevels, [
    'off',
    'low',
    'medium',
    'high',
    'max',
  ]);
  assert.deepEqual(
    bridges.snapshot(session.id).controls.availableThinkingLevels,
    getSupportedThinkingLevels(fake.ctx.model),
  );
  await bridges.command(session.id, session.generation, thinkingCommand);
  assert.equal(bridges.snapshot(session.id).controls.thinkingLevel, 'max');
  await bridges.command(session.id, session.generation, {
    type: 'set_thinking_level',
    level: 'max',
  });
  assert.equal(bridges.snapshot(session.id).controls.thinkingLevel, 'max');
  await assert.rejects(bridges.command(session.id, session.generation - 1, modelCommand), /stale/);
  await assert.rejects(
    bridges.command(session.id, session.generation, { ...modelCommand, modelId: 'missing' }),
    /unavailable/,
  );
  fake.state.authenticated = false;
  await assert.rejects(
    bridges.command(session.id, session.generation, modelCommand),
    /authentication/,
  );
  fake.state.authenticated = true;
  for (const command of [modelCommand, thinkingCommand]) {
    fake.state.idle = false;
    await assert.rejects(bridges.command(session.id, session.generation, command), /idle/);
    fake.state.idle = true;
    fake.state.pending = true;
    await assert.rejects(bridges.command(session.id, session.generation, command), /queued/);
    fake.state.pending = false;
    await fake.emit('ui_prompt_start', { kind: 'confirm' });
    await assert.rejects(bridges.command(session.id, session.generation, command), /dialogs/);
    await fake.emit('ui_prompt_end');
  }
  await fake.commands.get('pim-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  await assert.rejects(
    bridges.command(session.id, session.generation, modelCommand),
    /unavailable/,
  );
});

test('stop runtime is rejected for externally launched Pi', async (t) => {
  const { open, bridges } = await setup(t);
  const { socket, attached } = await open();
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation, { type: 'stop_runtime' }),
    /Only Pim-managed/,
  );
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  socket.terminate();
});

for (const busy of [false, true]) {
  test(`stop runtime requests graceful shutdown without changing history (busy: ${busy})`, async (t) => {
    const { config, root, defer, file, header, entry, url, bridges } = await setup(t);
    const original = readFileSync(file);
    const keys = ['PIM_BRIDGE_URL', 'PIM_LAUNCH_ID', 'PIM_TMUX_SESSION', 'PATH'];
    const previous = keys.map((key) => process.env[key]);
    const launchId = '11111111-1111-1111-1111-111111111111';
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // Stub reservations only. Never contact a real tmux server in this test.
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.PIM_BRIDGE_URL = url;
    process.env.PIM_LAUNCH_ID = launchId;
    process.env.PIM_TMUX_SESSION = `pim-${launchId}`;
    const fake = fakePi(header, file, entry);
    defer(async () => {
      await fake.emit('session_shutdown');
      for (const [index, key] of keys.entries()) {
        if (previous[index] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[index];
        }
      }
    });
    fake.state.idle = !busy;
    fake.state.pending = busy;
    await fake.emit('session_start');
    await waitFor(() => bridges.list()[0]?.connection === 'connected');
    const session = bridges.list()[0];
    assert.equal(bridges.snapshot(session.id).state.managedRuntime, true);
    await assert.rejects(
      bridges.command(session.id, session.generation - 1, { type: 'stop_runtime' }),
      /stale/,
    );
    assert.equal(fake.state.shutdowns, 0);
    const response = await fetch(
      `http://127.0.0.1:${config.port}/sessions/${session.id}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'stop-runtime',
          generation: session.generation,
          command: { type: 'stop_runtime' },
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outcome, 'acknowledged');
    await waitFor(() => bridges.get(session.id).connection === 'disconnected');
    assert.equal(fake.state.aborts, 1);
    assert.equal(fake.state.shutdowns, 1);
    assert.deepEqual(readFileSync(file), original);
    await assert.rejects(
      bridges.command(session.id, session.generation, { type: 'stop_runtime' }),
      /unavailable|stale/,
    );
    assert.equal(fake.state.shutdowns, 1);
  });
}

test('browser images reach native Pi as structured user content, including image-only messages', async (t) => {
  const { config, defer, file, header, entry, url, bridges } = await setup(t);
  const previous = process.env.PIM_BRIDGE_URL;
  process.env.PIM_BRIDGE_URL = url;
  const fake = fakePi(header, file, entry);
  defer(async () => {
    await fake.emit('session_shutdown');
    if (previous === undefined) {
      delete process.env.PIM_BRIDGE_URL;
    } else {
      process.env.PIM_BRIDGE_URL = previous;
    }
  });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
    'base64',
  );
  // Valid PNG with trailing padding exercises requests beyond the former 1 MiB body limit.
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.concat([png, Buffer.alloc(800_000)]).toString('base64'),
  };
  for (const [index, type] of ['prompt', 'steer', 'follow_up'].entries()) {
    const message = index === 0 ? '' : 'Look at this screenshot';
    const images = index === 2 ? [image, image] : [image];
    const response = await fetch(
      `http://127.0.0.1:${config.port}/sessions/${session.id}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: `image-${index}`,
          generation: session.generation,
          command: { type, message, images },
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(fake.sent[index].message, [{ type: 'text', text: message }, ...images]);
    assert.equal(fake.sent[index].expandPromptTemplates, false);
    assert.equal(fake.appended.length, index + 1);
    assert.equal(fake.appended[index].customType, 'pim-image-attachments');
    assert.deepEqual(fake.appended[index].data, { count: images.length, mode: type });
  }
  assert.equal(fake.sent[1].deliverAs, 'steer');
  assert.equal(fake.sent[2].deliverAs, 'followUp');
  assert.deepEqual(buildSessionContext(fake.state.entries).messages, [entry.message]);

  // A fresh extension can render persisted metadata without the original image files or bytes.
  const reloaded = fakePi(header, file, entry);
  const render = reloaded.renderers.get('pim-image-attachments');
  const theme = { fg: (_color, text) => text };
  for (const [index, saved] of JSON.parse(JSON.stringify(fake.appended)).entries()) {
    const component = render(saved, { expanded: false }, theme);
    const label = [
      'Pim: 1 image submitted (prompt)',
      'Pim: 1 image submitted (steer)',
      'Pim: 2 images submitted (follow-up)',
    ][index];
    assert.deepEqual(component.render(80), [label]);
    assert.deepEqual(component.render(8), [label.slice(0, 8)]);
    component.invalidate();
    assert.deepEqual(component.render(80), [label]);
  }
  for (const data of [null, {}, { count: -1, mode: 'prompt' }, { count: 1, mode: 'bad' }]) {
    assert.equal(render({ data }, {}, theme), undefined);
  }
  fake.state.idle = false;
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'prompt',
      message: 'Busy image',
      images: [image],
    }),
    /busy/,
  );
  await bridges.command(session.id, session.generation, { type: 'abort' });
  assert.equal(fake.appended.length, 3);
});

test('image policy rejects unsupported types, malformed data, excess count and size', () => {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('\u0089PNG\r\n\u001a\n', 'latin1').toString('base64'),
  };
  assert.equal(bridgeCommand({ type: 'prompt', message: '', images: [image] }).images.length, 1);
  for (const images of [
    [{ ...image, mimeType: 'image/svg+xml' }],
    [{ ...image, data: '!invalid' }],
    [{ ...image, data: 'aGVsbG8=' }],
    Array(5).fill(image),
    [{ ...image, data: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64') }],
    'not-an-array',
  ]) {
    assert.throws(() => bridgeCommand({ type: 'prompt', message: 'Image', images }));
  }
  assert.throws(() => bridgeCommand({ type: 'prompt', message: '', images: [] }));
  assert.throws(() => bridgeCommand({ type: 'prompt', message: '/new', images: [image] }));
});

test('bridge rejection logs identify invalid fields and redact payload contents', async (t) => {
  const logs = [];
  t.mock.method(console, 'warn', (prefix, line) => {
    assert.equal(prefix, '[pim:bridge]');
    logs.push(JSON.parse(line));
  });
  const { url, identity, snapshot, open } = await setup(t);
  const secret = 'PRIVATE_TRANSCRIPT_AND_IMAGE_DATA';
  const invalid = structuredClone(snapshot);
  delete invalid.controls.availableThinkingLevels;
  invalid.view.messages[0].content = secret;
  const socket = new WebSocket(url);
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'attach', session: identity, snapshot: invalid }));
  assert.equal((await closed)[0], 1008);
  assert.equal(logs[0].event, 'rejected');
  assert.equal(logs[0].phase, 'registration');
  assert.equal(logs[0].frame, 'attach');
  assert.match(logs[0].reason, /controls.availableThinkingLevels/);
  assert.equal(typeof logs[0].connectionId, 'string');
  assert.ok(Number.isFinite(Date.parse(logs[0].timestamp)));

  const { socket: connected, attached } = await open();
  const connectedClosed = once(connected, 'close');
  connected.send(JSON.stringify({ type: 'event', event: { type: secret } }));
  assert.equal((await connectedClosed)[0], 1008);
  assert.equal(logs[1].phase, 'connected');
  assert.equal(logs[1].frame, 'event');
  assert.equal(logs[1].reason, 'Unsupported bridge event');
  assert.equal(logs[1].sessionId, attached.sessionId);
  assert.equal(logs[1].generation, attached.generation);

  const malformed = new WebSocket(url);
  await once(malformed, 'open');
  const malformedClosed = once(malformed, 'close');
  malformed.send(`${secret} is not JSON`);
  assert.equal((await malformedClosed)[0], 1008);
  assert.equal(logs[2].reason, 'Invalid JSON');
  assert.equal(logs[2].frame, 'unparsed');
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test('duplicate connections and stale generations are blocked; reloaded instances can reconnect', async (t) => {
  const logs = [];
  t.mock.method(console, 'warn', (_prefix, line) => logs.push(JSON.parse(line)));
  const { open, bridges, url, identity, snapshot } = await setup(t);
  const { socket, attached } = await open();
  const conflict = new WebSocket(url);
  conflict.on('error', () => {});
  await once(conflict, 'open');
  const conflictClosed = once(conflict, 'close');
  conflict.send(JSON.stringify({ type: 'attach', session: identity, snapshot }));
  assert.equal((await conflictClosed)[0], 1008);
  assert.equal(logs[0].phase, 'registration');
  assert.equal(logs[0].reason, 'Conflicting native connection or session identity');
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

test('empty native sessions stay visible while live but disappear after disconnect', async (t) => {
  const { open, bridges, inventory, snapshot, identity, file, root } = await setup(t);
  snapshot.view.messages = [];
  snapshot.state.sessionName = 'Named but empty';
  const { socket, attached } = await open();
  assert.equal(
    inventory.list().find((item) => item.id === attached.sessionId).title,
    'Named but empty',
  );
  socket.terminate();
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  // The saved discovery entry must not leak through behind the hidden native entry.
  assert.equal(
    inventory.list().some((item) => item.file === file),
    false,
  );

  // Reconnection and image-only history must not depend on a text-derived title.
  snapshot.state.sessionName = undefined;
  snapshot.view.messages = [
    {
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: 'image' }],
      timestamp: 1,
    },
  ];
  const reconnected = await open();
  assert.ok(inventory.list().some((item) => item.id === attached.sessionId));
  reconnected.socket.terminate();
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  assert.ok(inventory.list().some((item) => item.id === attached.sessionId));

  // A fresh session can attach before Pi creates its JSONL file.
  identity.file = join(root, 'never-written.jsonl');
  snapshot.view.messages = [];
  const fresh = await open();
  assert.ok(inventory.list().some((item) => item.id === fresh.attached.sessionId));
  fresh.socket.terminate();
  await waitFor(() => bridges.get(fresh.attached.sessionId).connection === 'disconnected');
  assert.equal(
    inventory.list().some((item) => item.id === fresh.attached.sessionId),
    false,
  );
});

test('launch correlation resolves only connected registrations and survives reconnect', async (t) => {
  const { open, bridges } = await setup(t);
  assert.equal(bridges.findLaunch('launch-1'), undefined);
  const first = await open('launch-1');
  assert.equal(bridges.findLaunch('launch-1').id, first.attached.sessionId);
  assert.equal(bridges.findLaunch('another-launch'), undefined);
  first.socket.terminate();
  await waitFor(() => bridges.findLaunch('launch-1') === undefined);
  const reconnected = await open('launch-1');
  assert.equal(bridges.findLaunch('launch-1').id, reconnected.attached.sessionId);
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

test('native command policy rejects slash commands, unsupported mutations and invalid settings', () => {
  for (const command of [
    { type: 'prompt', message: '/new' },
    { type: 'steer', message: '/compact' },
    { type: 'clear_queue' },
    { type: 'set_model', provider: '', modelId: 'fake' },
    { type: 'set_thinking_level', level: 'invalid' },
  ]) {
    assert.throws(() => bridgeCommand(command));
  }
});
