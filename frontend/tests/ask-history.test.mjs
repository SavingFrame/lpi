import assert from 'node:assert/strict';
import test from 'node:test';
import { askHistory } from '../src/session/transcript/tools/ask-history.ts';

function tool(details, args = {}) {
  return {
    name: 'ask_user_question',
    status: 'Completed',
    args,
    result: { role: 'toolResult', timestamp: 1, details },
  };
}

const questions = [
  {
    question: 'Which database?',
    header: 'Database',
    options: [
      { label: 'SQLite', description: 'Local storage', preview: 'SQL example' },
      { label: 'Postgres', description: 'Remote storage' },
    ],
  },
];
const answer = {
  questionIndex: 0,
  question: 'Which database?',
  kind: 'option',
  answer: 'SQLite',
};

test('Ask history preserves all choices, selected descriptions, previews and notes for a read-only form', () => {
  const history = askHistory(
    tool(
      {
        cancelled: false,
        answers: [{ ...answer, notes: 'For development', preview: 'SQL example' }],
        globalNote: 'Keep it simple',
      },
      { questions },
    ),
  );
  assert.equal(history.questions[0].header, 'Database');
  assert.deepEqual(history.questions[0].selected, [questions[0].options[0]]);
  assert.deepEqual(history.questions[0].options, [
    questions[0].options[0],
    { ...questions[0].options[1], preview: undefined },
  ]);
  assert.equal(history.questions[0].multiSelect, false);
  assert.equal(history.questions[0].notes, 'For development');
  assert.equal(history.questions[0].preview, 'SQL example');
  assert.equal(history.globalNote, 'Keep it simple');
});

test('Ask history preserves multi-select plus custom text and does not match custom text to options', () => {
  for (const kind of ['multi', 'custom']) {
    const history = askHistory(
      tool(
        {
          cancelled: false,
          answers: [{ ...answer, kind, selected: ['Postgres'], answer: 'SQLite' }],
        },
        { questions },
      ),
    );
    assert.equal(history.questions[0].custom, 'SQLite');
    assert.equal(history.questions[0].multiSelect, kind === 'multi');
    assert.deepEqual(
      history.questions[0].selected.map((entry) => entry.label),
      kind === 'multi' ? ['Postgres'] : [],
    );
  }
});

test('Ask history represents partial submission, cancellation and errors without inventing answers', () => {
  for (const details of [
    { cancelled: false, answers: [], unanswered: [0] },
    { cancelled: true, answers: [], globalNote: 'Not now' },
    { cancelled: true, answers: [], error: 'no_ui' },
  ]) {
    const history = askHistory(tool(details, { questions }));
    assert.equal(history.questions[0].skipped, true);
    assert.deepEqual(history.questions[0].selected, []);
    assert.equal(history.cancelled, details.cancelled);
    assert.equal(history.error, details.error);
    assert.equal(history.globalNote, details.globalNote);
  }
});

test('Ask history remains readable without arguments and avoids mismatched descriptions', () => {
  for (const args of [undefined, { questions: [{ ...questions[0], question: 'Different?' }] }]) {
    const history = askHistory(tool({ cancelled: false, answers: [answer] }, args));
    assert.equal(history.questions[0].question, answer.question);
    assert.deepEqual(history.questions[0].selected, [{ label: 'SQLite' }]);
    assert.deepEqual(history.questions[0].options, [{ label: 'SQLite' }]);
  }
});

test('Ask read-only choices stay in authored order when the last option was selected', () => {
  const history = askHistory(
    tool({ cancelled: false, answers: [{ ...answer, answer: 'Postgres' }] }, { questions }),
  );
  assert.deepEqual(
    history.questions[0].options.map((option) => option.label),
    ['SQLite', 'Postgres'],
  );
  assert.deepEqual(
    history.questions[0].selected.map((option) => option.label),
    ['Postgres'],
  );
});

test('Ask read-only skipped and cancelled multi-select questions keep their original control type', () => {
  for (const cancelled of [false, true]) {
    const history = askHistory(
      tool(
        { cancelled, answers: [] },
        {
          questions: [{ ...questions[0], multiSelect: true }],
        },
      ),
    );
    assert.equal(history.questions[0].multiSelect, true);
    assert.equal(history.questions[0].skipped, true);
    assert.equal(history.questions[0].options.length, 2);
    assert.deepEqual(history.questions[0].selected, []);
  }
});

test('Ask history falls back to raw tool display for missing or malformed native results', () => {
  for (const details of [
    undefined,
    {},
    { cancelled: false, answers: [null] },
    { cancelled: false, answers: [{ ...answer, selected: [42] }] },
  ]) {
    assert.equal(askHistory(tool(details)), null);
  }
  assert.equal(askHistory({ ...tool({ cancelled: false, answers: [] }), name: 'bash' }), null);
  assert.equal(askHistory({ name: 'ask_user_question', status: 'Running' }), null);
});
