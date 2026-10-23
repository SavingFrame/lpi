import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { boundary, id, otherId, partial, setup } from './live-fixture.mjs';

test('revisited sessions render cached events while a fresh snapshot synchronizes', async (t) => {
  const { live, requests, sockets, send } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  send(1, {
    type: 'message_update',
    message: { ...partial, content: [{ type: 'text', text: 'Cached partial' }] },
  });
  const cached = live.getState().snapshot;
  live.select(null);
  live.select(otherId);
  assert.equal(live.getState().snapshot, null);
  requests[1].resolve(Response.json(boundary(1, otherId)));
  await setImmediate();
  live.select(null);
  live.select(id);
  assert.equal(live.getState().snapshot, cached);
  assert.equal(live.getState().status, 'syncing');
  assert.equal(sockets.length, 1);
  assert.equal(requests.length, 3);
  send(2, {
    type: 'message_update',
    message: { ...partial, content: [{ type: 'text', text: 'Fresh partial' }] },
  });
  assert.equal(live.getState().snapshot, cached);
  requests[2].resolve(Response.json(boundary(1)));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.cursor, 2);
  assert.equal(live.getState().snapshot.view.partial.content[0].text, 'Fresh partial');
});

test('late refresh cannot replace another cached selection', async (t) => {
  const { live, requests } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  live.select(otherId);
  requests[1].resolve(Response.json(boundary(0, otherId)));
  await setImmediate();
  const cached = live.getState().snapshot;
  live.select(id);
  live.select(otherId);
  assert.equal(requests[2].options.signal.aborted, true);
  requests[2].resolve(Response.json(boundary(20)));
  await setImmediate();
  assert.equal(live.getState().snapshot, cached);
  assert.equal(live.getState().status, 'syncing');
  requests[3].resolve(Response.json(boundary(21, otherId)));
  await setImmediate();
  assert.equal(live.getState().snapshot.cursor, 21);
});

test('reconnect drops inactive caches before session selection', async (t) => {
  const { live, requests, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  live.select(otherId);
  requests[1].resolve(Response.json(boundary(0, otherId)));
  await setImmediate();
  sockets[0].close();
  live.connect();
  sockets[1].send({ type: 'connected', epoch: 'server-two', cursor: 0 });
  live.select(id);
  assert.equal(live.getState().snapshot, null);
  assert.equal(live.getState().status, 'syncing');
  requests[3].resolve(Response.json(boundary(0, id, 'server-two')));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
});

test('cached saved sessions are ready immediately without another snapshot request', async (t) => {
  const { live, requests } = setup(t);
  const saved = boundary();
  saved.session.connection = 'disconnected';
  requests[0].resolve(Response.json(saved));
  await setImmediate();
  const cached = live.getState().snapshot;
  live.select(null);
  live.select(id);
  assert.equal(live.getState().snapshot, cached);
  assert.equal(live.getState().status, 'ready');
  assert.equal(requests.length, 1);
  live.refresh();
  assert.equal(live.getState().status, 'syncing');
  assert.equal(requests.length, 2);
  live.select(null);
  live.select(id);
  assert.equal(live.getState().snapshot, cached);
  assert.equal(live.getState().status, 'syncing');
  assert.equal(requests.length, 3);
});

test('live history stays visible across effect cleanup and setup during refresh', async (t) => {
  const { live, requests } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  const cached = live.getState().snapshot;
  live.select(null);
  live.select(id);
  assert.equal(live.getState().snapshot, cached);
  live.select(null);
  live.select(id);
  assert.equal(live.getState().snapshot, cached);
  assert.equal(live.getState().status, 'syncing');
  assert.equal(requests[1].options.signal.aborted, true);
  requests[2].resolve(Response.json(boundary(1)));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
});

for (const type of ['connection', 'bridge-sync', 'read-state']) {
  test(`${type} invalidates inactive saved history without eagerly fetching it`, async (t) => {
    const { live, requests, sockets } = setup(t);
    const saved = boundary();
    saved.session.connection = 'disconnected';
    requests[0].resolve(Response.json(saved));
    await setImmediate();
    live.select(null);
    sockets[0].send({
      epoch: 'server-one',
      cursor: 1,
      sessionId: id,
      generation: type === 'connection' ? 4 : 3,
      type,
      data: null,
    });
    assert.equal(requests.length, 1);
    live.select(id);
    assert.equal(live.getState().snapshot, null);
    assert.equal(live.getState().status, 'syncing');
    assert.equal(requests.length, 2);
    const fresh = boundary(1);
    if (type === 'connection') {
      fresh.session.generation = 4;
    }
    requests[1].resolve(Response.json(fresh));
    await setImmediate();
    assert.equal(live.getState().status, 'ready');
    assert.equal(live.getState().snapshot.session.connection, 'connected');
  });
}

test('reconnecting revalidates saved history even when the relay epoch is unchanged', async (t) => {
  const { live, requests, sockets } = setup(t);
  const saved = boundary();
  saved.session.connection = 'disconnected';
  requests[0].resolve(Response.json(saved));
  await setImmediate();
  live.select(null);
  sockets[0].close();
  live.connect();
  sockets[1].send({ type: 'connected', epoch: 'server-one', cursor: 0 });
  live.select(id);
  assert.equal(live.getState().status, 'syncing');
  assert.equal(live.getState().snapshot, null);
  assert.equal(requests.length, 2);
});

test('connection events revalidate the selected saved session immediately', async (t) => {
  const { live, requests, sockets } = setup(t);
  const saved = boundary();
  saved.session.connection = 'disconnected';
  requests[0].resolve(Response.json(saved));
  await setImmediate();
  live.select(null);
  live.select(id);
  sockets[0].send({
    epoch: 'server-one',
    cursor: 1,
    sessionId: id,
    generation: 4,
    type: 'connection',
    data: null,
  });
  assert.equal(live.getState().status, 'syncing');
  assert.equal(requests.length, 2);
  const fresh = boundary(1);
  fresh.session.generation = 4;
  requests[1].resolve(Response.json(fresh));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.session.connection, 'connected');
});

test('history cache evicts the least recently selected session', async (t) => {
  const { live, requests } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  live.select(otherId);
  requests[1].resolve(Response.json(boundary(0, otherId)));
  await setImmediate();
  live.select(id);
  requests[2].resolve(Response.json(boundary()));
  await setImmediate();
  for (let index = 0; index < 7; index++) {
    const sessionId = `33333333-3333-3333-3333-${String(index).padStart(12, '0')}`;
    live.select(sessionId);
    requests.at(-1).resolve(Response.json(boundary(0, sessionId)));
    await setImmediate();
  }
  live.select(id);
  assert.equal(live.getState().snapshot.session.id, id);
  live.select(otherId);
  assert.equal(live.getState().snapshot, null);
});
