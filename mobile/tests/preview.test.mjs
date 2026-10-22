import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { conversationScroll } from '../src/features/conversation/scroll.ts';
import { conversationRows } from '../src/features/conversation/timeline.ts';

test('replaces the empty native list on history arrival, then preserves its identity on updates', () => {
  // Inspect React elements with native imports/hooks stubbed. Actual positioning is
  // checked in the iOS simulator; this pins the reconciliation boundary that fixes it.
  const require = createRequire(new URL('../package.json', import.meta.url));
  const FlatList = Symbol('FlatList');
  const exports = {};
  const modules = {
    react: {
      useMemo: (fn) => fn(),
      useRef: () => ({ current: null }),
      useState: (value) => [value, () => {}],
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { FlatList, Platform: { OS: 'ios' }, StyleSheet: { create: (value) => value } },
    '../../theme/colors': { colors: {} },
    './markdown': {},
    './scroll': { conversationScroll },
    './timeline': { conversationRows },
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
  const render = (messages) => {
    const element = exports.ConversationPreview({
      connection: {
        snapshot: messages === null ? null : { view: { messages, tools: [] } },
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
  assert.ok(
    loaded.props.maintainVisibleContentPosition,
    'keep anchoring while reading older messages',
  );
});
