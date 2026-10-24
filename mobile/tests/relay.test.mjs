import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { clientStorageKey } from '../../src/client/storage.ts';
import { emptyView } from '../../src/shared/client-state.ts';
import { linkedSessionId, sessionLink } from '../../src/shared/session-link.ts';
import { MobileRelay } from '../src/lib/relay.ts';
import { eventsUrl, relayOrigin } from '../src/lib/server.ts';

const id = '11111111-1111-1111-1111-111111111111';
const project = { id: 'project', name: 'Project', directory: '/isolated/project' };
const session = {
  id,
  projectId: project.id,
  directory: project.directory,
  file: '/isolated/session.jsonl',
  createdAt: '2026-01-01T00:00:00Z',
  piSessionId: 'fake-native',
  connection: 'connected',
  generation: 1,
  activity: 'idle',
  archived: false,
  managedRuntime: false,
  readState: { completionId: null, viewedCompletionId: null },
};

function setup(t, origin = 'http://relay-one:3141', values = new Map(), mutations = false) {
  const sockets = [];
  const requests = [];
  const usageRequests = [];
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  const client = new MobileRelay(origin, {
    storage,
    requestId: () => {
      assert.ok(mutations, 'Read-only lifecycle must never issue mutations');
      return '22222222-2222-2222-2222-222222222222';
    },
    fetch: (url, request) => {
      if (new URL(url).pathname === '/usage') {
        usageRequests.push({ url, request });
        return Promise.resolve(Response.json({ accounts: [], message: null }));
      }
      return new Promise((resolve, reject) => {
        if (!mutations) {
          assert.equal(request.method, 'GET');
        }
        requests.push({ url, request, resolve, reject });
      });
    },
    openSocket: (url) => {
      const socket = {
        url,
        readyState: 1,
        onmessage: null,
        onerror: null,
        onclose: null,
        close() {
          this.readyState = 3;
          this.onclose?.();
        },
        send(data) {
          this.onmessage?.({ data: JSON.stringify(data) });
        },
      };
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => {
    client.stop();
    for (const request of requests) {
      request.resolve(Response.json({}));
    }
  });
  const connected = () =>
    sockets.at(-1).send({ type: 'connected', epoch: 'relay-epoch', cursor: 0 });
  const inventory = async (sessions = [session]) => {
    requests
      .findLast((request) => request.url.endsWith('/projects'))
      .resolve(Response.json({ projects: [project] }));
    requests
      .findLast((request) => request.url.endsWith('/sessions'))
      .resolve(Response.json({ sessions }));
    await setImmediate();
  };
  return { client, sockets, requests, usageRequests, storage, values, connected, inventory };
}

test('mobile new-session launch shares a durable lane and selects the acknowledged session', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory([]);
  assert.equal(await fixture.client.createSession(project.id), false, 'wait for guard hydration');
  await fixture.client.launches.initialize();
  const creating = fixture.client.createSession(project.id);
  assert.equal(await fixture.client.createSession(project.id), false, 'no duplicate launch');
  await setImmediate();
  const request = fixture.requests.find((item) => item.request.method === 'POST');
  assert.equal(request.url, `${fixture.client.origin}/sessions`);
  assert.deepEqual(JSON.parse(request.request.body), {
    projectId: project.id,
    confirmedOffline: false,
    requestId: '22222222-2222-2222-2222-222222222222',
  });
  assert.equal(
    fixture.values.get(clientStorageKey(fixture.client.origin, 'launch', 'new')),
    'true',
  );
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
      data: { session },
    }),
  );
  assert.equal(await creating, true);
  assert.equal(fixture.client.getState().selectedId, id);
  assert.ok(fixture.requests.some((item) => item.url.endsWith('/snapshot')));
  assert.equal(
    fixture.values.get(clientStorageKey(fixture.client.origin, 'selection', 'session')),
    id,
  );
});

test('mobile launch rejection is retryable and late acknowledgment cannot change an inactive client', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory([]);
  await fixture.client.launches.initialize();
  const rejected = fixture.client.createSession(project.id);
  await setImmediate();
  fixture.requests
    .findLast((item) => item.request.method === 'POST')
    .resolve(Response.json({ error: 'Launch rejected', outcome: 'rejected' }, { status: 409 }));
  assert.equal(await rejected, false);
  assert.equal(fixture.client.launches.getState().status, 'ready');
  assert.match(fixture.client.launches.getState().error.message, /Launch rejected/);
  const creating = fixture.client.createSession(project.id);
  await setImmediate();
  fixture.client.stop();
  const request = fixture.requests.findLast((item) => item.request.method === 'POST');
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
      data: { session },
    }),
  );
  assert.equal(await creating, false);
  assert.equal(fixture.client.getState().selectedId, null);
  assert.equal(
    fixture.requests.some((item) => item.url.endsWith('/snapshot')),
    false,
  );
});

test('mobile uncertain launches survive restart and review never replays', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory([]);
  await fixture.client.launches.initialize();
  const creating = fixture.client.createSession(project.id);
  await setImmediate();
  fixture.requests
    .find((item) => item.request.method === 'POST')
    .reject(new Error('lost response'));
  assert.equal(await creating, false);
  assert.equal(fixture.client.launches.getState().status, 'uncertain');
  fixture.client.stop();
  const restored = setup(t, undefined, fixture.values, true);
  await restored.client.start();
  restored.connected();
  await restored.inventory();
  await restored.client.launches.initialize();
  assert.equal(restored.client.launches.getState().status, 'uncertain');
  assert.equal(await restored.client.createSession(project.id), false);
  await restored.client.launches.review();
  assert.equal(restored.client.launches.getState().status, 'ready');
  assert.equal(restored.requests.filter((item) => item.request.method === 'POST').length, 0);
});

test('mobile suspension during launch persistence prevents dispatch', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory([]);
  await fixture.client.launches.initialize();
  const gate = Promise.withResolvers();
  const save = fixture.storage.setItem;
  fixture.storage.setItem = async (key, value) => {
    await gate.promise;
    await save(key, value);
  };
  const creating = fixture.client.createSession(project.id);
  await setImmediate();
  fixture.client.stop();
  gate.resolve();
  assert.equal(await creating, false);
  assert.equal(fixture.client.launches.getState().status, 'ready');
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 0);
});

test('relay settings normalize origins and reject credentials, paths, and unsupported protocols', () => {
  assert.equal(relayOrigin(' HTTP://Relay-One:3141/ '), 'http://relay-one:3141');
  assert.equal(relayOrigin('https://relay.ts.net:443'), 'https://relay.ts.net');
  assert.equal(eventsUrl('https://relay.ts.net'), 'wss://relay.ts.net/events');
  assert.equal(eventsUrl('http://[::1]:3141'), 'ws://[::1]:3141/events');
  for (const value of [
    'relay-one:3141',
    'file:///tmp/lpi',
    'https://user:secret@relay',
    'https://relay/proxy',
    'https://relay/?token=secret',
    'https://relay/#session',
  ]) {
    assert.throws(() => relayOrigin(value));
  }
});

test('restores an available selected session and loads through shared synchronization', async (t) => {
  const values = new Map([[clientStorageKey('http://relay-one:3141', 'selection', 'session'), id]]);
  const { client, sockets, requests, connected, inventory } = setup(t, undefined, values);
  await client.start();
  assert.equal(sockets[0].url, 'ws://relay-one:3141/events');
  assert.equal(requests.length, 0, 'subscribe before loading authoritative state');
  connected();
  await inventory();
  assert.equal(client.getState().selectedId, id);
  assert.equal(client.live.getState().status, 'syncing');
  requests
    .find((request) => request.url.endsWith('/snapshot'))
    .resolve(
      Response.json({
        epoch: 'relay-epoch',
        cursor: 0,
        session,
        readState: session.readState,
        state: { isStreaming: false, hasPendingMessages: false },
        view: emptyView(),
        controls: {
          availableModels: [],
          scopedModels: [],
          model: null,
          thinkingLevel: null,
          availableThinkingLevels: [],
          contextUsage: null,
        },
      }),
    );
  await setImmediate();
  assert.equal(client.live.getState().status, 'ready');
  assert.equal(client.live.getState().snapshot.session.id, id);
  assert.ok(requests.every((request) => new URL(request.url).origin === client.origin));
});

test('notification target wins over cold-start saved selection and survives suspension', async (t) => {
  const target = '33333333-3333-3333-3333-333333333333';
  assert.equal(linkedSessionId(new URL(sessionLink(target)).searchParams.get('session')), target);
  for (const value of [undefined, [target], '../session', `${target}&server=evil`]) {
    assert.equal(linkedSessionId(value), null);
  }
  const key = clientStorageKey('http://relay-one:3141', 'selection', 'session');
  const fixture = setup(t, undefined, new Map([[key, id]]));
  const gate = Promise.withResolvers();
  fixture.storage.getItem = () => gate.promise;
  const starting = fixture.client.start();
  fixture.client.openSession(target);
  assert.equal(fixture.requests.length, 0, 'subscribe before loading the notification target');
  gate.resolve(id);
  await starting;
  fixture.connected();
  fixture.client.stop();
  await fixture.inventory();
  assert.equal(fixture.client.getState().selectedId, null);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory([session, { ...session, id: target, connection: 'disconnected' }]);
  assert.equal(fixture.client.getState().selectedId, target);
  assert.equal(fixture.values.get(key), target);
  assert.ok(
    fixture.requests.some((request) => request.url.endsWith(`/sessions/${target}/snapshot`)),
  );
  assert.ok(fixture.requests.every((request) => request.request.method === 'GET'));
});

test('warm notification navigation uses latest target and missing sessions never fall back', async (t) => {
  const fixture = setup(t);
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory();
  await fixture.client.select(id);
  const target = '33333333-3333-3333-3333-333333333333';
  fixture.client.openSession(target);
  const stale = fixture.requests.filter((request) => request.url.endsWith('/sessions')).at(-1);
  const staleProjects = fixture.requests
    .filter((request) => request.url.endsWith('/projects'))
    .at(-1);
  fixture.client.openSession(id);
  await fixture.inventory();
  stale.resolve(Response.json({ sessions: [{ ...session, id: target }] }));
  staleProjects.resolve(Response.json({ projects: [project] }));
  await setImmediate();
  assert.equal(fixture.client.getState().selectedId, id);
  fixture.client.openSession(target);
  await fixture.inventory();
  assert.equal(fixture.client.getState().selectedId, null);
  assert.match(fixture.client.getState().error, /unavailable/);
  assert.ok(fixture.requests.every((request) => request.request.method === 'GET'));
});

test('missing saved selection is not replaced by an arbitrary session', async (t) => {
  const values = new Map([
    [clientStorageKey('http://relay-one:3141', 'selection', 'session'), 'missing'],
  ]);
  const { client, requests, connected, inventory } = setup(t, undefined, values);
  await client.start();
  connected();
  await inventory();
  assert.equal(client.getState().selectedId, null);
  assert.equal(requests.length, 2);
});

test('suspension during settings hydration cannot open a socket afterward', async (t) => {
  const { client, storage, sockets } = setup(t);
  const read = Promise.withResolvers();
  storage.getItem = () => read.promise;
  const starting = client.start();
  client.stop();
  read.resolve(id);
  await starting;
  assert.equal(sockets.length, 0);
  assert.equal(client.live.getState().status, 'offline');
  await client.start();
  assert.equal(sockets.length, 1);
});

test('background HTTP results cannot replace state and foreground reconnects without mutations', async (t) => {
  const { client, sockets, connected, inventory } = setup(t);
  await client.start();
  connected();
  client.stop();
  await inventory();
  assert.deepEqual(client.getState().sessions, []);
  assert.equal(client.live.getState().status, 'offline');
  await client.start();
  connected();
  await inventory();
  assert.equal(sockets.length, 2);
  assert.equal(client.getState().sessions[0].id, id);
  assert.equal(client.getState().selectedId, null);
});

async function loadConversation(
  fixture,
  { running = false, completionId = null, saved = false, extensions = {}, managed = false } = {},
) {
  await fixture.client.start();
  fixture.connected();
  await fixture.inventory();
  await fixture.client.select(id);
  fixture.requests
    .findLast((request) => request.url.endsWith('/snapshot'))
    .resolve(
      Response.json({
        epoch: 'relay-epoch',
        cursor: 0,
        session: saved ? { ...session, connection: 'disconnected' } : session,
        readState: { completionId, viewedCompletionId: null },
        state: { isStreaming: running, hasPendingMessages: false, managedRuntime: managed },
        view: { ...emptyView(), running, extensions },
        controls: {
          availableModels: [],
          scopedModels: [],
          model: null,
          thinkingLevel: null,
          availableThinkingLevels: [],
          contextUsage: null,
        },
      }),
    );
  await setImmediate();
}

function acknowledge(request) {
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
    }),
  );
}

test('mobile archives without closing the conversation and refreshes authoritative visibility', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture, { running: true });
  const snapshot = fixture.client.live.getState().snapshot;
  const archiving = fixture.client.setArchived(id, true);
  const request = fixture.requests.findLast((item) => item.request.method === 'POST');
  assert.ok(request.url.endsWith('/archive'));
  assert.equal(JSON.parse(request.request.body).archived, true);
  assert.equal(JSON.parse(request.request.body).confirmedOffline, undefined);
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
      data: { archived: true },
    }),
  );
  await setImmediate();
  await fixture.inventory([{ ...session, archived: true }]);
  await archiving;
  assert.equal(fixture.client.getState().sessions[0].archived, true);
  assert.equal(fixture.client.getState().selectedId, id);
  assert.equal(fixture.client.live.getState().snapshot, snapshot);
  fixture.client.stop();
  await assert.rejects(fixture.client.setArchived(id, false), /Reconnect/);
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 1);
});

test('mobile resumes only an explicitly selected saved snapshot and refreshes the same session', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  await fixture.client.launches.initialize(id);
  assert.equal(await fixture.client.resumeSession(id), false, 'connected session cannot resume');
  await loadConversation(fixture, { saved: true });
  const resuming = fixture.client.resumeSession(id);
  await setImmediate();
  assert.equal(await fixture.client.resumeSession(id), false, 'one resume in flight');
  const request = fixture.requests.findLast((item) => item.request.method === 'POST');
  assert.ok(request.url.endsWith(`/sessions/${id}/resume`));
  assert.equal(JSON.parse(request.request.body).confirmedOffline, true);
  const snapshots = fixture.requests.filter((item) => item.url.endsWith('/snapshot')).length;
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
      data: { session },
    }),
  );
  assert.equal(await resuming, true);
  assert.equal(fixture.client.getState().selectedId, id);
  assert.equal(
    fixture.requests.filter((item) => item.url.endsWith('/snapshot')).length,
    snapshots + 1,
  );
});

test('mobile resume rechecks saved state after asynchronous persistence', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture, { saved: true });
  await fixture.client.launches.initialize(id);
  const gate = Promise.withResolvers();
  const save = fixture.storage.setItem;
  fixture.storage.setItem = async (key, value) => {
    if (key === clientStorageKey(fixture.client.origin, 'launch', id)) {
      await gate.promise;
    }
    await save(key, value);
  };
  const resuming = fixture.client.resumeSession(id);
  await setImmediate();
  fixture.client.live.refresh();
  const snapshot = fixture.client.live.getState().snapshot;
  fixture.requests
    .findLast((item) => item.url.endsWith('/snapshot'))
    .resolve(Response.json({ ...snapshot, session }));
  await setImmediate();
  gate.resolve();
  assert.equal(await resuming, false);
  assert.equal(fixture.client.launches.getState(id).status, 'ready');
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 0);
});

test('mobile resume markers survive restart without automatic replay', async (t) => {
  const values = new Map([[clientStorageKey('http://relay-one:3141', 'launch', id), 'true']]);
  const fixture = setup(t, undefined, values, true);
  await loadConversation(fixture, { saved: true });
  await fixture.client.launches.initialize(id);
  assert.equal(fixture.client.launches.getState(id).status, 'uncertain');
  assert.equal(await fixture.client.resumeSession(id), false);
  await fixture.client.launches.review(id);
  assert.equal(fixture.client.launches.getState(id).status, 'ready');
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 0);
});

const questionPrompt = {
  toolCallId: 'ask-1',
  questions: [
    {
      question: 'Which approach?',
      header: 'Approach',
      multiSelect: true,
      options: [
        { label: 'First', description: 'One', hasPreview: false },
        {
          label: 'Second',
          description: 'Two',
          hasPreview: true,
          preview: '```ts\nconst value = 2;\n```',
        },
      ],
    },
  ],
};

test('mobile questionnaires validate answers and share the command lane with sending and cancellation', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture, { extensions: { 'ask-user-question': [questionPrompt] } });
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  await assert.rejects(messages.answer({ toolCallId: 'closed', cancel: true }), /no longer open/);
  await assert.rejects(
    messages.answer({ toolCallId: 'ask-1', answers: [{ questionIndex: 0, optionIndexes: [3] }] }),
    /out of range/,
  );
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 0);
  const action = {
    toolCallId: 'ask-1',
    answers: [
      { questionIndex: 0, optionIndexes: [0, 1], text: 'Also this', notes: 'Question note' },
    ],
    globalNote: 'Global note',
  };
  const answering = messages.answer(action);
  await setImmediate();
  assert.equal(await messages.commands.submit({ type: 'abort' }), false);
  const request = fixture.requests.findLast((item) => item.url.endsWith('/commands'));
  assert.deepEqual(JSON.parse(request.request.body).command, {
    type: 'extension',
    extension: 'ask-user-question',
    action,
  });
  request.resolve(
    Response.json({ error: 'Answer rejected', outcome: 'rejected' }, { status: 409 }),
  );
  assert.equal(await answering, false);
  fixture.requests
    .findLast((item) => item.url.endsWith('/snapshot'))
    .resolve(Response.json(fixture.client.live.getState().snapshot));
  await setImmediate();
  const cancelling = messages.answer({ toolCallId: 'ask-1', cancel: true });
  await setImmediate();
  const cancellation = fixture.requests.findLast((item) => item.url.endsWith('/commands'));
  assert.equal(JSON.parse(cancellation.request.body).command.action.cancel, true);
  acknowledge(cancellation);
  assert.equal(await cancelling, true);
});

test('mobile lost questionnaire verdict blocks new answers across restart', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  const extensions = { 'ask-user-question': [questionPrompt] };
  await loadConversation(fixture, { extensions });
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  const answering = messages.answer({ toolCallId: 'ask-1', cancel: true });
  await setImmediate();
  fixture.requests
    .findLast((item) => item.url.endsWith('/commands'))
    .reject(new Error('lost verdict'));
  assert.equal(await answering, false);
  const restored = setup(t, undefined, fixture.values, true);
  await loadConversation(restored, { extensions });
  const next = restored.client.messages(id, project.id);
  await next.initialize();
  assert.equal(await next.answer({ toolCallId: 'ask-1', cancel: true }), false);
  assert.equal(next.commands.getState().uncertain, true);
  assert.equal(restored.requests.filter((item) => item.request.method === 'POST').length, 0);
});

test('mobile sends protected prompts/steers, preserves newer draft edits, and shares the abort lane', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  const messages = fixture.client.messages(id, project.id);
  assert.equal(messages, fixture.client.messages(id, project.id));
  await messages.initialize();
  messages.draft.update(() => ({ text: 'First message', images: [] }));
  const sending = messages.send();
  await setImmediate();
  const request = fixture.requests.findLast((request) => request.url.endsWith('/commands'));
  assert.equal(JSON.parse(request.request.body).command.type, 'prompt');
  assert.equal(fixture.values.get(clientStorageKey(fixture.client.origin, 'command', id)), 'true');
  assert.equal(await messages.commands.submit({ type: 'abort' }), false);
  messages.draft.update(() => ({ text: 'Newer edits', images: [] }));
  acknowledge(request);
  assert.equal(await sending, true);
  assert.equal(messages.draft.getState().draft.text, 'Newer edits');
  await messages.draft.flush();
  assert.equal(
    JSON.parse(fixture.values.get(clientStorageKey(fixture.client.origin, 'draft', id))).text,
    'Newer edits',
  );

  // Refresh after an acknowledgment must synchronize before another command.
  fixture.requests
    .findLast((request) => request.url.endsWith('/snapshot'))
    .resolve(
      Response.json({
        ...fixture.client.live.getState().snapshot,
        view: { ...emptyView(), running: true },
      }),
    );
  await setImmediate();
  const steering = messages.send();
  await setImmediate();
  const steer = fixture.requests.findLast((request) => request.url.endsWith('/commands'));
  assert.equal(JSON.parse(steer.request.body).command.type, 'steer');
  acknowledge(steer);
  assert.equal(await steering, true);
  assert.equal(messages.draft.getState().draft.text, '');
});

test('mobile image-only sends use the protected lane and acceptance preserves newer attachments', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
  messages.draft.update(() => ({ text: '', images: [image] }));
  const sending = messages.send();
  await setImmediate();
  const request = fixture.requests.findLast((request) => request.url.endsWith('/commands'));
  assert.deepEqual(JSON.parse(request.request.body).command, {
    type: 'prompt',
    message: '',
    images: [image],
  });
  // Native image drafts are memory-only; text and safety markers remain durable.
  assert.deepEqual(
    JSON.parse(fixture.values.get(clientStorageKey(fixture.client.origin, 'draft', id))).images,
    [],
  );
  const newer = { ...image };
  messages.draft.update(() => ({ text: '', images: [newer] }));
  acknowledge(request);
  assert.equal(await sending, true);
  assert.deepEqual(messages.draft.getState().draft.images, [newer]);
});

test('mobile runtime stop requires the confirmed managed generation and shares the command lane', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  assert.equal(await messages.stopRuntime(1), false, 'unmanaged runtimes cannot be stopped');
  await loadConversation(fixture, { managed: true, running: true });
  assert.equal(
    await messages.stopRuntime(0),
    false,
    'stale confirmation cannot stop a new runtime',
  );
  assert.equal(fixture.requests.filter((item) => item.request.method === 'POST').length, 0);
  messages.draft.update(() => ({ text: 'Keep this draft', images: [] }));
  const stopping = messages.stopRuntime(1);
  await setImmediate();
  assert.equal(await messages.commands.submit({ type: 'abort' }), false);
  const request = fixture.requests.findLast((item) => item.url.endsWith('/commands'));
  const body = JSON.parse(request.request.body);
  assert.deepEqual(body.command, { type: 'stop_runtime' });
  assert.equal(body.generation, 1);
  acknowledge(request);
  assert.equal(await stopping, true);
  assert.match(messages.commands.getState().outcome, /exit is not yet confirmed/);
  assert.equal(messages.draft.getState().draft.text, 'Keep this draft');
  assert.equal(fixture.client.live.getState().snapshot.session.connection, 'connected');
});

test('mobile abort dispatches through the protected lane and rejected sends retain drafts', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture, { running: true });
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  const aborting = messages.commands.submit({ type: 'abort' });
  await setImmediate();
  const abort = fixture.requests.findLast((request) => request.url.endsWith('/commands'));
  assert.deepEqual(JSON.parse(abort.request.body).command, { type: 'abort' });
  acknowledge(abort);
  assert.equal(await aborting, true);
  fixture.requests
    .findLast((request) => request.url.endsWith('/snapshot'))
    .resolve(Response.json(fixture.client.live.getState().snapshot));
  await setImmediate();
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
  messages.draft.update(() => ({ text: 'Rejected draft', images: [image] }));
  const sending = messages.send();
  await setImmediate();
  fixture.requests
    .findLast((request) => request.url.endsWith('/commands'))
    .resolve(
      Response.json({ error: 'Native command rejected', outcome: 'rejected' }, { status: 409 }),
    );
  assert.equal(await sending, false);
  assert.equal(messages.draft.getState().draft.text, 'Rejected draft');
  assert.deepEqual(messages.draft.getState().draft.images, [image]);
  assert.equal(messages.commands.getState().uncertain, false);
  assert.match(messages.commands.getState().error.message, /rejected/);
});

test('mobile unknown outcomes survive restart without replay; explicit review never resends', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  messages.draft.update(() => ({ text: 'Keep me', images: [] }));
  const sending = messages.send();
  await setImmediate();
  fixture.requests
    .findLast((request) => request.url.endsWith('/commands'))
    .reject(new Error('lost response'));
  assert.equal(await sending, false);
  assert.equal(messages.commands.getState().uncertain, true);
  assert.equal(messages.draft.getState().draft.text, 'Keep me');
  const restored = setup(t, undefined, fixture.values, true);
  await loadConversation(restored);
  const next = restored.client.messages(id, project.id);
  await next.initialize();
  assert.equal(next.commands.getState().uncertain, true);
  assert.equal(next.draft.getState().draft.text, 'Keep me');
  assert.equal(await next.send(), false);
  await next.commands.review();
  assert.equal(next.commands.available(), true);
  assert.equal(restored.requests.filter((request) => request.request.method === 'POST').length, 0);
});

test('mobile suspension during marker persistence prevents dispatch and preserves the draft', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  await loadConversation(fixture);
  const messages = fixture.client.messages(id, project.id);
  await messages.initialize();
  messages.draft.update(() => ({ text: 'Not sent', images: [] }));
  await messages.draft.flush();
  const gate = Promise.withResolvers();
  const save = fixture.storage.setItem;
  fixture.storage.setItem = async (key, value) => {
    if (key === clientStorageKey(fixture.client.origin, 'command', id)) {
      await gate.promise;
    }
    await save(key, value);
  };
  const sending = messages.send();
  await setImmediate();
  fixture.client.stop();
  gate.resolve();
  assert.equal(await sending, false);
  assert.equal(messages.draft.getState().draft.text, 'Not sent');
  assert.equal(fixture.requests.filter((request) => request.request.method === 'POST').length, 0);
});

test('mobile read acknowledgment requires the loaded, visible, foreground conversation at the bottom', async (t) => {
  const fixture = setup(t, undefined, undefined, true);
  const completionId = '33333333-3333-3333-3333-333333333333';
  await loadConversation(fixture, { completionId });
  const posts = () => fixture.requests.filter((request) => request.request.method === 'POST');
  fixture.client.setReading(id, true, false);
  fixture.client.setReading(id, false, true);
  assert.equal(posts().length, 0);
  fixture.client.stop();
  fixture.client.setReading(id, true, true);
  assert.equal(posts().length, 0);
  fixture.client.setReading(id, false, false);
  await loadConversation(fixture, { completionId });
  fixture.client.setReading(id, true, true);
  assert.equal(posts().length, 1);
  const request = posts()[0];
  assert.ok(request.url.endsWith('/viewed'));
  assert.equal(JSON.parse(request.request.body).completionId, completionId);
  request.resolve(
    Response.json({
      requestId: JSON.parse(request.request.body).requestId,
      outcome: 'acknowledged',
      data: { readState: { completionId, viewedCompletionId: completionId } },
    }),
  );
  await setImmediate();
  fixture.client.setReading(id, true, true);
  assert.equal(posts().length, 1);
});

test('server switching isolates selection and outstanding requests', async (t) => {
  const values = new Map();
  const first = setup(t, 'http://relay-one:3141', values);
  const second = setup(t, 'http://relay-two:3141', values);
  await first.client.start();
  first.connected();
  await first.inventory();
  await first.client.select(id);
  first.client.stop();
  await second.client.start();
  second.connected();
  await second.inventory();
  assert.equal(second.client.getState().selectedId, null);
  assert.equal(first.usageRequests[0].url, `${first.client.origin}/usage`);
  assert.equal(second.usageRequests[0].url, `${second.client.origin}/usage`);
  assert.equal(first.client.usage.getState().online, false);
  assert.equal(values.get(clientStorageKey(first.client.origin, 'selection', 'session')), id);
  assert.equal(values.has(clientStorageKey(second.client.origin, 'selection', 'session')), false);
  assert.ok(first.requests.every((request) => new URL(request.url).origin === first.client.origin));
  assert.ok(
    second.requests.every((request) => new URL(request.url).origin === second.client.origin),
  );
});
