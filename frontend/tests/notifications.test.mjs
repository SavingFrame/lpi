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
  assert.deepEqual(alerts.accept(pi('agent_start')), null);
  assert.deepEqual(
    alerts.accept(pi('message_end', { message: { role: 'assistant', stopReason: 'stop' } })),
    null,
  );
  assert.deepEqual(alerts.accept(pi('agent_settled')), { kind: 'finished', body: '' });
  assert.deepEqual(alerts.accept(pi('extension_support', { notice: 'Question' })), {
    kind: 'input',
    body: '',
  });
  assert.deepEqual(alerts.accept(event('bridge-status', { notice: 'Question' })), null);
  assert.deepEqual(alerts.accept(pi('extension_support', { notice: null })), null);
  assert.deepEqual(alerts.accept(event('bridge-status', { notice: 'Question' })), {
    kind: 'input',
    body: '',
  });
  assert.deepEqual(alerts.accept(pi('agent_start')), null);
  const failed = pi('message_end', { message: { role: 'assistant', stopReason: 'error' } });
  assert.deepEqual(alerts.accept(failed), { kind: 'error', body: '' });
  assert.deepEqual(alerts.accept(failed), null);
  assert.deepEqual(alerts.accept(pi('agent_settled')), null);
  assert.deepEqual(alerts.accept(pi('agent_start')), null);
  assert.deepEqual(
    alerts.accept(pi('message_end', { message: { role: 'assistant', stopReason: 'aborted' } })),
    null,
  );
  assert.deepEqual(alerts.accept(pi('agent_settled')), null);
  assert.deepEqual(alerts.accept(pi('agent_start')), null);
  assert.deepEqual(alerts.accept(pi('agent_settled')), { kind: 'finished', body: '' });
});

test('completion previews use the last assistant text, never thinking or tool output', () => {
  const alerts = new SessionNotifications();
  const message = (role, content) =>
    alerts.accept(pi('message_end', { message: { role, content, stopReason: 'stop' } }));
  alerts.accept(pi('agent_start'));
  message('assistant', [{ type: 'text', text: 'Let me check.' }]);
  message('toolResult', 'Private tool output');
  message('assistant', [
    { type: 'thinking', thinking: 'Private reasoning' },
    { type: 'text', text: '  Fixed the issue.\n\n' },
    { type: 'text', text: 'Details '.repeat(40) },
  ]);
  message('toolResult', 'More tool output');
  assert.deepEqual(alerts.accept(pi('agent_settled')), {
    kind: 'finished',
    body: `Fixed the issue. ${'Details '.repeat(40)}`.slice(0, 200),
  });
  alerts.accept(pi('agent_start', {}, { sessionId: 'another' }));
  assert.deepEqual(alerts.accept(pi('agent_settled', {}, { sessionId: 'another' })), {
    kind: 'finished',
    body: '',
  });
  alerts.accept(pi('agent_start'));
  assert.deepEqual(alerts.accept(pi('agent_settled')), { kind: 'finished', body: '' });
  message('assistant', 'String response');
  assert.deepEqual(alerts.accept(pi('agent_settled')), {
    kind: 'finished',
    body: 'String response',
  });
  message('assistant', [{ type: 'thinking', thinking: 'No public response' }]);
  assert.deepEqual(alerts.accept(pi('agent_settled')), { kind: 'finished', body: '' });
  message('assistant', 'Old generation');
  assert.deepEqual(alerts.accept(pi('agent_settled', {}, { generation: 2 })), {
    kind: 'finished',
    body: '',
  });
  alerts.reset();
  assert.deepEqual(alerts.accept(pi('agent_settled')), { kind: 'finished', body: '' });
});

test('notification state is scoped by session, generation, and connection boundary', () => {
  const alerts = new SessionNotifications();
  const input = pi('extension_support', { notice: 'Input' });
  assert.deepEqual(alerts.accept(input), { kind: 'input', body: '' });
  assert.deepEqual(alerts.accept({ ...input, sessionId: 'another' }), { kind: 'input', body: '' });
  assert.deepEqual(alerts.accept({ ...input, generation: 2 }), { kind: 'input', body: '' });
  assert.deepEqual(alerts.accept(pi('agent_settled', {}, { generation: 1 })), null);
  assert.deepEqual(alerts.accept(event('bridge-sync')), null);
  assert.deepEqual(alerts.accept(event('read-state', { completionId: 'new' })), null);
  alerts.reset();
  assert.deepEqual(alerts.accept(input), { kind: 'input', body: '' });
  assert.deepEqual(alerts.accept(pi('compaction_end', { errorMessage: 'Failed' })), {
    kind: 'error',
    body: '',
  });
  assert.deepEqual(alerts.accept(pi('agent_settled')), null);
});
