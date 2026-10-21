import assert from 'node:assert/strict';
import test from 'node:test';
import { askDraftAnswer, emptyAskDraft, selectAskCustom, selectAskOption } from '../web-state.ts';
import { prompt } from './fixtures.mjs';

test('Ask browser drafts make no default decisions and require every question answered', () => {
  const source = prompt();
  const draft = emptyAskDraft(source);
  assert.deepEqual(draft.questions[0].optionIndexes, []);
  assert.equal(draft.questions[0].custom, false);
  assert.throws(() => askDraftAnswer(source, draft), /needs a selection/);
  draft.questions[0] = selectAskOption(source.questions[0], draft.questions[0], 0);
  assert.throws(() => askDraftAnswer(source, draft));
});

test('Ask single-select custom answers exclude previous options but preserve unsent text', () => {
  const source = prompt();
  const draft = emptyAskDraft(source);
  const question = source.questions[0];
  draft.questions[0].text = 'Custom database';
  draft.questions[0] = selectAskOption(question, draft.questions[0], 0);
  draft.questions[0] = selectAskCustom(question, draft.questions[0]);
  assert.deepEqual(draft.questions[0].optionIndexes, []);
  draft.questions[1] = selectAskOption(source.questions[1], draft.questions[1], 1);
  let action = askDraftAnswer(source, draft);
  assert.equal(action.answers[0].text, 'Custom database');
  assert.deepEqual(action.answers[0].optionIndexes, []);
  draft.questions[0] = selectAskOption(question, draft.questions[0], 1);
  action = askDraftAnswer(source, draft);
  assert.equal(action.answers[0].text, undefined);
  assert.deepEqual(action.answers[0].optionIndexes, [1]);
  assert.equal(draft.questions[0].text, 'Custom database');
});

test('Ask multi-select keeps checked options and custom text and forwards question/global notes', () => {
  const source = prompt();
  const draft = emptyAskDraft(source);
  draft.questions[0] = selectAskOption(source.questions[0], draft.questions[0], 0);
  let multi = draft.questions[1];
  multi = selectAskOption(source.questions[1], multi, 1);
  multi = selectAskOption(source.questions[1], multi, 0);
  multi = selectAskCustom(source.questions[1], multi);
  multi.text = 'Import too';
  multi.notes = ' important ';
  draft.questions[1] = multi;
  draft.globalNote = ' keep it small ';
  const action = askDraftAnswer(source, draft);
  assert.deepEqual(action.answers[1], {
    questionIndex: 1,
    optionIndexes: [0, 1],
    text: 'Import too',
    notes: 'important',
  });
  assert.equal(action.globalNote, 'keep it small');
  assert.equal(action.toolCallId, source.toolCallId);
  assert.deepEqual(selectAskOption(source.questions[1], multi, 1).optionIndexes, [0]);
  assert.deepEqual(multi.optionIndexes, [0, 1]);
});

test('Ask selected custom text must not be blank even if a multi-select option is checked', () => {
  const source = prompt();
  const draft = emptyAskDraft(source);
  for (const [index, question] of source.questions.entries()) {
    draft.questions[index] = selectAskOption(question, draft.questions[index], 0);
  }
  draft.questions[1] = selectAskCustom(source.questions[1], draft.questions[1]);
  draft.questions[1].text = ' ';
  assert.throws(() => askDraftAnswer(source, draft), /custom answer/);
});
