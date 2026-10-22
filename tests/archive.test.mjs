import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { SessionReadStore } from '../dist/src/storage/read-state.js';
import { setup, waitFor } from './bridge-fixture.mjs';
import { fixture } from './helpers.mjs';

test('archive metadata survives restarts independently of completions and restores durably', (t) => {
  const { root } = fixture(t);
  const path = join(root, 'pim.sqlite');
  let store = new SessionReadStore(path);
  const completion = store.complete('session');
  assert.equal(store.isArchived('session'), false);
  store.setArchived('session', true);
  store.setArchived('session', true);
  store.close();
  store = new SessionReadStore(path);
  assert.equal(store.isArchived('session'), true);
  assert.deepEqual(store.get('session'), completion);
  store.complete('session');
  assert.equal(store.isArchived('session'), true, 'new activity does not unarchive');
  store.setArchived('session', false);
  store.setArchived('session', false);
  store.close();
  store = new SessionReadStore(path);
  assert.equal(store.isArchived('session'), false);
  assert.equal(store.isArchived('unrelated'), false);
  store.close();
});

test('archive only blocks connected sessions, never inspects tmux, and broadcasts saved visibility without changing history', async (t) => {
  const base = await setup(t, 1000, async () =>
    assert.fail('Archive and inventory must not inspect tmux'),
  );
  const { socket, attached } = await base.open();
  base.defer(() => socket.terminate());
  const original = readFileSync(base.file);
  const id = attached.sessionId;
  const url = `http://127.0.0.1:${base.config.port}`;
  const clients = [];
  for (let index = 0; index < 2; index++) {
    const client = new WebSocket(`${url.replace('http:', 'ws:')}/events`);
    base.defer(() => client.terminate());
    const connected = once(client, 'message');
    await once(client, 'open');
    await connected;
    clients.push(client);
  }
  const commands = [];
  socket.on('message', (message) => commands.push(String(message)));
  let request = 0;
  const archive = (archived, sessionId = id) =>
    fetch(`${url}/sessions/${sessionId}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: `archive-${++request}`, archived }),
    });
  assert.equal(base.inventory.list()[0].archived, false);
  assert.equal((await archive(true)).status, 409, 'idle is still a live runtime');
  assert.equal(base.inventory.list()[0].archived, false);
  socket.close();
  await waitFor(() => base.inventory.get(id).connection === 'disconnected');
  const before = base.inventory.get(id);
  for (const archived of [true, true, false]) {
    const messages = clients.map((client) => once(client, 'message'));
    const response = await archive(archived);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { archived });
    for (const message of await Promise.all(messages)) {
      const event = JSON.parse(String(message[0]));
      assert.equal(event.type, 'archive-state');
      assert.equal(event.sessionId, id);
      assert.deepEqual(event.data, { archived });
    }
    const inventory = await (await fetch(`${url}/sessions`)).json();
    assert.equal(inventory.sessions[0].archived, archived);
    if (archived) {
      assert.throws(() => base.inventory.validateResume(id), /Restore this session/);
    }
    assert.deepEqual(base.inventory.get(id), before);
    assert.equal(base.inventory.snapshot(id).session.connection, 'disconnected');
  }
  assert.equal((await archive('true')).status, 400);
  assert.equal((await archive(true, '11111111-1111-1111-1111-111111111111')).status, 404);
  assert.deepEqual(readFileSync(base.file), original);
  assert.deepEqual(commands, []);
});
