import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { publish, receiptPath, transition, validateReceipt } from './protocol.mjs';
import { RpcProcess } from './rpc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tuiMode = process.env.PIM_TUI_MODE || 'fullscreen';
const root = mkdtempSync(join(tmpdir(), 'pim-handoff-'));
const agentDir = join(root, 'agent');
const sessions = join(root, 'sessions');
mkdirSync(agentDir);
mkdirSync(sessions);
const target = join(sessions, 'managed.jsonl');
const parking = join(sessions, 'parking.jsonl');
// npm prepends ancestor node_modules/.bin directories, which may contain an old Pi.
const searchPath = (process.env.PATH || '')
  .split(':')
  .filter((path) => !path.endsWith('/node_modules/.bin'));
const executable =
  process.env.PIM_PI_BIN ||
  searchPath
    .map((path) => join(path, 'pi'))
    .find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
// Do not inherit credentials, real HOME, project resources, or global settings.
const env = {
  PATH: searchPath.join(':'),
  HOME: root,
  TERM: 'xterm-256color',
  LANG: 'C.UTF-8',
  PI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_SESSION_DIR: sessions,
  PI_OFFLINE: '1',
  PI_TELEMETRY: '0',
  PIM_HANDOFF_ROOT: root,
};
const common = [
  '--model',
  'openai-codex/gpt-6.1-sol',
  '--thinking',
  'low',
  '--session-dir',
  sessions,
  '--no-extensions',
  '--extension',
  join(here, 'bridge.ts'),
  '--no-mcp',
  '--no-skills',
  '--no-prompt-templates',
  '--no-context-files',
  '--no-themes',
  '--no-approve',
  '--no-tools',
];
const socketDir = process.env.CLAUDE_TMUX_SOCKET_DIR || join(tmpdir(), 'claude-tmux-sockets');
mkdirSync(socketDir, { recursive: true, mode: 0o700 });
const socket = join(socketDir, `pim-${randomUUID().slice(0, 8)}.sock`);
const pane = 'handoff:main';
const tmux = (...args) =>
  execFileSync('tmux', ['-S', socket, ...args], { env, encoding: 'utf8', timeout: 5_000 });
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const hasMarker = (data, marker) => JSON.stringify(data).includes(marker);
let state = { phase: 'tui', generation: 0, target, parking };
let rpc;
let tmuxStarted = false;
let interrupted = false;
let success = false;
const interrupt = () => {
  interrupted = true;
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

function seed(path, marker) {
  const timestamp = new Date().toISOString();
  const model = { provider: 'openai-codex', modelId: 'gpt-6.1-sol' };
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const entries = [
    { type: 'session', version: 3, id: randomUUID(), timestamp, cwd: root },
    { type: 'model_change', id: 'model001', parentId: null, timestamp, ...model },
    {
      type: 'thinking_level_change',
      id: 'think001',
      parentId: 'model001',
      timestamp,
      thinkingLevel: 'low',
    },
    {
      type: 'message',
      id: 'user0001',
      parentId: 'think001',
      timestamp,
      message: {
        role: 'user',
        content: 'Deterministic lifecycle fixture. No model request.',
        timestamp: Date.now(),
      },
    },
    {
      type: 'message',
      id: 'asst0001',
      parentId: 'user0001',
      timestamp,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: marker }],
        api: 'openai-codex-responses',
        provider: model.provider,
        model: model.modelId,
        usage,
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    },
  ];
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

async function until(label, predicate, milliseconds = 20_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (interrupted) {
      throw new Error('Test interrupted');
    }
    const result = predicate();
    if (result) {
      return result;
    }
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function receipt(action, generation) {
  const path = receiptPath(root, action, generation);
  return until(`${action} receipt ${generation}`, () => {
    if (!existsSync(path)) {
      return false;
    }
    // The extension writes synchronously; the observer may see the file mid-write.
    try {
      return json(path);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return false;
      }
      throw error;
    }
  });
}

function advance(event, extra = {}) {
  state = { ...transition(state, event), ...extra };
  publish(root, state);
}

function command(text) {
  tmux('send-keys', '-t', pane, '-l', text);
  tmux('send-keys', '-t', pane, 'Enter');
}

function capture(name) {
  writeFileSync(join(root, name), tmux('capture-pane', '-p', '-J', '-t', pane, '-S', '-300'));
}

try {
  assert(['fullscreen', 'regular'].includes(tuiMode), 'PIM_TUI_MODE must be fullscreen or regular');
  assert(executable, 'Install Pi 1.0.4 or set PIM_PI_BIN to its executable');
  const version = execFileSync(executable, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
  assert.equal(version, '1.0.4', 'Prototype is validated only against Pi 1.0.4');
  execFileSync('tmux', ['-V'], { encoding: 'utf8' });
  seed(target, 'PIM_TUI_SEED');
  seed(parking, 'PIM_PARKING_SEED');
  publish(root, state);
  writeFileSync(
    join(root, 'tui-command.json'),
    JSON.stringify({ executable, args: [...common, '--session', target, '--tui-mode', tuiMode] }),
  );
  tmux(
    '-f',
    '/dev/null',
    'new-session',
    '-d',
    '-s',
    'handoff',
    '-n',
    'main',
    '-x',
    '120',
    '-y',
    '40',
    '-c',
    root,
    `exec ${quote(process.execPath)} ${quote(join(here, 'tui.mjs'))}`,
  );
  tmuxStarted = true;
  console.log(
    `Artifacts: ${root}\nTo monitor while running:\n  tmux -S ${socket} attach -t handoff`,
  );
  await until(
    'native TUI startup',
    () =>
      existsSync(join(root, 'lifecycle.jsonl')) &&
      readFileSync(join(root, 'lifecycle.jsonl'), 'utf8').includes('"event":"start"'),
  );
  // Wait for the native editor, not only session_start during initialization.
  await until('native TUI editor', () =>
    tmux('capture-pane', '-p', '-t', pane).includes('PIM_TUI_SEED'),
  );
  command('/pim-status');
  const original = await receipt('status', 0);
  assert.equal(original.mode, 'tui');
  assert.equal(original.file, target);
  capture('01-tui-owned.txt');

  // A cancelled switch must not authorize an RPC owner.
  advance('release', { vetoRelease: true });
  command(`/pim-release ${state.generation}`);
  const cancelled = await receipt('release', state.generation);
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /cancelled/);
  advance('rejected', { vetoRelease: false });
  command('/pim-status');
  assert.equal((await receipt('status', state.generation)).file, target);
  command('/pim-release 0');
  assert.match((await receipt('release', 0)).error, /Stale/);
  console.log('PASS: cancelled and stale releases do not transfer ownership');

  advance('release');
  command(`/pim-release ${state.generation}`);
  const released = validateReceipt(state, 'release', await receipt('release', state.generation));
  assert.equal(released.pid, original.pid, 'Native TUI process must remain alive');
  assert.equal(released.mode, 'tui');
  advance('released');
  capture('02-parked.txt');

  advance('startRpc');
  rpc = new RpcProcess(executable, ['--mode', 'rpc', ...common, '--session', target], {
    cwd: root,
    env,
    logPrefix: join(root, 'rpc'),
  });
  const rpcState = await rpc.request('get_state');
  assert.equal(rpcState.sessionFile, target);
  assert.notEqual(rpc.child.pid, original.pid);
  advance('ready');

  const beforeParkedWrite = digest(target);
  command('/pim-mark PIM_PARKED_ONLY');
  const parked = await receipt('mark', state.generation);
  assert.equal(parked.file, parking);
  assert(hasMarker(parked.entries, 'PIM_PARKED_ONLY'));
  assert.equal(digest(target), beforeParkedWrite, 'Parked TUI must not append to managed session');
  console.log('PASS: native TUI stays alive; parked writes leave RPC-owned file unchanged');

  const disposition = await rpc.request('prompt', { message: '/pim-mark PIM_RPC_ADDED' });
  assert.equal(disposition.disposition, 'handled');
  const messages = await rpc.request('get_messages');
  assert(hasMarker(messages, 'PIM_RPC_ADDED'));
  assert(hasMarker(messages, 'PIM_TUI_SEED'));
  assert(!hasMarker(messages, 'PIM_PARKED_ONLY'));
  writeFileSync(join(root, 'rpc-messages.json'), JSON.stringify(messages, null, 2));

  advance('stopRpc');
  const exited = await rpc.stop();
  assert.equal(exited.code, 0);
  writeFileSync(join(root, 'rpc-exit.json'), JSON.stringify(exited));
  advance('exited'); // No reclaim authorization before confirmed process exit.
  advance('reclaim');
  command(`/pim-reclaim ${state.generation}`);
  const reclaimed = validateReceipt(state, 'reclaim', await receipt('reclaim', state.generation));
  assert.equal(reclaimed.pid, original.pid);
  assert(hasMarker(reclaimed.entries, 'PIM_RPC_ADDED'));
  assert(!hasMarker(reclaimed.entries, 'PIM_PARKED_ONLY'));
  advance('reclaimed');
  command('/pim-mark PIM_TUI_RECLAIMED');
  const final = await receipt('mark', state.generation);
  assert.equal(final.file, target);
  assert(hasMarker(final.entries, 'PIM_TUI_RECLAIMED'));
  capture('03-reclaimed.txt');
  console.log('PASS: same native TUI reopens RPC history and can append again');

  command('/pim-quit');
  const tuiExit = await until(
    'TUI exit',
    () => existsSync(join(root, 'tui-exit.json')) && json(join(root, 'tui-exit.json')),
  );
  assert.equal(tuiExit.code, 0);
  advance('close');
  const lifecycle = readFileSync(join(root, 'lifecycle.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  const findEvent = (event, file, pid) =>
    lifecycle.findIndex(
      (entry) => entry.event === event && entry.file === file && entry.pid === pid,
    );
  const tuiReleased = findEvent('shutdown', target, original.pid);
  const tuiParked = findEvent('start', parking, original.pid);
  const rpcStarted = findEvent('start', target, rpc.child.pid);
  const rpcStopped = findEvent('shutdown', target, rpc.child.pid);
  const tuiReopened = lifecycle.findLastIndex(
    (entry) => entry.event === 'start' && entry.file === target && entry.pid === original.pid,
  );
  assert(
    tuiReleased >= 0 &&
      tuiReleased < tuiParked &&
      tuiParked < rpcStarted &&
      rpcStarted < rpcStopped &&
      rpcStopped < tuiReopened,
    'Lifecycle events must confirm release before each new owner starts',
  );
  assert(
    !readFileSync(join(root, 'rpc.stdout.jsonl'), 'utf8').includes('"type":"agent_start"'),
    'No agent run expected',
  );
  const result = {
    passed: true,
    piVersion: version,
    tuiMode,
    modelCalls: 0,
    root,
    nativePid: original.pid,
    checks: [
      'cancelled-release',
      'stale-release',
      'live-tui-parking',
      'parked-write-isolation',
      'rpc-history',
      'same-tui-reclaim',
    ],
  };
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
  success = true;
  console.log('PASS: all handoff checks; zero model calls; isolated settings and credentials');
} catch (error) {
  process.exitCode = 1;
  publish(root, { ...state, phase: 'unknown', error: String(error) });
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify({ passed: false, error: String(error), root }, null, 2),
  );
  try {
    if (tmuxStarted) {
      capture('failure-tui.txt');
    }
  } catch {
    /* Pane may already be gone. */
  }
  console.error(error);
} finally {
  try {
    await rpc?.cleanup();
  } catch (error) {
    process.exitCode = 1;
    success = false;
    console.error('RPC cleanup failed:', error);
  } finally {
    if (tmuxStarted) {
      try {
        execFileSync('tmux', ['-S', socket, 'kill-server'], {
          env,
          stdio: 'ignore',
          timeout: 5_000,
        });
      } catch {
        /* Normal TUI exit may already have stopped it. */
      }
    }
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  console.log(
    `Test ${success ? 'finished' : 'failed'}. Private tmux session closed. Evidence: ${root}`,
  );
}
