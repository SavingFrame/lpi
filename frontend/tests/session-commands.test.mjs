import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SessionCommands } from '../../src/client/commands.ts';
import { clientStorageKey } from '../../src/client/storage.ts';
import { ApiError } from '../src/client/api.ts';

const id = '11111111-1111-1111-1111-111111111111';
const key = clientStorageKey('test-server', 'command', id);
const commands = [
  { type: 'prompt', message: 'Review this' },
  { type: 'steer', message: 'Focus here' },
  { type: 'follow_up', message: 'Next task' },
  { type: 'abort' },
  { type: 'set_model', provider: 'fake', modelId: 'first' },
  { type: 'set_thinking_level', level: 'high' },
  { type: 'stop_runtime' },
  {
    type: 'extension',
    extension: 'ask-user-question',
    action: { toolCallId: 'ask', cancel: true },
  },
  { type: 'navigate_tree', targetId: 'earlier', expectedLeafId: 'current' },
  { type: 'clear_queue', expectedRevision: 'queue-revision' },
];

async function setup() {
  const connection = {
    status: 'ready',
    error: null,
    snapshot: {
      session: { id, projectId: 'project', connection: 'connected', generation: 3 },
    },
  };
  const values = new Map();
  const storage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
    removeItem: (name) => values.delete(name),
  };
  const requests = [];
  let refreshes = 0;
  const environment = {
    server: 'test-server',
    connection: () => connection,
    storage,
    dispatch: (sessionId, generation, command) => {
      assert.equal(values.get(key), 'true', 'reload guard must exist before dispatch');
      return new Promise((resolve, reject) => {
        requests.push({ sessionId, generation, command, resolve, reject });
      });
    },
    refresh: () => refreshes++,
  };
  const lane = new SessionCommands(id, 'project', environment);
  await lane.initialize();
  const acknowledge = (index = 0) =>
    requests[index].resolve({ outcome: 'acknowledged', data: { disposition: 'dispatched' } });
  return {
    lane,
    connection,
    values,
    environment,
    requests,
    acknowledge,
    refreshes: () => refreshes,
  };
}

test('every command uses the shared synchronous pending guard', async () => {
  for (const [index, command] of commands.entries()) {
    const { lane, requests, acknowledge, values, refreshes } = await setup();
    assert.equal(lane.available(), true);
    const result = lane.submit(command);
    await setImmediate();
    assert.equal(lane.getState().pending, true);
    assert.equal(lane.available(), false);
    await lane.review();
    assert.equal(values.get(key), 'true');
    // Each command is checked as both an initial dispatch and a blocked competitor.
    // Cross-products of command types add no coverage to the shared pending lane.
    assert.equal(await lane.submit(commands[(index + 1) % commands.length]), false);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].command, command);
    assert.equal(requests[0].sessionId, id);
    assert.equal(requests[0].generation, 3);
    acknowledge();
    assert.equal(await result, true);
    assert.equal(lane.getState().pending, false);
    assert.equal(lane.getState().error, null);
    assert.equal(values.has(key), false);
    assert.equal(refreshes(), 1);
  }
});

for (const status of ['connecting', 'syncing', 'offline']) {
  test(`${status} sessions cannot dispatch commands`, async () => {
    const { lane, connection, requests, values } = await setup();
    assert.equal(lane.available(), true, 'availability was read before the connection changed');
    connection.status = status;
    assert.equal(lane.available(), false);
    assert.equal(await lane.submit(commands[0]), false);
    assert.equal(requests.length, 0);
    assert.equal(values.size, 0);
  });
}

for (const change of [
  (connection) => {
    connection.snapshot = null;
  },
  (connection) => {
    connection.snapshot.session.id = 'another-session';
  },
  (connection) => {
    connection.snapshot.session.projectId = 'another-project';
  },
  (connection) => {
    connection.snapshot.session.connection = 'disconnected';
  },
]) {
  test('missing, unrelated, and saved snapshots cannot dispatch commands', async () => {
    const { lane, connection, requests } = await setup();
    change(connection);
    assert.equal(lane.available(), false);
    assert.equal(await lane.submit(commands[0]), false);
    assert.equal(requests.length, 0);
  });
}

test('dispatch reads the current connection generation rather than a rendered snapshot', async () => {
  const { lane, connection, requests, acknowledge } = await setup();
  assert.equal(lane.available(), true);
  connection.snapshot.session.generation = 5;
  const result = lane.submit(commands[0]);
  await setImmediate();
  assert.equal(requests[0].generation, 5);
  acknowledge();
  assert.equal(await result, true);
});

test('unknown outcomes block every command until explicit synchronized review, without replay', async () => {
  const { lane, connection, requests, values, acknowledge, refreshes } = await setup();
  const result = lane.submit(commands[0]);
  await setImmediate();
  requests[0].reject(new ApiError('Response lost', 'unknown'));
  assert.equal(await result, false);
  assert.equal(lane.getState().uncertain, true);
  assert.equal(lane.getState().outcome, null);
  assert.equal(lane.getState().error.message, 'Response lost');
  assert.equal(values.get(key), 'true');
  for (const command of commands) {
    assert.equal(await lane.submit(command), false);
  }
  assert.equal(requests.length, 1);
  assert.equal(refreshes(), 1);
  connection.status = 'syncing';
  await lane.review();
  assert.equal(lane.getState().uncertain, true);
  assert.equal(values.get(key), 'true');
  connection.status = 'ready';
  assert.equal(lane.available(), false);
  await lane.review();
  assert.equal(lane.getState().uncertain, false);
  assert.equal(lane.getState().error, null);
  assert.equal(values.has(key), false);
  assert.equal(requests.length, 1, 'review must not replay the command');
  const next = lane.submit(commands[3]);
  await setImmediate();
  assert.equal(requests.length, 2);
  acknowledge(1);
  assert.equal(await next, true);
});

test('reload or navigation during submission restores the uncertainty guard', async () => {
  const { lane, environment, values, requests, acknowledge } = await setup();
  const result = lane.submit(commands[0]);
  await setImmediate();
  const restored = new SessionCommands(id, 'project', environment);
  await restored.initialize();
  assert.equal(restored.getState().pending, false);
  assert.equal(restored.getState().uncertain, true);
  assert.equal(await restored.submit(commands[3]), false);
  assert.equal(requests.length, 1);
  acknowledge();
  assert.equal(await result, true);
  assert.equal(values.has(key), false);
  // A remounted page still requires the user to inspect before it accepts more commands.
  assert.equal(restored.getState().uncertain, true);
  await restored.review();
  assert.equal(restored.available(), true);
});

test('known rejections return no acceptance and clear only the pending guard', async () => {
  const { lane, requests, values, acknowledge, refreshes } = await setup();
  const result = lane.submit(commands[0]);
  await setImmediate();
  requests[0].reject(new ApiError('Native agent is busy', 'rejected'));
  assert.equal(await result, false);
  assert.equal(lane.getState().uncertain, false);
  assert.equal(lane.getState().error.message, 'Native agent is busy');
  assert.equal(values.has(key), false);
  assert.equal(lane.available(), true);
  assert.equal(requests.length, 1);
  const next = lane.submit(commands[1]);
  await setImmediate();
  assert.equal(lane.getState().error, null);
  acknowledge(1);
  assert.equal(await next, true);
  assert.equal(refreshes(), 2);
});

test('unexpected post-dispatch failures are uncertain instead of permitting a resend', async () => {
  const { lane, requests, values } = await setup();
  const result = lane.submit(commands[0]);
  await setImmediate();
  requests[0].reject(new Error('Unexpected transport failure'));
  assert.equal(await result, false);
  assert.equal(lane.getState().uncertain, true);
  assert.equal(values.get(key), 'true');
  assert.equal(await lane.submit(commands[0]), false);
  assert.equal(requests.length, 1);
});

test('failing to persist the reload guard prevents dispatch', async () => {
  const { lane, environment, requests } = await setup();
  environment.storage.setItem = () => {
    throw new Error('Storage unavailable');
  };
  assert.equal(await lane.submit(commands[0]), false);
  assert.equal(requests.length, 0);
  assert.equal(lane.getState().error.message, 'Storage unavailable');
  assert.equal(lane.getState().uncertain, false);
});

for (const [command, outcome] of [
  ...commands.slice(0, 6).map((command) => [command, null]),
  [commands[6], 'Shutdown requested. Runtime exit is not yet confirmed.'],
  [commands[7], 'Answer accepted by the native extension.'],
  [commands[8], 'Native branch switched.'],
  [commands[9], 'Queued messages cleared.'],
]) {
  test(`${command.type} retains its acknowledgment semantics`, async () => {
    const { lane, acknowledge } = await setup();
    const result = lane.submit(command);
    await setImmediate();
    acknowledge();
    assert.equal(await result, true);
    assert.equal(lane.getState().outcome, outcome);
  });
}

test('a valid acknowledgment without disposition does not show a generic status', async () => {
  const { lane, requests } = await setup();
  const result = lane.submit(commands[0]);
  await setImmediate();
  requests[0].resolve({ outcome: 'acknowledged' });
  assert.equal(await result, true);
  assert.equal(lane.getState().outcome, null);
});

test('sidebar stop shares the command lane, requires the confirmed generation, and never archives', async () => {
  const { lane, environment, connection, requests, acknowledge } = await setup();
  connection.snapshot = null;
  const runtime = {
    id,
    projectId: 'project',
    connection: 'connected',
    generation: 3,
    managedRuntime: true,
  };
  environment.runtime = () => runtime;
  assert.equal(lane.available(), false, 'off-selection cannot send prompts');
  assert.equal(lane.canStop(3), true);
  assert.equal(await lane.stopRuntime(2), false);
  const stopping = lane.stopRuntime(3);
  assert.equal(await lane.stopRuntime(3), false);
  await setImmediate();
  assert.deepEqual(requests[0].command, { type: 'stop_runtime' });
  acknowledge();
  assert.equal(await stopping, true);
  assert.equal(lane.getState().shutdownGeneration, 3);
  assert.equal(lane.canStop(3), false, 'acknowledged shutdown is not resent while awaiting exit');
  runtime.generation = 4;
  assert.equal(lane.canStop(3), false);
  assert.equal(lane.canStop(4), true);
  runtime.managedRuntime = false;
  assert.equal(lane.canStop(4), false);
  assert.equal(requests.length, 1);
});

test('sidebar stop rechecks runtime generation after persistence and retains unknown outcomes without replay', async () => {
  const { lane, environment, connection, requests, values } = await setup();
  connection.snapshot = null;
  const runtime = {
    id,
    projectId: 'project',
    connection: 'connected',
    generation: 3,
    managedRuntime: true,
  };
  environment.runtime = () => runtime;
  const gate = Promise.withResolvers();
  const save = environment.storage.setItem;
  environment.storage.setItem = async (...args) => {
    await gate.promise;
    save(...args);
  };
  const stale = lane.stopRuntime(3);
  runtime.generation = 4;
  gate.resolve();
  assert.equal(await stale, false);
  assert.equal(requests.length, 0);
  const stopping = lane.stopRuntime(4);
  await setImmediate();
  requests[0].reject(new ApiError('Response lost', 'unknown'));
  assert.equal(await stopping, false);
  assert.equal(lane.getState().uncertain, true);
  assert.equal(values.get(key), 'true');
  assert.equal(await lane.stopRuntime(4), false);
  await lane.review();
  assert.equal(lane.canStop(4), true);
  assert.equal(requests.length, 1);
});

test('command state snapshots are stable between updates and subscriptions clean up', async () => {
  const { lane, acknowledge } = await setup();
  const initial = lane.getState();
  const changes = [];
  const unsubscribe = lane.subscribe(() => changes.push(lane.getState()));
  assert.equal(lane.getState(), initial);
  const result = lane.submit(commands[0]);
  await setImmediate();
  assert.equal(changes.length, 1);
  assert.notEqual(lane.getState(), initial);
  assert.equal(changes[0].pending, true);
  acknowledge();
  await result;
  assert.equal(changes.length, 2);
  assert.equal(changes[1].pending, false);
  unsubscribe();
  await lane.review();
  assert.equal(changes.length, 2);
});
