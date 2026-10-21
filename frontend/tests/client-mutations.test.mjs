import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ApiError } from '../../src/client/api.ts';
import { SessionCommands } from '../../src/client/commands.ts';
import { LaunchController } from '../../src/client/launches.ts';
import { MutationGuard } from '../../src/client/mutation-guard.ts';
import { clientStorageKey } from '../../src/client/storage.ts';
import { boundary, id } from './live-fixture.mjs';

function storageFixture() {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
}

test('hydration blocks mutations and unreadable persisted state stays blocked', async () => {
  const read = Promise.withResolvers();
  const guard = new MutationGuard(
    { getItem: () => read.promise, setItem: async () => {}, removeItem: async () => {} },
    'guard',
  );
  let calls = 0;
  const dispatch = async () => ++calls;
  assert.equal(await guard.run(dispatch, () => true), null);
  const loading = guard.initialize();
  assert.equal(guard.initialize(), loading);
  assert.equal(guard.getState().status, 'loading');
  read.reject(new Error('Storage unreadable'));
  await loading;
  assert.equal(guard.getState().status, 'uncertain');
  assert.equal(await guard.run(dispatch, () => true), null);
  assert.equal(calls, 0);
  await guard.review();
  assert.equal(guard.getState().status, 'ready');
  assert.equal(calls, 0, 'review never replays a mutation');
});

test('remount during async persistence waits for the guard and never authorizes a competitor', async () => {
  const { storage, values } = storageFixture();
  const write = Promise.withResolvers();
  storage.setItem = async (key, value) => {
    await write.promise;
    values.set(key, value);
  };
  const guard = new MutationGuard(storage, 'guard');
  await guard.initialize();
  const response = Promise.withResolvers();
  let calls = 0;
  const dispatch = () => {
    calls++;
    assert.equal(values.get('guard'), 'true');
    return response.promise;
  };
  const result = guard.run(dispatch, () => true);
  assert.equal(guard.getState().status, 'pending', 'lock is synchronous before persistence');
  assert.equal(await guard.run(dispatch, () => true), null);
  const restored = new MutationGuard(storage, 'guard');
  const loading = restored.initialize();
  await setImmediate();
  assert.equal(restored.getState().status, 'loading');
  assert.equal(calls, 0);
  write.resolve();
  await loading;
  assert.equal(restored.getState().status, 'uncertain');
  assert.equal(await restored.run(dispatch, () => true), null);
  assert.equal(calls, 1);
  response.resolve('accepted');
  assert.equal(await result, 'accepted');
  assert.equal(restored.getState().status, 'uncertain');
});

for (const change of ['background', 'generation']) {
  test(`${change} during async persistence cancels command dispatch without replay`, async () => {
    const { storage, values } = storageFixture();
    const write = Promise.withResolvers();
    storage.setItem = async (key, value) => {
      await write.promise;
      values.set(key, value);
    };
    const connection = { status: 'ready', snapshot: boundary(), error: null };
    let calls = 0;
    const commands = new SessionCommands(id, 'test', {
      server: 'relay-one',
      connection: () => connection,
      storage,
      dispatch: async () => {
        calls++;
        return { outcome: 'acknowledged' };
      },
      refresh: () => {},
    });
    await commands.initialize();
    const result = commands.submit({ type: 'abort' });
    assert.equal(commands.getState().pending, true);
    if (change === 'background') {
      connection.status = 'offline';
    } else {
      connection.snapshot.session.generation++;
    }
    write.resolve();
    assert.equal(await result, false);
    assert.equal(calls, 0);
    assert.equal(values.size, 0);
    assert.equal(commands.getState().pending, false);
    assert.equal(commands.getState().uncertain, false);
    connection.status = 'ready';
    assert.equal(calls, 0, 'foreground recovery must not replay the command');
  });
}

for (const rejected of [false, true]) {
  test(`async cleanup failure after ${rejected ? 'rejection' : 'acceptance'} stays uncertain`, async () => {
    const { storage, values } = storageFixture();
    const guard = new MutationGuard(storage, 'guard');
    await guard.initialize();
    const remove = storage.removeItem;
    storage.removeItem = async () => {
      throw new Error('Cleanup failed');
    };
    let calls = 0;
    const result = await guard.run(
      async () => {
        calls++;
        if (rejected) {
          throw new ApiError('Busy', 'rejected');
        }
        return 'accepted';
      },
      () => true,
    );
    assert.equal(result, null);
    assert.equal(guard.getState().status, 'uncertain');
    assert.equal(values.get('guard'), 'true');
    await guard.review();
    assert.equal(guard.getState().status, 'uncertain');
    assert.equal(guard.getState().error.message, 'Cleanup failed');
    storage.removeItem = remove;
    await guard.review();
    assert.equal(guard.getState().status, 'ready');
    assert.equal(calls, 1);
  });
}

test('launch guards stay bound to their server across server switching and app restart', async () => {
  const { storage, values } = storageFixture();
  const calls = [];
  const controller = (server) =>
    new LaunchController({
      server,
      storage,
      eligible: () => true,
      dispatch: async (projectId) => {
        calls.push({ server, projectId });
        if (server === 'relay-one') {
          throw new ApiError('Response lost', 'unknown');
        }
        return { id, projectId };
      },
      refresh: () => {},
    });
  const first = controller('relay-one');
  await first.initialize();
  assert.equal(await first.start('project'), null);
  const second = controller('relay-two');
  await second.initialize();
  assert.equal(second.getState().status, 'ready');
  assert.equal((await second.start('project')).id, id);
  const restored = controller('relay-one');
  await restored.initialize();
  assert.equal(restored.getState().status, 'uncertain');
  assert.equal(await restored.start('project'), null);
  assert.equal(values.get(clientStorageKey('relay-one', 'launch', 'new')), 'true');
  assert.equal(values.has(clientStorageKey('relay-two', 'launch', 'new')), false);
  assert.deepEqual(calls, [
    { server: 'relay-one', projectId: 'project' },
    { server: 'relay-two', projectId: 'project' },
  ]);
});

test('launch eligibility is rechecked after async persistence before starting Pi', async () => {
  const { storage, values } = storageFixture();
  const write = Promise.withResolvers();
  storage.setItem = async (key, value) => {
    await write.promise;
    values.set(key, value);
  };
  let foreground = true;
  let calls = 0;
  const launches = new LaunchController({
    server: 'relay',
    storage,
    eligible: () => foreground,
    dispatch: async () => {
      calls++;
      return { id, projectId: 'project' };
    },
    refresh: () => {},
  });
  await launches.initialize();
  const result = launches.start('project');
  foreground = false;
  write.resolve();
  assert.equal(await result, null);
  assert.equal(calls, 0);
  assert.equal(values.size, 0);
  assert.equal(launches.getState().status, 'ready');
});
