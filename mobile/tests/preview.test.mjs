import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { conversationScroll } from '../src/features/conversation/scroll.ts';
import { createConversationRows } from '../src/features/conversation/timeline.ts';

test('replaces the empty native list on history arrival, then preserves its identity on updates', () => {
  // Inspect React elements with native imports/hooks stubbed. Actual positioning is
  // checked in the iOS simulator; this pins the reconciliation boundary that fixes it.
  const require = createRequire(new URL('../package.json', import.meta.url));
  const FlatList = Symbol('FlatList');
  const exports = {};
  const modules = {
    react: {
      memo: (component) => component,
      useMemo: (fn) => fn(),
      useRef: () => ({ current: null }),
      useState: (value) => [value, () => {}],
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { FlatList, Platform: { OS: 'ios' }, StyleSheet: { create: (value) => value } },
    '../../theme/colors': { colors: {} },
    '../../extensions': { MobileQuestion: Symbol('MobileQuestion') },
    './display': { MobileDisplay: Symbol('MobileDisplay') },
    './markdown': {},
    './scroll': { conversationScroll },
    './timeline': { createConversationRows },
    './codemode': {},
    './status-bar-scroll': { StatusBarScrollTarget: Symbol('StatusBarScrollTarget') },
  };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/conversation/preview.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  );
  runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  const render = (messages, extensions = {}) => {
    const element = exports.ConversationPreview({
      connection: {
        snapshot: messages === null ? null : { view: { messages, tools: [], extensions } },
      },
      onFollowing: () => {},
    });
    return element.props.children.find((child) => child?.type === FlatList);
  };
  const empty = render(null);
  const message = { role: 'assistant', timestamp: 1, content: 'Loaded history' };
  const loaded = render([message]);
  assert.notEqual(
    loaded.key,
    empty.key,
    'native anchoring must not retain the placeholder position',
  );
  assert.equal(render([]).key, empty.key);
  assert.equal(render([message, { ...message, timestamp: 2 }]).key, loaded.key);
  assert.equal(render([{ ...message, content: 'Streaming update' }]).key, loaded.key);
  const prompt = { toolCallId: 'ask-1', questions: [] };
  const extensions = { 'ask-user-question': [prompt] };
  const pending = render([message], extensions);
  assert.equal(pending.props.data[0].kind, 'question');
  const question = pending.props.renderItem({ item: pending.props.data[0] });
  assert.equal(question.props.prompt, prompt);
  const withCall = render(
    [
      message,
      {
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'toolCall', id: 'ask-1', name: 'ask_user_question', arguments: {} }],
      },
    ],
    extensions,
  );
  assert.equal(withCall.props.data.filter((row) => row.kind === 'question').length, 1);
  assert.equal(
    withCall.props.data[0].key,
    pending.props.data[0].key,
    'late call preserves the draft row identity',
  );
  assert.equal(loaded.props.inverted, true);
  assert.equal(
    loaded.props.contentContainerStyle.flexGrow,
    undefined,
    'short history must not grow blank space that native anchoring can preserve on keyboard resize',
  );
  assert.equal(loaded.props.contentContainerStyle.justifyContent, undefined);
  assert.ok(
    loaded.props.maintainVisibleContentPosition,
    'keep anchoring while reading older messages',
  );
});
