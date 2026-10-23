import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveSession } from '../../src/client/live.ts';
import { SessionNotifications } from '../../src/client/notifications.ts';

test('alerts receive sequenced events for inactive sessions, never connection snapshots or gaps', () => {
  const received = [];
  let resets = 0;
  const socket = {
    readyState: 1,
    onmessage: null,
    onerror: null,
    onclose: null,
    close() {
      this.readyState = 3;
    },
  };
  const live = new LiveSession(
    {
      openSocket: () => socket,
      inspect: async () => {
        throw new Error('Must not load history for alerts');
      },
      onEvent: (value) => received.push(value),
      onBoundary: () => resets++,
    },
    () => {},
  );
  const send = (value) => socket.onmessage({ data: JSON.stringify(value) });
  live.connect();
  send({ type: 'connected', epoch: 'relay', cursor: 10 });
  assert.equal(resets, 1);
  assert.deepEqual(received, []);
  const finished = pi('agent_settled', {}, { cursor: 11 });
  send(finished);
  assert.deepEqual(received, [finished]);
  send({ ...finished, cursor: 13 });
  assert.equal(socket.readyState, 3);
  assert.deepEqual(received, [finished]);
  live.disconnect();
});

function event(type, data = {}, extra = {}) {
  return { epoch: 'relay', cursor: 1, sessionId: 'session', generation: 1, type, data, ...extra };
}

function pi(type, data = {}, extra = {}) {
  return event('pi-event', { type, ...data }, extra);
}

test('live alerts distinguish completions, input transitions, and failed or aborted turns', () => {
  const alerts = new SessionNotifications();
  assert.equal(alerts.accept(pi('agent_start')), null);
  assert.equal(
    alerts.accept(pi('message_end', { message: { role: 'assistant', stopReason: 'stop' } })),
    null,
  );
  assert.equal(alerts.accept(pi('agent_settled')), 'finished');
  assert.equal(alerts.accept(pi('extension_support', { notice: 'Question' })), 'input');
  assert.equal(alerts.accept(event('bridge-status', { notice: 'Question' })), null);
  assert.equal(alerts.accept(pi('extension_support', { notice: null })), null);
  assert.equal(alerts.accept(event('bridge-status', { notice: 'Question' })), 'input');
  assert.equal(alerts.accept(pi('agent_start')), null);
  const failed = pi('message_end', { message: { role: 'assistant', stopReason: 'error' } });
  assert.equal(alerts.accept(failed), 'error');
  assert.equal(alerts.accept(failed), null);
  assert.equal(alerts.accept(pi('agent_settled')), null);
  assert.equal(alerts.accept(pi('agent_start')), null);
  assert.equal(
    alerts.accept(pi('message_end', { message: { role: 'assistant', stopReason: 'aborted' } })),
    null,
  );
  assert.equal(alerts.accept(pi('agent_settled')), null);
  assert.equal(alerts.accept(pi('agent_start')), null);
  assert.equal(alerts.accept(pi('agent_settled')), 'finished');
});

test('notification state is scoped by session, generation, and connection boundary', () => {
  const alerts = new SessionNotifications();
  const input = pi('extension_support', { notice: 'Input' });
  assert.equal(alerts.accept(input), 'input');
  assert.equal(alerts.accept({ ...input, sessionId: 'another' }), 'input');
  assert.equal(alerts.accept({ ...input, generation: 2 }), 'input');
  assert.equal(alerts.accept(pi('agent_settled', {}, { generation: 1 })), null);
  assert.equal(alerts.accept(event('bridge-sync')), null);
  assert.equal(alerts.accept(event('read-state', { completionId: 'new' })), null);
  alerts.reset();
  assert.equal(alerts.accept(input), 'input');
  assert.equal(alerts.accept(pi('compaction_end', { errorMessage: 'Failed' })), 'error');
  assert.equal(alerts.accept(pi('agent_settled')), null);
});
