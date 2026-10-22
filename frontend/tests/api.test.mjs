import assert from 'node:assert/strict';
import test from 'node:test';
import { answer as askAnswer } from '../../src/extension-support/ask-user-question/tests/fixtures.mjs';
import { ApiError, markViewed, operate, projects, searchFiles, sessions } from '../src/api.ts';
import { boundary, id } from './live-fixture.mjs';

test('session inventory validates activity values', async (t) => {
  let activity = 'running';
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      sessions: [{ ...boundary().session, activity, readState: boundary().readState }],
    }),
  );
  assert.equal((await sessions())[0].activity, 'running');
  activity = 'invalid';
  await assert.rejects(sessions(), /Invalid session activity/);
});

test('project file search sends the full query and validates root-relative results', async (t) => {
  let result = {
    entries: [{ path: 'frontend/src/composer.tsx', directory: false }],
    truncated: false,
  };
  t.mock.method(globalThis, 'fetch', async (path) => {
    assert.equal(path, '/projects/project/files?query=src%2Fcom');
    return Response.json(result);
  });
  assert.deepEqual(await searchFiles('project', 'src/com', new AbortController().signal), result);
  result = { entries: [{ path: '../outside', directory: false }], truncated: false };
  await assert.rejects(
    searchFiles('project', 'src/com', new AbortController().signal),
    /Invalid project file entry/,
  );
});

test('project queries preserve discovered folder names', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      projects: [{ id: 'a'.repeat(64), name: 'notes', directory: '/tmp/Projects/notes' }],
    }),
  );
  assert.deepEqual(await projects(), [
    { id: 'a'.repeat(64), name: 'notes', directory: '/tmp/Projects/notes' },
  ]);
});

for (const command of [
  { type: 'prompt', message: 'hello' },
  { type: 'extension', extension: 'ask-user-question', action: askAnswer() },
]) {
  test(`${command.type} transport loss is unknown and never automatically retried`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (path, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(path, `/sessions/${id}/commands`);
      assert.equal(typeof body.requestId, 'string');
      assert.equal(body.generation, 3);
      assert.deepEqual(body.command, command);
      throw new Error('connection lost');
    });
    await assert.rejects(
      operate(id, 3, command),
      (error) => error instanceof ApiError && error.outcome === 'unknown',
    );
    assert.equal(calls, 1);
  });
}

test('invalid successful mutation acknowledgments remain unknown', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ outcome: 'acknowledged', requestId: 'wrong-request' });
  });
  await assert.rejects(
    operate(id, 3, { type: 'abort' }),
    (error) => error instanceof ApiError && error.outcome === 'unknown',
  );
  assert.equal(calls, 1);
});

test('LAN HTTP can send mutations without crypto.randomUUID', async (t) => {
  const crypto = globalThis.crypto;
  t.mock.getter(globalThis, 'crypto', () => ({
    getRandomValues: crypto.getRandomValues.bind(crypto),
  }));
  assert.equal(globalThis.crypto.randomUUID, undefined);
  const requestIds = [];
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    const body = JSON.parse(options.body);
    assert.match(
      body.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    requestIds.push(body.requestId);
    return Response.json({ requestId: body.requestId, outcome: 'acknowledged' });
  });
  await operate(id, 3, { type: 'prompt', message: 'hello' });
  await operate(id, 3, { type: 'prompt', message: 'again' });
  assert.equal(requestIds.length, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
});

test('correlated mutation acceptance is returned without retrying', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_path, options) => {
    const body = JSON.parse(options.body);
    return Response.json({
      requestId: body.requestId,
      outcome: 'acknowledged',
      data: { disposition: 'dispatched' },
    });
  });
  const result = await operate(id, 3, { type: 'steer', message: 'hello' });
  assert.equal(result.data.disposition, 'dispatched');
});

test('mark viewed sends the loaded completion ID, independent of connection generation', async (t) => {
  const completionId = '33333333-3333-3333-3333-333333333333';
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const body = JSON.parse(options.body);
    assert.equal(path, `/sessions/${id}/viewed`);
    assert.equal(body.completionId, completionId);
    assert.equal(body.generation, undefined);
    return Response.json({
      requestId: body.requestId,
      outcome: 'acknowledged',
      data: { readState: { completionId, viewedCompletionId: completionId } },
    });
  });
  assert.deepEqual(await markViewed(id, completionId), {
    completionId,
    viewedCompletionId: completionId,
  });
});
