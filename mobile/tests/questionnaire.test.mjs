import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as contract from '../../src/extension-support/ask-user-question/contract.ts';
import * as draft from '../../src/extension-support/ask-user-question/draft.ts';
import { askHistory } from '../../src/extension-support/ask-user-question/history.ts';
import { conversationRows } from '../src/features/conversation/timeline.ts';

const prompt = {
  toolCallId: 'ask-1',
  questions: [
    {
      question: 'Which approach?',
      header: 'Approach',
      multiSelect: true,
      options: [
        { label: 'First', description: 'First approach', hasPreview: false },
        { label: 'Second', description: 'Second approach', hasPreview: false },
      ],
    },
  ],
};

function nodes(element, type) {
  if (!element || typeof element !== 'object') {
    return [];
  }
  return [
    ...(element.type === type ? [element] : []),
    ...[element.props?.children].flat(Infinity).flatMap((child) => nodes(child, type)),
  ];
}

function harness() {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const native = Object.fromEntries(
    ['View', 'Text', 'TextInput', 'Pressable'].map((name) => [name, Symbol(name)]),
  );
  const states = [];
  let index = 0;
  let available = true;
  const sent = [];
  const modules = {
    react: {
      useEffect: () => {},
      useState: (initial) => {
        const slot = index++;
        if (!(slot in states)) {
          states[slot] = typeof initial === 'function' ? initial() : initial;
        }
        return [
          states[slot],
          (value) => {
            states[slot] = typeof value === 'function' ? value(states[slot]) : value;
          },
        ];
      },
      useSyncExternalStore: (_, getState) => getState(),
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { ...native, StyleSheet: { create: (value) => value } },
    '../../../src/extension-support/ask-user-question/contract': contract,
    '../../../src/extension-support/ask-user-question/draft': draft,
    '../../../src/extension-support/ask-user-question/history': { askHistory },
    '../features/conversation/markdown': { Markdown: Symbol('Markdown') },
    '../theme/colors': { colors: {} },
  };
  function load(file) {
    const exports = {};
    const { outputText } = ts.transpileModule(
      readFileSync(new URL(file, import.meta.url), 'utf8'),
      {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
      },
    );
    runInNewContext(outputText, {
      exports,
      require: (name) => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
        return modules[name];
      },
    });
    return exports;
  }
  const { AskQuestionnaire } = load('../src/extensions/ask-user-question.tsx');
  modules['./ask-user-question'] = { AskQuestionnaire };
  const { MobileQuestion } = load('../src/extensions/index.tsx');
  const messages = {
    commands: { subscribe: () => {}, getState: () => ({}), available: () => available },
    answer: async (answer) => {
      sent.push(answer);
      return true;
    },
  };
  return {
    native,
    sent,
    MobileQuestion,
    AskQuestionnaire,
    messages,
    block: () => {
      available = false;
    },
    render: () => {
      index = 0;
      return AskQuestionnaire({ prompt, messages, enabled: true });
    },
  };
}

test('questionnaire is directly interactive in chat and becomes native read-only history after submission', async () => {
  const h = harness();
  let tree = h.render();
  assert.equal(tree.type, h.native.View, 'no modal or opening action');
  const options = () =>
    nodes(tree, h.native.Pressable).filter((node) => node.props.accessibilityRole === 'checkbox');
  options()[0].props.onPress();
  tree = h.render();
  options()[2].props.onPress();
  tree = h.render();
  nodes(tree, h.native.TextInput)
    .find((node) => node.props.accessibilityLabel.startsWith('Custom'))
    .props.onChangeText('Custom detail');
  tree = h.render();
  nodes(tree, h.native.TextInput)
    .find((node) => node.props.accessibilityLabel === 'Note for Approach')
    .props.onChangeText('Question note');
  tree = h.render();
  nodes(tree, h.native.TextInput)
    .find((node) => node.props.accessibilityLabel === 'Note for all answers')
    .props.onChangeText('Global note');
  tree = h.render();
  nodes(tree, h.native.Pressable)
    .find((node) => node.props.accessibilityRole === 'button')
    .props.onPress();
  await new Promise(setImmediate);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0], {
    toolCallId: 'ask-1',
    answers: [
      { questionIndex: 0, optionIndexes: [0], text: 'Custom detail', notes: 'Question note' },
    ],
    globalNote: 'Global note',
  });
  tree = h.render();
  assert.ok(nodes(tree, h.native.Pressable).every((node) => node.props.disabled));

  const args = { questions: prompt.questions };
  const result = {
    role: 'toolResult',
    timestamp: 2,
    toolCallId: 'ask-1',
    toolName: 'ask_user_question',
    content: [{ type: 'text', text: 'Recorded' }],
    details: {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          question: 'Which approach?',
          kind: 'multi',
          selected: ['Second'],
          answer: 'Terminal custom answer',
          notes: 'Terminal note',
        },
      ],
    },
  };
  const rows = conversationRows(
    [
      {
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'toolCall', name: 'ask_user_question', id: 'ask-1', arguments: args }],
      },
      result,
    ],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'question');
  const history = h.MobileQuestion({
    tool: rows[0].tool,
    messages: h.messages,
    enabled: true,
    children: null,
  });
  const text = nodes(history, h.native.Text)
    .flatMap((node) => [node.props.children].flat())
    .join(' ');
  assert.match(text, /Which approach\?/);
  assert.match(text, /Terminal custom answer/);
  assert.match(text, /Terminal note/);
  assert.equal(nodes(history, h.native.Pressable).length, 0, 'history cannot submit');
  assert.equal(
    h.MobileQuestion({
      tool: rows[0].tool,
      prompt,
      messages: h.messages,
      enabled: true,
      children: null,
    }).type,
    h.native.View,
    'a persisted result overrides a stale pending prompt',
  );
  const blocked = harness();
  blocked.block();
  assert.ok(nodes(blocked.render(), blocked.native.Pressable).every((node) => node.props.disabled));
});
