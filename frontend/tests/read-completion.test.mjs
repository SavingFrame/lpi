import assert from 'node:assert/strict';
import test from 'node:test';
import { completionToView, ReadCompletions } from '../../src/client/read-completion.ts';

const id = '11111111-1111-1111-1111-111111111111';
const completionId = '22222222-2222-2222-2222-222222222222';
const conditions = { synchronized: true, following: true, visible: true };
const snapshot = {
  session: { id, connection: 'connected', generation: 3 },
  readState: { completionId, viewedCompletionId: null },
};

test('only a loaded, unread completion is eligible for acknowledgment', () => {
  assert.equal(completionToView(null, conditions), null);
  assert.deepEqual(completionToView(snapshot, conditions), { id, completionId });
  for (const readState of [
    { completionId: null, viewedCompletionId: null },
    { completionId, viewedCompletionId: completionId },
  ]) {
    assert.equal(completionToView({ ...snapshot, readState }, conditions), null);
  }
});

for (const synchronized of [false, true]) {
  for (const following of [false, true]) {
    for (const visible of [false, true]) {
      test(`read gate: synchronized=${synchronized}, following=${following}, visible=${visible}`, () => {
        const target = completionToView(snapshot, { synchronized, following, visible });
        assert.deepEqual(
          target,
          synchronized && following && visible ? { id, completionId } : null,
        );
      });
    }
  }
}

test('hiding the tab or scrolling up suppresses acknowledgments until the reader returns', () => {
  const hidden = { ...conditions, visible: false };
  const scrolledUp = { ...conditions, following: false };
  assert.equal(completionToView(snapshot, hidden), null);
  assert.equal(completionToView(snapshot, scrolledUp), null);
  assert.deepEqual(completionToView(snapshot, conditions), { id, completionId });
});

test('a retained transcript during reconnect cannot acknowledge until synchronized', () => {
  assert.equal(completionToView(snapshot, { ...conditions, synchronized: false }), null);
  assert.deepEqual(completionToView(snapshot, conditions), { id, completionId });
});

test('a newer completion must be loaded before it can be acknowledged', () => {
  const newer = '33333333-3333-3333-3333-333333333333';
  const viewed = { ...snapshot, readState: { completionId, viewedCompletionId: completionId } };
  assert.equal(completionToView(viewed, conditions), null);
  const loaded = {
    ...snapshot,
    readState: { completionId: newer, viewedCompletionId: completionId },
  };
  assert.deepEqual(completionToView(loaded, conditions), { id, completionId: newer });
  assert.deepEqual(completionToView(snapshot, conditions), { id, completionId });
});

test('saved sessions can acknowledge loaded completions without a live generation', () => {
  const saved = { ...snapshot, session: { id, connection: 'disconnected', generation: 0 } };
  assert.deepEqual(completionToView(saved, conditions), { id, completionId });
});

function controllerFixture() {
  const context = { snapshot, conditions: { ...conditions } };
  const requests = [];
  let refreshes = 0;
  const controller = new ReadCompletions({
    target: () => completionToView(context.snapshot, context.conditions),
    dispatch: (id, completionId) =>
      new Promise((resolve, reject) => requests.push({ id, completionId, resolve, reject })),
    refresh: () => refreshes++,
  });
  return { controller, context, requests, refreshes: () => refreshes };
}

test('read controller deduplicates synchronization and requires explicit eligible retry', async () => {
  const { controller, context, requests, refreshes } = controllerFixture();
  const first = controller.synchronize();
  assert.equal(controller.getState().pending, true);
  await controller.synchronize();
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('Response lost'));
  await first;
  assert.equal(controller.getState().error.message, 'Response lost');
  await controller.synchronize();
  assert.equal(requests.length, 1, 'failure cannot authorize an automatic retry');
  context.conditions.visible = false;
  await controller.retry();
  assert.equal(requests.length, 1, 'retry reads visibility at the time of the click');
  assert.equal(controller.getState().target, null);
  context.conditions.visible = true;
  await controller.synchronize();
  assert.equal(requests.length, 1, 'foreground recovery cannot replay the acknowledgment');
  const retry = controller.retry();
  assert.equal(requests.length, 2);
  await controller.retry();
  assert.equal(requests.length, 2, 'pending retry is exclusive');
  requests[1].resolve({ completionId, viewedCompletionId: completionId });
  await retry;
  assert.equal(controller.getState().error, null);
  assert.equal(refreshes(), 1);
});

test('out-of-order read verdicts cannot replace a newer loaded completion', async () => {
  const { controller, context, requests } = controllerFixture();
  const old = controller.synchronize();
  const newer = '33333333-3333-3333-3333-333333333333';
  context.snapshot = { ...snapshot, readState: { completionId: newer, viewedCompletionId: null } };
  const next = controller.synchronize();
  assert.deepEqual(
    requests.map((request) => request.completionId),
    [completionId, newer],
  );
  requests[1].resolve({ completionId: newer, viewedCompletionId: newer });
  await next;
  requests[0].reject(new Error('Old completion failed'));
  await old;
  assert.deepEqual(controller.getState().target, { id, completionId: newer });
  assert.equal(controller.getState().pending, false);
  assert.equal(controller.getState().error, null);
  await controller.retry();
  assert.equal(requests.length, 2);
});

test('read controller does not acknowledge background/drawer events or a stale retry target', async () => {
  const { controller, context, requests } = controllerFixture();
  context.conditions.visible = false;
  await controller.synchronize();
  assert.equal(requests.length, 0);
  context.conditions.visible = true;
  const first = controller.synchronize();
  requests[0].reject(new Error('Unavailable'));
  await first;
  context.snapshot = {
    ...snapshot,
    readState: { completionId: 'newer-not-yet-attempted', viewedCompletionId: null },
  };
  await controller.retry();
  assert.equal(requests.length, 1, 'retry cannot dispatch a different, unattempted completion');
  context.conditions.synchronized = false;
  await controller.synchronize();
  assert.equal(controller.getState().target, null);
  assert.equal(requests.length, 1);
});
