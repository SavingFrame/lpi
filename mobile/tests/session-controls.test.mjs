import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('mobile settings search scoped models, submit selections, and respect the shared command guard', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const native = Object.fromEntries(
    ['KeyboardAvoidingView', 'Modal', 'Pressable', 'SectionList', 'Text', 'TextInput', 'View'].map(
      (name) => [name, Symbol(name)],
    ),
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
          states[slot] = initial;
        }
        return [states[slot], (value) => (states[slot] = value)];
      },
      useSyncExternalStore: (_, getState) => getState(),
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...native,
      Platform: { OS: 'ios' },
      Keyboard: { dismiss: () => {} },
      StyleSheet: { create: (value) => value },
    },
    'react-native-safe-area-context': { SafeAreaView: Symbol('SafeAreaView') },
    '../../theme/colors': { colors: {} },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(
    readFileSync(
      new URL('../src/features/conversation/session-controls.tsx', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  );
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  const first = { provider: 'alpha', id: 'first', name: 'First' };
  const second = { provider: 'beta', id: 'second', name: 'Second' };
  const controls = {
    model: first,
    availableModels: [first, second],
    scopedModels: [second],
    thinkingLevel: 'low',
    availableThinkingLevels: ['off', 'low', 'max'],
  };
  const messages = {
    commands: {
      subscribe: () => {},
      getState: () => ({}),
      available: () => available,
      submit: (command) => sent.push(JSON.parse(JSON.stringify(command))),
    },
  };
  function nodes(element, type) {
    if (!element || typeof element !== 'object') {
      return [];
    }
    const children = [element.props?.children].flat(Infinity);
    return [
      ...(element.type === type ? [element] : []),
      ...children.flatMap((child) => nodes(child, type)),
    ];
  }
  function render(enabled = true) {
    index = 0;
    return exports.MobileSessionControls({ controls, messages, enabled, onOpen: () => {} });
  }
  let tree = render();
  assert.match(
    nodes(tree, native.Pressable)[0].props.accessibilityLabel,
    /alpha \/ First, thinking low/,
  );
  nodes(tree, native.Pressable)[0].props.onPress();
  tree = render();
  assert.equal(nodes(tree, native.Modal)[0].props.transparent, true);
  let list = nodes(tree, native.SectionList)[0];
  assert.equal(list.props.sections[0].title, 'Pi scoped models');
  assert.equal(list.props.sections[0].data[0], second);
  nodes(tree, native.TextInput)[0].props.onChangeText('BETA second');
  tree = render();
  list = nodes(tree, native.SectionList)[0];
  assert.equal(list.props.sections.length, 1);
  list.props.renderItem({ item: second }).props.onPress();
  assert.deepEqual(sent, [{ type: 'set_model', provider: 'beta', modelId: 'second' }]);
  assert.equal(
    nodes(render(), native.Modal)[0].props.visible,
    true,
    'both settings stay in one sheet',
  );
  controls.model = second;
  controls.availableThinkingLevels = ['off', 'low', 'max'];
  tree = render();
  const levels = nodes(tree, native.Pressable).filter(
    (node) => node.props.accessibilityRole === 'radio',
  );
  assert.deepEqual(
    levels.map((node) => node.props.accessibilityLabel),
    ['Thinking off', 'Thinking low', 'Thinking max'],
  );
  assert.equal(levels[1].props.accessibilityState.checked, true);
  levels[2].props.onPress();
  assert.deepEqual(sent[1], { type: 'set_thinking_level', level: 'max' });

  available = false;
  tree = render();
  assert.equal(nodes(tree, native.Pressable)[0].props.disabled, true);
  const blocked = nodes(tree, native.Pressable).find(
    (node) => node.props.accessibilityLabel === 'Thinking max',
  );
  assert.equal(blocked.props.disabled, true);
  blocked.props.onPress();
  assert.equal(sent.length, 2, 'unknown/pending command state must not dispatch settings');
  available = true;
  assert.equal(nodes(render(false), native.Pressable)[0].props.disabled, true);
  controls.availableThinkingLevels = [];
  assert.equal(
    nodes(render(), native.Pressable).filter((node) => node.props.accessibilityRole === 'radio')
      .length,
    0,
  );
  nodes(render(), native.Pressable)
    .find((node) => node.props.accessibilityLabel === 'Close model and thinking settings')
    .props.onPress();
  assert.equal(nodes(render(), native.Modal)[0].props.visible, false);
  assert.equal(sent.length, 2, 'closing does not send anything');
});
