import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('composer dismisses the keyboard only after an accepted send, not failure or stop', async () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  let dismissals = 0;
  let resolveSend;
  const submitted = [];
  const native = Object.fromEntries(
    ['ActivityIndicator', 'Pressable', 'Text', 'TextInput', 'View'].map((name) => [
      name,
      Symbol(name),
    ]),
  );
  const modules = {
    react: {
      useEffect: () => {},
      useSyncExternalStore: (_, getState) => getState(),
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...native,
      Keyboard: { dismiss: () => dismissals++ },
      StyleSheet: { create: (value) => value },
    },
    '../../theme/colors': { colors: {} },
    './attachments': { AttachmentPicker: Symbol('AttachmentPicker') },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/conversation/composer.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  );
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  let text = 'Hello';
  const messages = {
    commands: {
      subscribe: () => {},
      getState: () => ({}),
      available: () => true,
      submit: async (command) => submitted.push(command.type),
    },
    draft: {
      subscribe: () => {},
      getState: () => ({ draft: { text, images: [] } }),
    },
    send: () => new Promise((resolve) => (resolveSend = resolve)),
  };
  function button(element) {
    if (!element || typeof element !== 'object') {
      return undefined;
    }
    if (element.type === native.Pressable) {
      return element;
    }
    return [element.props?.children].flat(Infinity).map(button).find(Boolean);
  }
  function render(running = false) {
    return button(
      exports.MessageComposer({ messages, running, picking: false, onPicking: () => {} }),
    );
  }
  const sending = render().props.onPress();
  assert.equal(dismissals, 0, 'keep the keyboard open while waiting for acceptance');
  resolveSend(true);
  await sending;
  assert.equal(dismissals, 1);

  const failing = render().props.onPress();
  resolveSend(false);
  await failing;
  assert.equal(dismissals, 1, 'failed sends leave the keyboard open');

  text = '';
  const stop = render(true);
  assert.equal(stop.props.accessibilityLabel, 'Stop Pi');
  await stop.props.onPress();
  assert.deepEqual(submitted, ['abort']);
  assert.equal(dismissals, 1, 'stopping does not dismiss the keyboard');
});
