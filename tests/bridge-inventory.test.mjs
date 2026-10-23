import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { setup, waitFor } from './bridge-fixture.mjs';

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

test('inventory separates live activity from durable unread completions across reconnects', async (t) => {
  const { open, bridges, inventory, events, snapshot } = await setup(t);
  assert.equal(inventory.list()[0].activity, 'unknown');
  const { socket, attached } = await open();
  const activity = () => inventory.list().find((item) => item.id === attached.sessionId).activity;
  const send = async (frame) => {
    const cursor = events.checkpoint().cursor;
    socket.send(JSON.stringify(frame));
    await waitFor(() => events.checkpoint().cursor > cursor);
  };
  assert.equal(activity(), 'idle');
  await send({ type: 'event', event: { type: 'agent_start' } });
  assert.equal(activity(), 'running');
  await send({
    type: 'status',
    state: { isStreaming: true, hasPendingMessages: false, pendingDialog: 'Confirm in terminal' },
    controls: snapshot.controls,
  });
  assert.equal(activity(), 'blocked');
  await send({ type: 'status', state: snapshot.state, controls: snapshot.controls });
  await send({ type: 'event', event: { type: 'agent_settled' } });
  assert.equal(activity(), 'idle');
  const firstCompletion = inventory.snapshot(attached.sessionId).readState.completionId;
  assert.equal(typeof firstCompletion, 'string');
  assert.equal(inventory.list()[0].readState.viewedCompletionId, null);
  await send({ type: 'event', event: { type: 'agent_start' } });
  assert.equal(activity(), 'running');
  await send({ type: 'event', event: { type: 'agent_settled' } });
  assert.equal(activity(), 'idle');
  const latest = inventory.snapshot(attached.sessionId).readState;
  assert.notEqual(latest.completionId, firstCompletion);
  inventory.markViewed(attached.sessionId, firstCompletion);
  assert.equal(inventory.snapshot(attached.sessionId).readState.viewedCompletionId, null);
  socket.terminate();
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  assert.equal(activity(), 'unknown');
  const reconnected = await open();
  assert.equal(activity(), 'idle');
  assert.deepEqual(inventory.snapshot(attached.sessionId).readState, latest);
  inventory.markViewed(attached.sessionId, latest.completionId);
  assert.equal(
    inventory.snapshot(attached.sessionId).readState.viewedCompletionId,
    latest.completionId,
  );
  reconnected.socket.terminate();
});

test('status events carry validated metadata without retransmitting conversation history', async (t) => {
  const { open, events, snapshot, bridges, defer } = await setup(t);
  const { socket, attached } = await open();
  const received = [];
  defer(events.subscribe((event) => received.push(event)));
  const state = {
    isStreaming: true,
    hasPendingMessages: true,
    pendingDialog: 'Answer in terminal',
  };
  socket.send(JSON.stringify({ type: 'status', state, controls: snapshot.controls }));
  await waitFor(() => received.length === 1);
  const event = received[0];
  assert.equal(event.type, 'bridge-status');
  assert.equal(event.sessionId, attached.sessionId);
  assert.equal(event.generation, attached.generation);
  for (const [key, value] of Object.entries({ ...state, readOnly: false, nativeTui: true })) {
    assert.equal(event.data.state[key], value);
  }
  assert.deepEqual(event.data.controls, snapshot.controls);
  assert.equal(event.data.notice, state.pendingDialog);
  assert.equal(event.data.view, undefined);
  assert.deepEqual(bridges.snapshot(attached.sessionId).view.messages, snapshot.view.messages);
  socket.terminate();
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
