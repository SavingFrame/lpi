import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { LaunchController } from '../../src/client/launches.ts';
import { clientStorageKey } from '../../src/client/storage.ts';
import { ApiError } from '../src/api.ts';

async function setup() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const requests = [];
  let refreshes = 0;
  const environment = {
    server: 'test-server',
    storage,
    eligible: () => true,
    dispatch: (projectId, resumeId) => {
      assert.equal(
        values.get(clientStorageKey('test-server', 'launch', resumeId ?? 'new')),
        'true',
      );
      return new Promise((resolve, reject) =>
        requests.push({ projectId, resumeId, resolve, reject }),
      );
    },
    refresh: () => refreshes++,
  };
  const controller = new LaunchController(environment);
  await Promise.all(
    [undefined, 'saved', 'saved-one', 'saved-two'].map((id) => controller.initialize(id)),
  );
  const session = { id: 'session', projectId: 'project' };
  return {
    controller,
    environment,
    storage,
    values,
    requests,
    session,
    refreshes: () => refreshes,
  };
}

test('all fresh launch buttons share a synchronous guard across projects', async () => {
  const { controller, values, requests, session, refreshes } = await setup();
  const result = controller.start('project');
  await setImmediate();
  assert.equal(controller.getState().status, 'pending');
  assert.equal(values.get(clientStorageKey('test-server', 'launch', 'new')), 'true');
  assert.equal(await controller.start('another-project'), null);
  await controller.review();
  assert.equal(controller.getState().status, 'pending');
  assert.equal(values.get(clientStorageKey('test-server', 'launch', 'new')), 'true');
  assert.equal(requests.length, 1);
  requests[0].resolve(session);
  assert.equal(await result, session);
  assert.equal(controller.getState().status, 'ready');
  assert.equal(values.has(clientStorageKey('test-server', 'launch', 'new')), false);
  assert.equal(refreshes(), 1);
});

test('resume guards are per saved session and separate from fresh launch guards', async () => {
  const { controller, requests, session, values } = await setup();
  const first = controller.start('project', 'saved-one');
  await setImmediate();
  assert.equal(await controller.start('project', 'saved-one'), null);
  const second = controller.start('project', 'saved-two');
  await setImmediate();
  const fresh = controller.start('project');
  await setImmediate();
  assert.deepEqual(
    requests.map(({ resumeId }) => resumeId),
    ['saved-one', 'saved-two', undefined],
  );
  assert.equal(values.size, 3);
  for (const request of requests) {
    request.resolve(session);
  }
  await Promise.all([first, second, fresh]);
  assert.equal(values.size, 0);
});

for (const resumeId of [undefined, 'saved']) {
  test(`reload restores ${resumeId ? 'resume' : 'fresh launch'} uncertainty without replay`, async () => {
    const { controller, environment, requests, session } = await setup();
    const result = controller.start('project', resumeId);
    await setImmediate();
    const restored = new LaunchController(environment);
    await restored.initialize(resumeId);
    assert.equal(restored.getState(resumeId).status, 'uncertain');
    assert.equal(await restored.start('project', resumeId), null);
    assert.equal(requests.length, 1);
    requests[0].resolve(session);
    await result;
    assert.equal(restored.getState(resumeId).status, 'uncertain');
    await restored.review(resumeId);
    assert.equal(restored.getState(resumeId).status, 'ready');
    assert.equal(requests.length, 1, 'inspection must not replay a launch');
  });
}

for (const error of [new ApiError('Response lost', 'unknown'), new Error('Unexpected failure')]) {
  test(`${error.message} blocks launch until explicit inspection`, async () => {
    const { controller, requests, values, session, refreshes } = await setup();
    const result = controller.start('project');
    await setImmediate();
    requests[0].reject(error);
    assert.equal(await result, null);
    assert.equal(controller.getState().status, 'uncertain');
    assert.equal(controller.getState().error, error);
    assert.equal(await controller.start('project'), null);
    assert.equal(values.get(clientStorageKey('test-server', 'launch', 'new')), 'true');
    assert.equal(requests.length, 1);
    assert.equal(refreshes(), 1);
    await controller.review();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(controller.getState().error, null);
    assert.equal(values.size, 0);
    const next = controller.start('another-project');
    await setImmediate();
    requests[1].resolve(session);
    assert.equal(await next, session);
  });
}

test('known rejection clears the guard and permits an explicit new attempt', async () => {
  const { controller, requests, values, session } = await setup();
  const result = controller.start('project', 'saved');
  await setImmediate();
  requests[0].reject(new ApiError('Runtime is already reserved', 'rejected'));
  assert.equal(await result, null);
  assert.equal(controller.getState('saved').status, 'ready');
  assert.match(controller.getState('saved').error.message, /reserved/);
  assert.equal(values.size, 0);
  const next = controller.start('project', 'saved');
  await setImmediate();
  assert.equal(controller.getState('saved').error, null);
  requests[1].resolve(session);
  await next;
});

test('storage failure before dispatch never launches a runtime or leaves an in-memory pending lock', async () => {
  const { controller, storage, requests, session } = await setup();
  const setItem = storage.setItem;
  storage.setItem = () => {
    throw new Error('Storage unavailable');
  };
  assert.equal(await controller.start('project'), null);
  assert.equal(requests.length, 0);
  assert.equal(controller.getState().status, 'ready');
  assert.match(controller.getState().error.message, /Storage unavailable/);
  storage.setItem = setItem;
  const result = controller.start('project');
  await setImmediate();
  requests[0].resolve(session);
  await result;
});

test('a lost guard-cleanup result remains blocked even after launch acceptance', async () => {
  const { controller, storage, requests, values, session } = await setup();
  const result = controller.start('project');
  await setImmediate();
  const removeItem = storage.removeItem;
  storage.removeItem = () => {
    throw new Error('Storage unavailable');
  };
  requests[0].resolve(session);
  assert.equal(await result, null);
  assert.equal(controller.getState().status, 'uncertain');
  await controller.review();
  assert.equal(controller.getState().status, 'uncertain');
  assert.equal(values.get(clientStorageKey('test-server', 'launch', 'new')), 'true');
  storage.removeItem = removeItem;
  await controller.review();
  assert.equal(controller.getState().status, 'ready');
  assert.equal(requests.length, 1);
});

test('empty projects cannot dispatch or persist a launch guard', async () => {
  const { controller, requests, values } = await setup();
  assert.equal(await controller.start(''), null);
  assert.equal(requests.length, 0);
  assert.equal(values.size, 0);
});

test('snapshots are stable, all buttons are notified, and subscriptions clean up', async () => {
  const { controller, requests, session } = await setup();
  const first = controller.getState();
  const saved = controller.getState('saved');
  assert.equal(controller.getState(), first);
  const changes = [];
  const unsubscribe = controller.subscribe(() => changes.push(controller.getState()));
  const result = controller.start('project');
  await setImmediate();
  assert.equal(changes[0].status, 'pending');
  assert.equal(controller.getState('saved'), saved);
  requests[0].resolve(session);
  await result;
  assert.equal(changes.length, 2);
  assert.equal(changes[1].status, 'ready');
  unsubscribe();
  await controller.review();
  assert.equal(changes.length, 2);
});
