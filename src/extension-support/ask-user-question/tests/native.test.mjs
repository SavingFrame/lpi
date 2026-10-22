import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createEventBus } from '@earendil-works/pi-coding-agent';
import {
  ASK_ANSWER,
  ASK_ANSWER_RESULT,
  ASK_BLOCKED,
  ASK_PROMPT,
} from '../../../../dist/src/extension-support/ask-user-question/contract.js';
import { askUserQuestionSupport } from '../../../../dist/src/extension-support/ask-user-question/native.js';
import { answer, prompt } from './fixtures.mjs';

function setup(t, timeout = 1000) {
  const bus = createEventBus();
  let changes = 0;
  const support = askUserQuestionSupport(
    { events: bus },
    () => changes++,
    () => undefined,
    timeout,
  );
  t.after(() => {
    support.dispose();
    bus.clear();
  });
  return { bus, support, changes: () => changes };
}

test('Ask adapter tracks independent prompts, terminal closure, completion and invalid notifications', (t) => {
  const { bus, support, changes } = setup(t);
  bus.emit(ASK_PROMPT, prompt());
  bus.emit(ASK_PROMPT, prompt('ask-2'));
  bus.emit(ASK_PROMPT, prompt());
  assert.equal(changes(), 2);
  assert.deepEqual(
    support.snapshot().map((item) => item.toolCallId),
    ['ask-1', 'ask-2'],
  );
  bus.emit(ASK_BLOCKED, { active: true, toolCallId: 'ask-1' });
  bus.emit(ASK_BLOCKED, { active: false, toolCallId: 'ask-1' });
  assert.deepEqual(support.snapshot(), [prompt('ask-2')]);
  support.complete('ask-2');
  assert.deepEqual(support.snapshot(), []);
  for (const value of [null, {}, { toolCallId: 'bad', questions: [] }]) {
    bus.emit(ASK_PROMPT, value);
    bus.emit(ASK_BLOCKED, value);
  }
  assert.deepEqual(support.snapshot(), []);
});

test('Ask adapter requires a correlated authoritative verdict and accepts synchronous replies', async (t) => {
  const { bus, support } = setup(t);
  bus.emit(ASK_PROMPT, prompt());
  const emitted = [];
  bus.on(ASK_ANSWER, (payload) => emitted.push(payload));
  let settled = false;
  const pending = support.answer(answer(), 'request-1').then(() => {
    settled = true;
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].requestId, 'request-1');
  bus.emit(ASK_ANSWER_RESULT, { requestId: 'unrelated', toolCallId: 'ask-1', ok: true });
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(support.snapshot().length, 1);
  bus.emit(ASK_ANSWER_RESULT, { requestId: 'request-1', toolCallId: 'ask-1', ok: true });
  await pending;
  assert.deepEqual(support.snapshot(), []);
  assert.throws(() => support.answer(answer(), 'request-2'), /no longer open/);

  bus.emit(ASK_PROMPT, prompt('ask-2'));
  bus.on(ASK_ANSWER, (payload) => {
    bus.emit(ASK_ANSWER_RESULT, {
      requestId: payload.requestId,
      toolCallId: payload.toolCallId,
      ok: true,
    });
  });
  await support.answer({ toolCallId: 'ask-2', cancel: true }, 'request-3');
  assert.deepEqual(support.snapshot(), []);
});

test('Ask preflight never emits incomplete answers or a second concurrent answer', async (t) => {
  const { bus, support } = setup(t);
  const emitted = [];
  bus.on(ASK_ANSWER, (payload) => emitted.push(payload));
  bus.emit(ASK_PROMPT, prompt());
  assert.throws(
    () => support.answer({ toolCallId: 'ask-1', answers: [answer().answers[0]] }, 'bad'),
    /every/,
  );
  assert.equal(emitted.length, 0);
  const pending = support.answer(answer(), 'first');
  assert.throws(() => support.answer(answer(), 'second'), /already pending/);
  assert.equal(emitted.length, 1);
  bus.emit(ASK_ANSWER_RESULT, { requestId: 'first', toolCallId: 'ask-1', ok: true });
  await pending;
});

test('Ask rejection preserves valid open questions and not_found removes stale questions', async (t) => {
  const { bus, support } = setup(t);
  bus.emit(ASK_PROMPT, prompt());
  const pending = support.answer(answer(), 'rejected');
  bus.emit(ASK_ANSWER_RESULT, {
    requestId: 'rejected',
    toolCallId: 'ask-1',
    ok: false,
    code: 'invalid_answer',
  });
  await assert.rejects(
    pending,
    (error) => error.outcome === 'rejected' && /invalid_answer/.test(error.message),
  );
  assert.equal(support.snapshot().length, 1);
  const stale = support.answer(answer(), 'stale');
  bus.emit(ASK_ANSWER_RESULT, {
    requestId: 'stale',
    toolCallId: 'ask-1',
    ok: false,
    code: 'not_found',
  });
  await assert.rejects(stale, /not_found/);
  assert.deepEqual(support.snapshot(), []);
});

test('Ask terminal closure can race an in-flight external answer without claiming success', async (t) => {
  const { bus, support } = setup(t);
  bus.emit(ASK_PROMPT, prompt());
  const pending = support.answer(answer(), 'raced');
  bus.emit(ASK_BLOCKED, { active: false, toolCallId: 'ask-1' });
  bus.emit(ASK_ANSWER_RESULT, {
    requestId: 'raced',
    toolCallId: 'ask-1',
    ok: false,
    code: 'not_found',
  });
  await assert.rejects(pending, /not_found/);
  assert.deepEqual(support.snapshot(), []);
});

test('Ask missing or malformed verdicts are unknown, never retried or treated as cancellation', async (t) => {
  const { bus, support } = setup(t, 25);
  const emitted = [];
  bus.on(ASK_ANSWER, (payload) => emitted.push(payload));
  bus.emit(ASK_PROMPT, prompt());
  await assert.rejects(support.answer(answer(), 'timeout'), (error) => error.outcome === 'unknown');
  assert.equal(emitted.length, 1);
  assert.equal(support.snapshot().length, 1);
  const malformed = support.answer(answer(), 'malformed');
  bus.emit(ASK_ANSWER_RESULT, { requestId: 'malformed', toolCallId: 'wrong-call', ok: true });
  await assert.rejects(malformed, (error) => error.outcome === 'unknown');
  assert.equal(emitted.length, 2);
  assert.equal(support.snapshot().length, 1);
});

test('Ask session cleanup removes listeners and marks unfinished attempts unknown', async (t) => {
  const { bus, support } = setup(t);
  bus.emit(ASK_PROMPT, prompt());
  const pending = support.answer(answer(), 'inflight');
  support.dispose();
  await assert.rejects(pending, (error) => error.outcome === 'unknown');
  bus.emit(ASK_PROMPT, prompt('after-dispose'));
  assert.deepEqual(support.snapshot(), []);
});
