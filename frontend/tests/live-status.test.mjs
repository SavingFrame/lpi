import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { boundary, id, otherId, partial, setup } from './live-fixture.mjs';

test('unselected session activity refreshes inventory without loading its transcript', async (t) => {
  const { live, requests, sockets, invalidations } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  const initial = invalidations();
  const events = [
    ['pi-event', { type: 'agent_start' }],
    ['bridge-status', null],
    ['pi-event', { type: 'agent_settled' }],
    ['bridge-sync', null],
    ['pi-event', { type: 'compaction_start' }],
    ['pi-event', { type: 'compaction_end' }],
  ];
  for (const [index, [type, data]] of events.entries()) {
    sockets[0].send({
      epoch: 'server-one',
      cursor: index + 1,
      sessionId: otherId,
      generation: 1,
      type,
      data,
    });
  }
  assert.equal(invalidations(), initial + events.length);
  assert.equal(requests.length, 1);
  assert.equal(live.getState().snapshot.session.id, id);
});

test('native status updates controls, queue and notices without fetching history', async (t) => {
  const { live, requests, send, sockets } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  send(1, { type: 'message_update', message: partial });
  const previous = live.getState().snapshot.view;
  const updated = boundary();
  updated.controls.thinkingLevel = 'max';
  updated.controls.availableThinkingLevels = ['high', 'max'];
  updated.controls.model = { provider: 'fake', id: 'second', name: 'Second' };
  updated.controls.contextUsage.percent = 50;
  updated.state.hasPendingMessages = true;
  updated.state.pendingDialog = 'Answer in terminal';
  sockets[0].send({
    epoch: 'server-one',
    cursor: 2,
    sessionId: id,
    generation: 3,
    type: 'bridge-status',
    data: { state: updated.state, controls: updated.controls, notice: updated.state.pendingDialog },
  });
  const current = live.getState().snapshot;
  assert.equal(live.getState().status, 'ready');
  assert.equal(current.cursor, 2);
  assert.equal(current.controls.thinkingLevel, 'max');
  assert.deepEqual(current.controls.availableThinkingLevels, ['high', 'max']);
  assert.equal(current.controls.model.id, 'second');
  assert.equal(current.controls.contextUsage.percent, 50);
  assert.equal(current.state.hasPendingMessages, true);
  assert.equal(current.view.notice, 'Answer in terminal');
  assert.equal(current.view.messages, previous.messages);
  assert.equal(current.view.partial, previous.partial);
  assert.equal(current.view.tools, previous.tools);
  assert.equal(requests.length, 1);
});

test('run and compaction lifecycle events update locally without fetching snapshots', async (t) => {
  const { live, requests, send } = setup(t);
  requests[0].resolve(Response.json(boundary()));
  await setImmediate();
  send(1, { type: 'agent_start' });
  send(2, { type: 'compaction_start' });
  assert.equal(live.getState().snapshot.state.isStreaming, true);
  assert.equal(live.getState().snapshot.view.compacting, true);
  send(3, { type: 'message_update', message: partial });
  send(4, { type: 'tool_execution_start', toolCallId: 'call', toolName: 'read' });
  send(5, { type: 'agent_settled' });
  send(6, { type: 'compaction_end' });
  const current = live.getState().snapshot;
  assert.equal(live.getState().status, 'ready');
  assert.equal(current.cursor, 6);
  assert.equal(current.state.isStreaming, false);
  assert.equal(current.view.running, false);
  assert.equal(current.view.compacting, false);
  assert.equal(current.view.partial, null);
  assert.deepEqual(current.view.tools, []);
  assert.equal(requests.length, 1);
});

test('buffered status updates respect snapshot cursors without another fetch', async (t) => {
  const { live, requests, sockets } = setup(t);
  for (const cursor of [1, 2]) {
    const updated = boundary();
    updated.state.hasPendingMessages = cursor === 2;
    sockets[0].send({
      epoch: 'server-one',
      cursor,
      sessionId: id,
      generation: 3,
      type: 'bridge-status',
      data: { state: updated.state, controls: updated.controls, notice: null },
    });
  }
  requests[0].resolve(Response.json(boundary(1)));
  await setImmediate();
  assert.equal(live.getState().status, 'ready');
  assert.equal(live.getState().snapshot.cursor, 2);
  assert.equal(live.getState().snapshot.state.hasPendingMessages, true);
  assert.equal(requests.length, 1);
});

for (const invalid of [
  { state: {}, controls: boundary().controls, notice: null },
  { state: boundary().state, controls: {}, notice: null },
  { state: boundary().state, controls: boundary().controls, notice: 42 },
]) {
  test('invalid status payload closes the stream without applying it', async (t) => {
    const { live, requests, sockets } = setup(t);
    requests[0].resolve(Response.json(boundary()));
    await setImmediate();
    const previous = live.getState().snapshot;
    sockets[0].send({
      epoch: 'server-one',
      cursor: 1,
      sessionId: id,
      generation: 3,
      type: 'bridge-status',
      data: invalid,
    });
    assert.equal(live.getState().status, 'offline');
    assert.equal(live.getState().snapshot, previous);
  });
}

test('read-state broadcasts update selected metadata and invalidate other sessions without fetching history', async (t) => {
  const { live, requests, sockets, invalidations } = setup(t);
  const native = boundary();
  const completionId = '33333333-3333-3333-3333-333333333333';
  native.readState = { completionId, viewedCompletionId: null };
  requests[0].resolve(Response.json(native));
  await setImmediate();
  const previous = live.getState().snapshot.view;
  const initial = invalidations();
  for (const [index, sessionId] of [id, otherId].entries()) {
    sockets[0].send({
      epoch: 'server-one',
      cursor: index + 1,
      sessionId,
      generation: 3,
      type: 'read-state',
      data: { completionId, viewedCompletionId: completionId },
    });
  }
  assert.deepEqual(live.getState().snapshot.readState, {
    completionId,
    viewedCompletionId: completionId,
  });
  assert.equal(live.getState().snapshot.view, previous);
  assert.equal(invalidations(), initial + 2);
  assert.equal(requests.length, 1);
});
