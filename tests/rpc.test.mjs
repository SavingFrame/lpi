import assert from 'node:assert/strict';
import test from 'node:test';
import { RpcProcess } from '../dist/rpc/process.js';
import { fixture } from './helpers.mjs';

function runtime(t, timeout = 1000) {
  const { config, env, catalog, defer } = fixture(t);
  const session = catalog.create(config.projects[0]);
  const events = [];
  const rpc = new RpcProcess(
    config.pi,
    ['--session', session.file],
    config.projects[0].directory,
    env,
    (event) => events.push(event),
    () => {},
    timeout,
  );
  defer(() => rpc.stop());
  return { rpc, events };
}

test('RPC correlates concurrent requests and preserves Unicode line separators', async (t) => {
  const { rpc, events } = runtime(t);
  const slow = rpc.request({ type: 'prompt', message: 'slow' });
  const fast = rpc.request({ type: 'prompt', message: 'text\u2028more\u2029end' });
  assert.equal((await fast).message, 'text\u2028more\u2029end');
  assert.equal((await slow).message, 'slow');
  assert.ok(events.some((event) => event.type === 'agent_settled'));
});

test('RPC continuously drains bounded stderr', async (t) => {
  const { rpc } = runtime(t);
  await rpc.request({ type: 'prompt', message: 'stderr' });
  assert.ok(rpc.stderr.length <= 65_536);
  assert.ok(rpc.stderr.length > 0);
});

test('RPC timeout reports unknown and does not kill or release writer', async (t) => {
  const { rpc } = runtime(t, 100);
  await assert.rejects(
    rpc.request({ type: 'prompt', message: 'hang' }),
    (error) => error.outcome === 'unknown',
  );
  assert.equal(rpc.closed, false);
  assert.ok(await rpc.request({ type: 'get_state' }));
});

test('malformed stdout rejects future commands without pretending exit', async (t) => {
  const { rpc } = runtime(t);
  await assert.rejects(rpc.request({ type: 'prompt', message: 'malformed' }), /Invalid RPC/);
  assert.equal(rpc.closed, false);
  await assert.rejects(rpc.request({ type: 'get_state' }), /Invalid RPC/);
});

test('unterminated oversized records fail without unbounded buffering', async (t) => {
  const { rpc } = runtime(t);
  await assert.rejects(rpc.request({ type: 'prompt', message: 'overflow' }), /limit exceeded/);
  assert.equal(rpc.closed, false);
});

test('spawn failure and child exit settle outstanding requests', async (t) => {
  const { config, env } = fixture(t);
  const missing = new RpcProcess(
    '/missing-pim-test-executable',
    [],
    config.projects[0].directory,
    env,
    () => {},
    () => {},
  );
  await assert.rejects(missing.request({ type: 'get_state' }), /startup failed|exited/);
  await missing.exited;
  const { rpc } = runtime(t);
  await assert.rejects(rpc.request({ type: 'prompt', message: 'exit' }), /exited/);
  assert.equal((await rpc.exited).code, 7);
});
