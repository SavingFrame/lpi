import assert from 'node:assert/strict';
import test from 'node:test';
import { completionToView } from '../src/session/read-completion.ts';

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
