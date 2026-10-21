import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { EVENT_BUFFER_LIMIT } from '../../src/shared/attachments.ts';
import { boundary, id, otherId, partial, setup } from './live-fixture.mjs';

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
