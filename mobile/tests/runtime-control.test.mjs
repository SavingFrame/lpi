import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('header resume requires confirmation and stays blocked for unknown outcomes', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  let state = { status: 'ready', error: null };
  let dialog;
  let resumed = 0;
  let reviewed = 0;
  let open = false;
  const RuntimeButton = Symbol('RuntimeButton');
  const Pressable = Symbol('Pressable');
  const modules = {
    react: { useEffect: () => {}, useSyncExternalStore: (_, getState) => getState() },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      Alert: { alert: (...args) => (dialog = args) },
      Pressable,
      StyleSheet: { create: (value) => value },
      Text: Symbol('Text'),
      View: Symbol('View'),
    },
    '../../theme/colors': { colors: { success: 'green' } },
    './runtime-button': { RuntimeButton },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/sessions/resume.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  );
  runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  const client = {
    launches: {
      subscribe: () => {},
      getState: () => state,
      review: () => reviewed++,
    },
    resumeSession: (id) => {
      assert.equal(id, 'saved');
      resumed++;
    },
  };
  let control;
  const render = (enabled = true) =>
    exports.ResumeSession({
      client,
      id: 'saved',
      enabled,
      onOpen: (value) => (open = value),
      renderHeader: (button) => {
        control = button;
        return button;
      },
    });
  render();
  assert.equal(control.type, RuntimeButton);
  assert.equal(control.props.label, 'Resume runtime');
  assert.equal(control.props.color, 'green');
  assert.equal(control.props.disabled, false);
  control.props.onPress();
  assert.equal(open, true);
  assert.equal(resumed, 0);
  dialog[2][0].onPress();
  assert.equal(open, false);
  assert.equal(resumed, 0);
  control.props.onPress();
  dialog[2][1].onPress();
  assert.equal(open, false);
  assert.equal(resumed, 1);
  render(false);
  assert.equal(control.props.disabled, true);
  state = { status: 'pending', error: null };
  render();
  assert.equal(control.props.pending, true);
  assert.equal(control.props.disabled, true);
  state = { status: 'uncertain', error: { message: 'Unknown outcome' } };
  const tree = render();
  assert.equal(control.props.disabled, true);
  const notice = tree.props.children[1];
  assert.equal(notice.props.children[0].props.children, 'Unknown outcome');
  const review = notice.props.children[1].props.children[1];
  assert.equal(review.type, Pressable);
  review.props.onPress();
  assert.equal(open, true);
  dialog[2][1].onPress();
  assert.equal(open, false);
  assert.equal(reviewed, 1);
  assert.equal(resumed, 1, 'review must never retry resume');
});
