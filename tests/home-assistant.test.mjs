import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Events } from '../dist/src/events.js';
import { HomeAssistantNotifications } from '../dist/src/home-assistant.js';
import { sessionLink } from '../dist/src/shared/session-link.js';
import { SessionReadStore } from '../dist/src/storage/read-state.js';

const id = '11111111-1111-1111-1111-111111111111';
const session = { id, title: 'Test session', connection: 'connected', generation: 2 };

function completionStore(t, events) {
  const store = new SessionReadStore(':memory:');
  // Match Sessions' ordering: persist before the notification subscriber sees settlement.
  const unsubscribe = events.subscribe((event) => {
    if (event.type === 'pi-event' && event.data.type === 'agent_settled') {
      store.complete(event.sessionId);
    }
  });
  t.after(() => {
    unsubscribe();
    store.close();
  });
  return store;
}

test('unread completion waits ten seconds before posting a linked HA alert, without replay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requests.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    res.end('[]');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const config = {
    url: `http://127.0.0.1:${server.address().port}`,
    service: 'mobile_app_test_phone',
  };
  const events = new Events();
  const store = completionStore(t, events);
  const warnings = [];
  const notifications = new HomeAssistantNotifications(
    config,
    events,
    { get: () => session },
    store,
    'isolated-test-token',
    fetch,
    (message) => warnings.push(message),
  );
  t.after(async () => {
    notifications.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const settled = { type: 'agent_settled' };
  events.publish(id, 2, 'connection', session);
  events.publish(id, 2, 'bridge-sync', { view: { running: false } });
  events.publish(id, 2, 'pi-event', {
    type: 'message_end',
    message: { role: 'toolResult', timestamp: 1, content: 'Do not show tool output' },
  });
  events.publish(id, 1, 'pi-event', settled);
  t.mock.timers.tick(10_000);
  assert.equal(requests.length, 0);
  const response = once(server, 'request');
  events.publish(id, 2, 'pi-event', {
    type: 'message_end',
    message: {
      role: 'assistant',
      timestamp: 2,
      content: [
        { type: 'thinking', thinking: 'Private reasoning must not be sent' },
        { type: 'toolCall', name: 'bash', arguments: { command: 'private command' } },
        { type: 'text', text: '# **Done**\n\nRead [docs](https://example.com). `Ready`!' },
      ],
    },
  });
  events.publish(id, 2, 'pi-event', settled);
  t.mock.timers.tick(9999);
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  const [, res] = await response;
  await once(res, 'finish');
  assert.deepEqual(requests, [
    {
      method: 'POST',
      path: '/api/services/notify/mobile_app_test_phone',
      authorization: 'Bearer isolated-test-token',
      body: {
        title: 'Test session',
        message: 'Done Read docs. Ready!',
        data: {
          notification_icon: 'mdi:vector-polyline',
          notification_icon_color: '#24333c',
          color: '#b1d4e5',
          url: sessionLink(id),
          tag: `lpi-${id}`,
          actions: [{ action: 'OPEN_LPI', title: 'Open session', uri: sessionLink(id) }],
        },
      },
    },
  ]);
  notifications.close();
  events.publish(id, 2, 'pi-event', settled);
  t.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(requests.length, 1);
  assert.deepEqual(warnings, []);
});

test('answer previews are bounded, final-only, and never reuse another run or generation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new Events();
  const store = completionStore(t, events);
  const delivered = [];
  const notifications = new HomeAssistantNotifications(
    { url: 'https://ha.invalid', service: 'mobile_app_test_phone' },
    events,
    { get: () => ({ ...session, title: '  ' }) },
    store,
    'isolated-token',
    async (_url, request) => {
      delivered.push(JSON.parse(request.body));
      return new Response('[]');
    },
  );
  t.after(() => notifications.close());
  const publish = (event, generation = 2) => events.publish(id, generation, 'pi-event', event);
  const answer = (content, generation = 2) =>
    publish(
      { type: 'message_end', message: { role: 'assistant', timestamp: 1, content } },
      generation,
    );
  const finish = async () => {
    publish({ type: 'agent_settled' });
    t.mock.timers.tick(10_000);
    await setImmediate();
  };

  publish({ type: 'agent_start' });
  answer('Intermediate answer');
  answer(`**${'😀'.repeat(250)}**`);
  answer('Stale generation answer', 1);
  await finish();
  assert.equal(delivered[0].title, 'lpi');
  assert.equal(delivered[0].message, `${'😀'.repeat(199)}…`);

  answer('Must not survive the next run');
  publish({ type: 'agent_start' });
  await finish();
  assert.equal(delivered[1].message, 'Agent finished answering');

  publish({ type: 'agent_start' });
  answer('Not the final answer');
  answer([{ type: 'thinking', thinking: 'No public answer' }]);
  await finish();
  assert.equal(delivered[2].message, 'Agent finished answering');

  answer('Must not survive reconnect');
  events.publish(id, 2, 'connection', session);
  await finish();
  assert.equal(delivered[3].message, 'Agent finished answering');
});

test('read state, newer completions, and new runs suppress obsolete pending alerts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new Events();
  const store = completionStore(t, events);
  const delivered = [];
  const notifications = new HomeAssistantNotifications(
    { url: 'https://ha.invalid', service: 'mobile_app_test_phone' },
    events,
    { get: () => session },
    store,
    'isolated-token',
    async (_url, request) => {
      delivered.push(JSON.parse(request.body));
      return new Response('[]');
    },
  );
  t.after(() => notifications.close());
  const settle = () => events.publish(id, 2, 'pi-event', { type: 'agent_settled' });
  const acknowledge = (completionId) => {
    const readState = store.markViewed(id, completionId);
    events.publish(id, 2, 'read-state', readState);
  };

  settle();
  t.mock.timers.tick(5000);
  acknowledge(store.get(id).completionId);
  t.mock.timers.tick(5000);
  assert.equal(delivered.length, 0, 'reading on either client cancels the alert');

  settle();
  t.mock.timers.tick(5000);
  // Recheck SQLite at dispatch even if no read-state event reached this subscriber.
  store.markViewed(id, store.get(id).completionId);
  t.mock.timers.tick(5000);
  assert.equal(delivered.length, 0);

  settle();
  const oldCompletion = store.get(id).completionId;
  t.mock.timers.tick(5000);
  settle();
  acknowledge(oldCompletion);
  t.mock.timers.tick(5000);
  assert.equal(delivered.length, 0, 'a newer completion gets its own grace period');
  t.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(delivered.length, 1, 'an old acknowledgment cannot suppress the newer completion');

  settle();
  events.publish(id, 2, 'pi-event', { type: 'agent_start' });
  t.mock.timers.tick(10_000);
  assert.equal(delivered.length, 1, 'starting another run cancels the previous alert');

  settle();
  notifications.close();
  t.mock.timers.tick(10_000);
  assert.equal(delivered.length, 1, 'shutdown clears delayed alerts');
});

test('HA failures are isolated, redacted, and never retried; shutdown cancels pending requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = new Events();
  const store = completionStore(t, events);
  const config = { url: 'https://ha.invalid', service: 'mobile_app_test_phone' };
  assert.throws(
    () => new HomeAssistantNotifications(config, events, { get: () => session }, store, ''),
    /LPI_HA_TOKEN/,
  );
  const warnings = [];
  const requests = [];
  const notifications = new HomeAssistantNotifications(
    config,
    events,
    { get: () => session },
    store,
    'secret-token',
    async (_url, request) => {
      requests.push(request);
      if (requests.length === 1) {
        return new Response('secret-response', { status: 401 });
      }
      if (requests.length === 2) {
        throw new Error('secret-transport-error');
      }
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('cancelled')));
      });
    },
    (message) => warnings.push(message),
  );
  const settle = () => {
    events.publish(id, 2, 'pi-event', { type: 'agent_settled' });
    t.mock.timers.tick(10_000);
  };
  try {
    settle();
    await setImmediate();
    settle();
    await setImmediate();
    assert.equal(requests.length, 2);
    assert.match(warnings.join('\n'), /401/);
    assert.match(warnings.join('\n'), /not retried/);
    assert.doesNotMatch(warnings.join('\n'), /secret/);
    settle();
    notifications.close();
    assert.equal(requests[2].signal.aborted, true);
    await setImmediate();
    assert.equal(warnings.length, 2);
    assert.ok(requests.every((request) => request.redirect === 'error'));
  } finally {
    notifications.close();
  }
});
