import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { clientStorageKey } from '../../src/client/storage.ts';
import { emptyView } from '../../src/shared/client-state.ts';
import { MobileRelay } from '../src/lib/relay.ts';
import { eventsUrl, relayOrigin } from '../src/lib/server.ts';

const id = '11111111-1111-1111-1111-111111111111';
const project = { id: 'project', name: 'Project', directory: '/isolated/project' };
const session = {
  id,
  projectId: project.id,
  directory: project.directory,
  file: '/isolated/session.jsonl',
  createdAt: '2026-01-01T00:00:00Z',
  piSessionId: 'fake-native',
  connection: 'connected',
  generation: 1,
  activity: 'idle',
  readState: { completionId: null, viewedCompletionId: null },
};

function setup(t, origin = 'http://relay-one:3141', values = new Map()) {
  const sockets = [];
  const requests = [];
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  const client = new MobileRelay(origin, {
    storage,
    requestId: () => {
      throw new Error('Read-only scaffold must never issue mutations');
    },
    fetch: (url, request) =>
      new Promise((resolve) => {
        assert.equal(request.method, 'GET');
        requests.push({ url, request, resolve });
      }),
    openSocket: (url) => {
      const socket = {
        url,
        readyState: 1,
        onmessage: null,
        onerror: null,
        onclose: null,
        close() {
          this.readyState = 3;
          this.onclose?.();
        },
        send(data) {
          this.onmessage?.({ data: JSON.stringify(data) });
        },
      };
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => {
    client.stop();
    for (const request of requests) {
      request.resolve(Response.json({}));
    }
  });
  const connected = () =>
    sockets.at(-1).send({ type: 'connected', epoch: 'relay-epoch', cursor: 0 });
  const inventory = async (sessions = [session]) => {
    requests
      .findLast((request) => request.url.endsWith('/projects'))
      .resolve(Response.json({ projects: [project] }));
    requests
      .findLast((request) => request.url.endsWith('/sessions'))
      .resolve(Response.json({ sessions }));
    await setImmediate();
  };
  return { client, sockets, requests, storage, values, connected, inventory };
}

test('relay settings normalize origins and reject credentials, paths, and unsupported protocols', () => {
  assert.equal(relayOrigin(' HTTP://Relay-One:3141/ '), 'http://relay-one:3141');
  assert.equal(relayOrigin('https://relay.ts.net:443'), 'https://relay.ts.net');
  assert.equal(eventsUrl('https://relay.ts.net'), 'wss://relay.ts.net/events');
  assert.equal(eventsUrl('http://[::1]:3141'), 'ws://[::1]:3141/events');
  for (const value of [
    'relay-one:3141',
    'file:///tmp/pim',
    'https://user:secret@relay',
    'https://relay/proxy',
    'https://relay/?token=secret',
    'https://relay/#session',
  ]) {
    assert.throws(() => relayOrigin(value));
  }
});

test('restores an available selected session and loads through shared synchronization', async (t) => {
  const values = new Map([[clientStorageKey('http://relay-one:3141', 'selection', 'session'), id]]);
  const { client, sockets, requests, connected, inventory } = setup(t, undefined, values);
  await client.start();
  assert.equal(sockets[0].url, 'ws://relay-one:3141/events');
  assert.equal(requests.length, 0, 'subscribe before loading authoritative state');
  connected();
  await inventory();
  assert.equal(client.getState().selectedId, id);
  assert.equal(client.live.getState().status, 'syncing');
  requests
    .find((request) => request.url.endsWith('/snapshot'))
    .resolve(
      Response.json({
        epoch: 'relay-epoch',
        cursor: 0,
        session,
        readState: session.readState,
        state: { isStreaming: false, hasPendingMessages: false },
        view: emptyView(),
        controls: {
          availableModels: [],
          scopedModels: [],
          model: null,
          thinkingLevel: null,
          availableThinkingLevels: [],
          contextUsage: null,
        },
      }),
    );
  await setImmediate();
  assert.equal(client.live.getState().status, 'ready');
  assert.equal(client.live.getState().snapshot.session.id, id);
  assert.ok(requests.every((request) => new URL(request.url).origin === client.origin));
});

test('missing saved selection is not replaced by an arbitrary session', async (t) => {
  const values = new Map([
    [clientStorageKey('http://relay-one:3141', 'selection', 'session'), 'missing'],
  ]);
  const { client, requests, connected, inventory } = setup(t, undefined, values);
  await client.start();
  connected();
  await inventory();
  assert.equal(client.getState().selectedId, null);
  assert.equal(requests.length, 2);
});

test('suspension during settings hydration cannot open a socket afterward', async (t) => {
  const { client, storage, sockets } = setup(t);
  const read = Promise.withResolvers();
  storage.getItem = () => read.promise;
  const starting = client.start();
  client.stop();
  read.resolve(id);
  await starting;
  assert.equal(sockets.length, 0);
  assert.equal(client.live.getState().status, 'offline');
  await client.start();
  assert.equal(sockets.length, 1);
});

test('background HTTP results cannot replace state and foreground reconnects without mutations', async (t) => {
  const { client, sockets, connected, inventory } = setup(t);
  await client.start();
  connected();
  client.stop();
  await inventory();
  assert.deepEqual(client.getState().sessions, []);
  assert.equal(client.live.getState().status, 'offline');
  await client.start();
  connected();
  await inventory();
  assert.equal(sockets.length, 2);
  assert.equal(client.getState().sessions[0].id, id);
  assert.equal(client.getState().selectedId, null);
});

test('server switching isolates selection and outstanding requests', async (t) => {
  const values = new Map();
  const first = setup(t, 'http://relay-one:3141', values);
  const second = setup(t, 'http://relay-two:3141', values);
  await first.client.start();
  first.connected();
  await first.inventory();
  await first.client.select(id);
  first.client.stop();
  await second.client.start();
  second.connected();
  await second.inventory();
  assert.equal(second.client.getState().selectedId, null);
  assert.equal(values.get(clientStorageKey(first.client.origin, 'selection', 'session')), id);
  assert.equal(values.has(clientStorageKey(second.client.origin, 'selection', 'session')), false);
  assert.ok(first.requests.every((request) => new URL(request.url).origin === first.client.origin));
  assert.ok(
    second.requests.every((request) => new URL(request.url).origin === second.client.origin),
  );
});
