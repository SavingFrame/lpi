import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createApi } from '../dist/api/http.js';
import { attachWebSockets } from '../dist/api/websocket.js';
import { NativeBridges } from '../dist/bridge/server.js';
import { Events } from '../dist/events.js';
import { Sessions } from '../dist/sessions.js';
import { hasUnreadCompletion } from '../dist/shared/session-read-state.js';
import { SessionDiscovery } from '../dist/storage/discovery.js';
import { SessionReadStore } from '../dist/storage/read-state.js';
import { fixture } from './helpers.mjs';

test('SQLite completion and read state persist across restarts without importing old history', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'pim.sqlite');
  let store = new SessionReadStore(path);
  assert.deepEqual(store.get('saved-session'), { completionId: null, viewedCompletionId: null });
  assert.equal(hasUnreadCompletion(store.get('saved-session')), false);
  const first = store.complete('saved-session');
  assert.equal(hasUnreadCompletion(first), true);
  store.close();
  store = new SessionReadStore(path);
  assert.deepEqual(store.get('saved-session'), first);
  const viewed = store.markViewed('saved-session', first.completionId);
  assert.equal(hasUnreadCompletion(viewed), false);
  store.close();
  store = new SessionReadStore(path);
  assert.deepEqual(store.get('saved-session'), viewed);
  store.close();
});

test('two SQLite clients cannot acknowledge a newer completion or regress viewed state', (t) => {
  const { root, defer } = fixture(t);
  const path = join(root, 'pim.sqlite');
  const desktop = new SessionReadStore(path);
  const mobile = new SessionReadStore(path);
  defer(() => desktop.close());
  defer(() => mobile.close());
  const old = desktop.complete('session');
  const latest = mobile.complete('session');
  assert.notEqual(old.completionId, latest.completionId);
  assert.equal(hasUnreadCompletion(desktop.markViewed('session', old.completionId)), true);
  const viewed = mobile.markViewed('session', latest.completionId);
  assert.equal(hasUnreadCompletion(viewed), false);
  assert.deepEqual(desktop.markViewed('session', old.completionId), viewed);
  assert.deepEqual(desktop.markViewed('session', latest.completionId), viewed);
  assert.deepEqual(mobile.get('unrelated'), { completionId: null, viewedCompletionId: null });
});

test('read API broadcasts shared metadata to both clients and never modifies Pi history', async (t) => {
  const { root, config, defer } = fixture(t);
  const file = join(root, 'saved.jsonl');
  const entries = [
    {
      type: 'session',
      version: 3,
      id: 'pi-session',
      cwd: config.projects[0].directory,
      timestamp: '2026-01-01T00:00:00Z',
    },
    {
      type: 'message',
      id: 'user',
      parentId: null,
      timestamp: '2026-01-01T00:00:00Z',
      message: { role: 'user', content: 'Existing history', timestamp: 1 },
    },
  ];
  writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const original = readFileSync(file);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const store = new SessionReadStore(join(root, 'pim.sqlite'));
  const inventory = new Sessions(
    new SessionDiscovery([root], config.projects),
    bridges,
    events,
    store,
  );
  const server = createApi(config, inventory, bridges);
  const closeSockets = attachWebSockets(server, config, events, bridges);
  defer(async () => {
    closeSockets();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const id = inventory.list()[0].id;
  assert.equal(hasUnreadCompletion(inventory.list()[0].readState), false);
  const clients = [];
  for (let index = 0; index < 2; index++) {
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/events`);
    const connected = once(socket, 'message');
    await once(socket, 'open');
    await connected;
    clients.push(socket);
  }
  const complete = async () => {
    const received = clients.map((client) => once(client, 'message'));
    events.publish(id, 0, 'pi-event', { type: 'agent_settled' });
    await Promise.all(received);
    return inventory.snapshot(id).readState.completionId;
  };
  const first = await complete();
  const latest = await complete();
  let request = 0;
  const view = (completionId, sessionId = id) =>
    fetch(`${base}/sessions/${sessionId}/viewed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: `view-${++request}`, completionId }),
    });
  const broadcasts = clients.map((client) => once(client, 'message'));
  const response = await view(latest);
  assert.equal(response.status, 200);
  const state = (await response.json()).data.readState;
  assert.equal(state.viewedCompletionId, latest);
  for (const received of await Promise.all(broadcasts)) {
    const event = JSON.parse(String(received[0]));
    assert.equal(event.type, 'read-state');
    assert.deepEqual(event.data, state);
  }
  assert.deepEqual((await (await view(first)).json()).data.readState, state);
  assert.deepEqual((await (await view(latest)).json()).data.readState, state);
  assert.equal((await view(null)).status, 400);
  assert.equal((await view(latest, '11111111-1111-1111-1111-111111111111')).status, 404);
  const list = await (await fetch(`${base}/sessions`)).json();
  assert.deepEqual(list.sessions[0].readState, state);
  assert.deepEqual(
    (await (await fetch(`${base}/sessions/${id}/snapshot`)).json()).readState,
    state,
  );
  assert.deepEqual(readFileSync(file), original);
});
