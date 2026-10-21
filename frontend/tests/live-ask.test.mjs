import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { prompt as askPrompt } from '../../src/extension-support/ask-user-question/tests/fixtures.mjs';
import { sessionActivity } from '../../src/shared/session-activity.ts';
import { snapshot as parseSnapshot } from '../../src/shared/snapshots.ts';
import { boundary, partial, setup } from './live-fixture.mjs';

test('Ask browser state applies open and close events without reloading the conversation', async (t) => {
  const { live, requests, send } = setup(t);
  const native = boundary();
  native.view.partial = partial;
  requests[0].resolve(Response.json(native));
  await setImmediate();
  const previous = live.getState().snapshot.view;
  send(1, {
    type: 'extension_support',
    extensions: { 'ask-user-question': [askPrompt(), askPrompt('second')] },
    notice: 'Answer supported questions below or in the terminal.',
  });
  const current = live.getState().snapshot;
  assert.equal(current.view.extensions['ask-user-question'].length, 2);
  assert.equal(current.view.messages, previous.messages);
  assert.equal(current.view.partial, previous.partial);
  assert.equal(sessionActivity(true, current.state, current.view), 'blocked');
  assert.equal(requests.length, 1);
  send(2, {
    type: 'extension_support',
    extensions: { 'ask-user-question': [askPrompt('second')] },
    notice: 'Waiting',
  });
  assert.equal(
    live.getState().snapshot.view.extensions['ask-user-question'][0].toolCallId,
    'second',
  );
  send(3, { type: 'extension_support', extensions: {}, notice: null });
  assert.deepEqual(live.getState().snapshot.view.extensions, {});
  assert.equal(live.getState().snapshot.state.pendingDialog, null);
  assert.equal(requests.length, 1);
});

test('Ask closure buffered during snapshot loading cannot reopen a stale questionnaire', async (t) => {
  const { live, requests, send } = setup(t);
  send(1, { type: 'extension_support', extensions: {}, notice: null });
  const native = boundary();
  native.view.extensions = { 'ask-user-question': [askPrompt()] };
  native.view.notice = 'Waiting for input';
  requests[0].resolve(Response.json(native));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.deepEqual(live.getState().snapshot.view.extensions, {});
  assert.equal(live.getState().snapshot.view.notice, null);
  assert.equal(live.getState().snapshot.cursor, 1);
});

test('Ask pending questions restore after reconnect but remain unavailable until synchronization completes', async (t) => {
  const { live, requests, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  sockets[0].close();
  assert.equal(live.getState().status, 'offline');
  live.connect();
  sockets[1].send({ type: 'connected', epoch: 'server-one', cursor: 1 });
  assert.equal(live.getState().status, 'syncing');
  const native = boundary(1);
  native.session.generation = 5;
  native.view.extensions = { 'ask-user-question': [askPrompt()] };
  requests[1].resolve(Response.json(native));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.session.generation, 5);
  assert.deepEqual(live.getState().snapshot.view.extensions, native.view.extensions);
});

test('Ask malformed or unregistered extension state never becomes an actionable browser form', async (t) => {
  const { live, requests, send } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  const previous = live.getState().snapshot;
  send(1, { type: 'extension_support', extensions: { arbitrary: [] }, notice: null });
  assert.equal(live.getState().status, 'offline');
  assert.equal(live.getState().snapshot, previous);
  const native = boundary();
  native.view.extensions = { 'ask-user-question': [askPrompt(), askPrompt()] };
  assert.throws(() => parseSnapshot(native));
});
