import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import sessionName from '../dist/extensions/session-name/index.js';

function fixture(t, { name, history = [], missingModel = false } = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), 'lpi-session-name-'));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const logPath = join(agentDir, 'auto-title.log');
  const handlers = new Map();
  const entries = [...history];
  const calls = [];
  const names = [];
  let resolve;
  let reject;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const model = { provider: 'openai-codex', id: 'gpt-6-luna' };
  const ctx = {
    sessionManager: {
      getSessionId: () => 'test-session',
      getEntries: () => entries,
      getBranch: () => entries,
    },
    modelRegistry: {
      find: (provider, id) => {
        assert.deepEqual({ provider, id }, model);
        return missingModel ? undefined : model;
      },
      streamSimple: (selected, context, options) => {
        calls.push({ selected, context, options });
        return { result: () => result };
      },
    },
  };
  sessionName({
    on: (event, handler) => handlers.set(event, handler),
    getSessionName: () => name,
    setSessionName: (title) => {
      name = title;
      names.push(title);
      handlers.get('session_info_changed')({ name }, ctx);
    },
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
  });
  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  const emit = (type, extra = {}) => handlers.get(type)?.({ type, ...extra }, ctx);
  emit('session_start');
  t.after(() => emit('session_shutdown'));
  return {
    calls,
    names,
    logPath,
    logs: () => readFileSync(logPath, 'utf8'),
    entries,
    emit,
    reject,
    prompt: (prompt = 'Fix mobile reconnect') =>
      emit('before_agent_start', { messageType: 'user', prompt }),
    finish: async (text = 'Fix mobile reconnect', stopReason = 'stop') => {
      resolve({
        stopReason,
        errorMessage: stopReason === 'error' ? 'Unsupported parameter: temperature' : undefined,
        content: [{ type: 'text', text }],
      });
      await setImmediate();
    },
    rename: (title) => {
      name = title;
      emit('session_info_changed', { name });
    },
  };
}

test('names once in the background using Luna with thinking off and bounded input', async (t) => {
  const f = fixture(t);
  assert.equal(f.prompt('x'.repeat(5000)), undefined);
  f.prompt('second message');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].context.messages[0].content.length, 4000);
  assert.equal(f.calls[0].options.reasoning, undefined);
  assert.equal(f.calls[0].options.maxTokens, 128);
  await f.finish('"Fix mobile reconnect"');
  assert.deepEqual(f.names, ['Fix mobile reconnect']);
  f.emit('session_start');
  f.prompt();
  assert.equal(f.calls.length, 1);
});

test('resumed unnamed sessions use the original user message', async (t) => {
  const f = fixture(t, {
    history: [
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'Original task' }] },
      },
      { type: 'message', message: { role: 'assistant', content: [] } },
    ],
  });
  f.prompt('Continue please');
  assert.equal(f.calls[0].context.messages[0].content, 'Original task');
  await f.finish('Original task');
  assert.deepEqual(f.names, ['Original task']);
});

test('named sessions, persisted attempts, custom runs and image-only input are skipped', (t) => {
  for (const options of [
    { name: 'Manual title' },
    { history: [{ type: 'custom', customType: 'session-name-attempt' }] },
  ]) {
    const f = fixture(t, options);
    f.prompt();
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(t, {
    history: [{ type: 'message', message: { role: 'user', content: [{ type: 'image' }] } }],
  });
  f.emit('before_agent_start', { messageType: 'custom' });
  f.prompt('');
  assert.equal(f.calls.length, 0);
  assert.equal(f.entries.length, 1);
  f.prompt('Describe this image');
  assert.equal(f.calls[0].context.messages[0].content, 'Describe this image');
});

test('late results cannot overwrite manual names or cross a session shutdown', async (t) => {
  for (const action of ['rename', 'shutdown']) {
    const f = fixture(t);
    f.prompt();
    if (action === 'rename') {
      f.rename('My title');
      f.rename(undefined);
    } else {
      f.emit('session_shutdown');
      f.emit('session_start');
    }
    assert.equal(f.calls[0].options.signal.aborted, true);
    await f.finish();
    assert.deepEqual(f.names, []);
  }
});

test('missing model, failed requests and invalid responses keep the fallback without retry', async (t) => {
  const missing = fixture(t, { missingModel: true });
  missing.prompt();
  assert.equal(missing.calls.length, 0);
  assert.deepEqual(missing.names, []);
  for (const outcome of ['reject', 'error', 'empty', 'long']) {
    const f = fixture(t);
    f.prompt();
    if (outcome === 'reject') {
      f.reject(new Error('No credentials'));
      await setImmediate();
    } else {
      await f.finish(
        outcome === 'empty' ? '' : 'x'.repeat(61),
        outcome === 'error' ? 'error' : 'stop',
      );
    }
    f.emit('session_start');
    f.prompt();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.names, []);
  }
});

test('text diagnostics explain outcomes without logging prompts or generated titles', async (t) => {
  const f = fixture(t);
  f.prompt('Private prompt content');
  await f.finish('Private generated title');
  f.prompt();
  assert.match(
    f.logs(),
    /\d{4}-\d{2}-\d{2}T.* \[session-name\] session=test-session generate:start model=openai-codex\/gpt-6-luna/,
  );
  assert.match(f.logs(), /generate:success elapsedMs=\d+/);
  assert.match(f.logs(), /generate:skipped reason=already-attempted/);
  assert.doesNotMatch(f.logs(), /Private|generate:cancelled/);

  const missing = fixture(t, { missingModel: true });
  missing.prompt();
  assert.match(missing.logs(), /reason=model-not-found/);

  const failed = fixture(t);
  failed.prompt();
  await failed.finish('', 'error');
  assert.match(failed.logs(), /stopReason=error error=Unsupported parameter: temperature/);

  const invalid = fixture(t);
  invalid.prompt();
  await invalid.finish('');
  assert.match(invalid.logs(), /generate:rejected reason=invalid-title characters=0 words=0/);

  const cancelled = fixture(t);
  cancelled.prompt();
  cancelled.rename('Manual');
  await cancelled.finish();
  assert.match(cancelled.logs(), /generate:cancelled reason=session-name-changed/);
});

test('unwritable diagnostics do not interfere with naming', async (t) => {
  const f = fixture(t);
  // Remove the parent rather than changing permissions, which root can bypass.
  rmSync(join(f.logPath, '..'), { recursive: true });
  f.prompt();
  await f.finish();
  assert.deepEqual(f.names, ['Fix mobile reconnect']);
});
