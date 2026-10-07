import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One harness writes authority.json. This is a test protocol, NOT a multi-writer lock.
const transitions = {
  tui: { release: 'releasing', close: 'closed' },
  releasing: { released: 'detached', rejected: 'tui' },
  detached: { startRpc: 'rpc-starting', reclaim: 'reclaiming' },
  'rpc-starting': { ready: 'rpc' },
  rpc: { stopRpc: 'rpc-stopping' },
  'rpc-stopping': { exited: 'detached' },
  reclaiming: { reclaimed: 'tui', rejected: 'detached' },
};

export function transition(state, event, generation = state.generation) {
  if (generation !== state.generation) {
    throw new Error('Stale ownership generation');
  }
  const phase = transitions[state.phase]?.[event];
  if (!phase) {
    throw new Error(`Invalid transition: ${state.phase} -> ${event}`);
  }
  return { ...state, phase, generation: state.generation + 1 };
}

export function readAuthority(root) {
  return JSON.parse(readFileSync(join(root, 'authority.json'), 'utf8'));
}

export function publish(root, state) {
  const temporary = join(root, `authority.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, join(root, 'authority.json'));
}

export function receiptPath(root, action, generation) {
  if (!['release', 'reclaim', 'mark', 'status'].includes(action)) {
    throw new Error('Unknown action');
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Invalid generation');
  }
  return join(root, `${action}-${generation}.json`);
}

export function checkRequest(root, action, generation, currentFile) {
  const state = readAuthority(root);
  if (state.generation !== generation) {
    throw new Error('Stale ownership generation');
  }
  const required = action === 'release' ? 'releasing' : 'reclaiming';
  const source = action === 'release' ? state.target : state.parking;
  if (state.phase !== required || currentFile !== source) {
    throw new Error(`Cannot ${action} from ${state.phase} / ${currentFile}`);
  }
  return state;
}

export function validateReceipt(state, action, receipt) {
  const requiredPhase = action === 'release' ? 'releasing' : 'reclaiming';
  if (
    state.phase !== requiredPhase ||
    receipt.generation !== state.generation ||
    receipt.action !== action
  ) {
    throw new Error('Stale or mismatched receipt');
  }
  if (receipt.ok !== true) {
    throw new Error(receipt.error || 'Transfer rejected');
  }
  const expected = action === 'release' ? state.parking : state.target;
  if (receipt.file !== expected) {
    throw new Error('Receipt names the wrong session');
  }
  return receipt;
}
