import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASK_STATE_LIMIT,
  askAnswer,
  askPrompt,
  askState,
  validateAskAnswer,
  withAskPreviews,
} from '../../../../dist/extension-support/ask-user-question/contract.js';
import {
  extensionCommand,
  extensionSnapshots,
} from '../../../../dist/extension-support/registry.js';
import { answer, prompt } from './fixtures.mjs';

test('Ask contracts keep module-specific state and strip untrusted extra fields', () => {
  const source = prompt();
  assert.deepEqual(askPrompt({ ...source, secret: 'not forwarded' }), source);
  assert.deepEqual(extensionSnapshots({ 'ask-user-question': [source] }), {
    'ask-user-question': [source],
  });
  assert.deepEqual(extensionSnapshots({}), {});
  const action = extensionCommand({
    type: 'extension',
    extension: 'ask-user-question',
    action: { ...answer(), requestId: 'client-injected-id', channel: 'arbitrary' },
  });
  assert.deepEqual(action.action, answer());
  validateAskAnswer(action.action, source);
  assert.deepEqual(askAnswer({ toolCallId: source.toolCallId, cancel: true, answers: [] }), {
    toolCallId: source.toolCallId,
    cancel: true,
  });
});

test('Ask state rejects malformed, duplicate, oversized and unregistered payloads', () => {
  const source = prompt();
  for (const invalid of [
    null,
    {},
    { ...source, toolCallId: '' },
    { ...source, questions: [] },
    { ...source, questions: Array(5).fill(source.questions[0]) },
    { ...source, questions: [{ ...source.questions[0], multiSelect: 'false' }] },
    { ...source, questions: [{ ...source.questions[0], options: [] }] },
    { ...source, questions: [{ ...source.questions[0], header: 'x'.repeat(17) }] },
  ]) {
    assert.throws(() => askPrompt(invalid));
  }
  const oversized = prompt();
  oversized.questions[0].options[0].preview = 'x'.repeat(ASK_STATE_LIMIT);
  assert.throws(() => askPrompt(oversized));
  assert.throws(() => askState([source, source]));
  assert.throws(() => askState(Array(33).fill(source)));
  assert.throws(() => extensionSnapshots({ arbitrary: [] }));
  assert.throws(() => extensionCommand({ type: 'extension', extension: 'arbitrary', action: {} }));
});

test('Ask answer validation is all-or-nothing and respects single versus multi-select', () => {
  const source = prompt();
  const valid = answer();
  for (const answers of [
    [valid.answers[0]],
    [{ questionIndex: 2, optionIndexes: [0] }, valid.answers[1]],
    [{ questionIndex: 0, optionIndexes: [3] }, valid.answers[1]],
    [{ questionIndex: 0, optionIndexes: [0, 1] }, valid.answers[1]],
    [{ questionIndex: 0, optionIndexes: [0], text: 'Both' }, valid.answers[1]],
  ]) {
    assert.throws(() => validateAskAnswer(askAnswer({ toolCallId: 'ask-1', answers }), source));
  }
  validateAskAnswer(
    askAnswer({
      ...valid,
      answers: [{ questionIndex: 0, text: 'Something else' }, valid.answers[1]],
    }),
    source,
  );
  assert.throws(() => validateAskAnswer(answer('other-call'), source));
});

test('Ask actions reject malformed indexes, blank text and inconsistent cancellation', () => {
  for (const action of [
    { toolCallId: 'ask-1', cancel: 'true' },
    { toolCallId: 'ask-1', cancel: true, answers: answer().answers },
    { toolCallId: 'ask-1', answers: [] },
    { ...answer(), globalNote: 12 },
    { ...answer(), answers: [answer().answers[0], answer().answers[0]] },
    ...[
      { questionIndex: -1, optionIndexes: [0] },
      { questionIndex: 0.5, optionIndexes: [0] },
      { questionIndex: 0, optionIndexes: [-1] },
      { questionIndex: 0, optionIndexes: [4] },
      { questionIndex: 0, optionIndexes: [0, 0] },
      { questionIndex: 0, optionIndexes: ['0'] },
      { questionIndex: 0, text: '   ' },
      { questionIndex: 0 },
      { questionIndex: 0, text: 'x'.repeat(100001) },
    ].map((entry) => ({ toolCallId: 'ask-1', answers: [entry] })),
  ]) {
    assert.throws(() => askAnswer(action));
  }
  const normalized = askAnswer({
    toolCallId: 'ask-1',
    answers: [{ questionIndex: 0, text: ' custom text ', notes: ' note ' }],
    globalNote: ' global ',
  });
  assert.equal(normalized.answers[0].text, ' custom text ');
  assert.equal(normalized.answers[0].notes, 'note');
  assert.equal(normalized.globalNote, 'global');
});

test('Ask previews come from matching normalized tool arguments without mutating prompts', () => {
  const source = prompt();
  const args = {
    questions: source.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option, preview: 'code\r\nline\r' })),
    })),
  };
  const enriched = withAskPreviews(source, args);
  assert.equal(enriched.questions[0].options[0].preview, 'code\nline');
  assert.equal(enriched.questions[0].options[1].preview, undefined);
  assert.equal(source.questions[0].options[0].preview, undefined);
  args.questions[0].options[0].label = 'Different';
  assert.equal(withAskPreviews(source, args).questions[0].options[0].preview, undefined);
  assert.equal(withAskPreviews(source, undefined), source);
});
