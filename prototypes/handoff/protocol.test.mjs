import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkRequest,
  publish,
  readAuthority,
  receiptPath,
  transition,
  validateReceipt,
} from './protocol.mjs';

const initial = () => ({
  phase: 'tui',
  generation: 0,
  target: '/test/managed.jsonl',
  parking: '/test/parking.jsonl',
});

test('ordered transfer requires TUI release and RPC exit before reclaim', () => {
  let state = initial();
  for (const event of [
    'release',
    'released',
    'startRpc',
    'ready',
    'stopRpc',
    'exited',
    'reclaim',
    'reclaimed',
  ]) {
    state = transition(state, event);
  }
  assert.equal(state.phase, 'tui');
  assert.equal(state.generation, 8);
  for (const phase of ['tui', 'releasing', 'rpc-starting', 'rpc', 'rpc-stopping']) {
    assert.throws(() => transition({ ...initial(), phase }, 'reclaim'), /Invalid/);
  }
  assert.throws(() => transition(initial(), 'startRpc'), /Invalid/);
});

test('cancelled release preserves TUI ownership; unknown state fails closed', () => {
  const releasing = transition(initial(), 'release');
  assert.equal(transition(releasing, 'rejected').phase, 'tui');
  assert.throws(() => transition({ ...initial(), phase: 'unknown' }, 'startRpc'), /Invalid/);
});

test('rejects stale generations, wrong receipts, and failed replacements', () => {
  const state = transition(initial(), 'release');
  const receipt = { action: 'release', generation: 1, ok: true, file: state.parking };
  assert.equal(validateReceipt(state, 'release', receipt), receipt);
  assert.throws(() => transition(state, 'released', 0), /Stale/);
  assert.throws(() => validateReceipt(state, 'release', { ...receipt, generation: 0 }), /Stale/);
  assert.throws(
    () => validateReceipt(state, 'release', { ...receipt, file: state.target }),
    /wrong session/,
  );
  assert.throws(() => validateReceipt(state, 'release', { ...receipt, ok: false }), /rejected/);
  assert.throws(() => receiptPath('/tmp', 'release', NaN), /generation/);
  assert.throws(() => receiptPath('/tmp', '../release', 1), /action/);
});

test('bridge requires the expected source session and current authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'pim-protocol-'));
  try {
    const state = transition(initial(), 'release');
    publish(root, state);
    assert.deepEqual(readAuthority(root), state);
    assert.deepEqual(checkRequest(root, 'release', 1, state.target), state);
    assert.throws(() => checkRequest(root, 'release', 0, state.target), /Stale/);
    assert.throws(() => checkRequest(root, 'release', 1, state.parking), /Cannot/);
    assert.throws(() => checkRequest(root, 'reclaim', 1, state.target), /Cannot/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
