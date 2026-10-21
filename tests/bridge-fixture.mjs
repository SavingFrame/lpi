import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { clampThinkingLevel } from '@earendil-works/pi-ai/models';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import { WebSocket } from 'ws';
import { createApi } from '../dist/api/http.js';
import { attachWebSockets } from '../dist/api/websocket.js';
import extension from '../dist/bridge/index.js';
import { NativeBridges } from '../dist/bridge/server.js';
import { Events } from '../dist/events.js';
import { Sessions } from '../dist/sessions.js';
import { emptyView } from '../dist/shared/client-state.js';
import { SessionDiscovery } from '../dist/storage/discovery.js';
import { SessionReadStore } from '../dist/storage/read-state.js';
import { fixture } from './helpers.mjs';

export async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) {
      return;
    }
    await delay(10);
  }
  assert.fail('Bridge condition did not become true');
}

export async function setup(t, timeout = 1000) {
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
  const inventory = new Sessions(discovery, bridges, events, new SessionReadStore(':memory:'));
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
      scopedModels: [],
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

export function fakePi(header, file, entry) {
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
    scopedModels: [{ model: models[1], thinkingLevel: 'high' }],
    modelRegistry: { getAvailable: () => models },
    sessionManager: {
      getSessionFile: () => file,
      getSessionId: () => header.id,
      getHeader: () => header,
      getBranch: () => state.entries,
      getLeafId: () => state.entries.at(-1)?.id ?? null,
      getEntry: (id) => state.entries.find((entry) => entry.id === id),
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
  const bus = createEventBus();
  const pi = {
    events: bus,
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
    sendUserMessage: (message, options) => {
      if (options?.expandPromptTemplates && message.startsWith('/pim-tree ')) {
        void commands.get('pim-tree')(message.split(' ')[1], ctx);
      } else {
        sent.push({ message, ...options });
      }
    },
  };
  extension(pi);
  const emit = async (type, extra = {}) => handlers.get(type)?.({ type, ...extra }, ctx);
  return { ctx, emit, bus, commands, renderers, appended, sent, state, notifications, statuses };
}

// Own the extension transport and environment for one fake-native integration test.
export function nativePi(base) {
  const previous = process.env.PIM_BRIDGE_URL;
  process.env.PIM_BRIDGE_URL = base.url;
  const fake = fakePi(base.header, base.file, base.entry);
  base.defer(async () => {
    try {
      await fake.emit('session_shutdown');
    } finally {
      fake.bus.clear();
      if (previous === undefined) {
        delete process.env.PIM_BRIDGE_URL;
      } else {
        process.env.PIM_BRIDGE_URL = previous;
      }
    }
  });
  return fake;
}
