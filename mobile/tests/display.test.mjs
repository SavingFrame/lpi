import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  DEFAULT_DISPLAY_THEME,
  displayContentHeight,
  displayNavigationAllowed,
  MAX_DISPLAY_HEIGHT,
  MIN_DISPLAY_HEIGHT,
} from '../../src/shared/display.ts';
import { displayDocument } from '../../src/shared/display-document.ts';
import { conversationRows } from '../src/features/conversation/timeline.ts';
import { colors } from '../src/theme/colors.ts';

test('saved visuals sit outside mobile tool groups and the native callback accepts only bounded size reports', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const WebView = Symbol('WebView');
  const Image = Symbol('Image');
  const updates = [];
  const modules = {
    react: {
      useId: () => 'preview',
      useMemo: (fn) => fn(),
      useState: (initial) => [initial, (value) => updates.push(value)],
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Image, StyleSheet: { create: (value) => value } },
    'react-native-webview': { WebView },
    '../../../../src/shared/display': {
      DEFAULT_DISPLAY_THEME,
      displayContentHeight,
      displayNavigationAllowed,
      MIN_DISPLAY_HEIGHT,
    },
    '../../../../src/shared/display-document': { displayDocument },
    '../../theme/colors': { colors },
    './markdown': {},
  };
  const exports = {};
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/conversation/display.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    },
  );
  runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
  });
  const artifact = {
    version: 1,
    kind: 'html',
    title: 'Chart',
    filename: 'chart.html',
    summary: 'A chart.',
    html: '</iframe><script>parent.evil()</script>',
  };
  const result = {
    role: 'toolResult',
    toolName: 'show',
    toolCallId: 'show-1',
    timestamp: 2,
    content: [{ type: 'text', text: 'Displayed chart.' }],
    details: { pimDisplay: artifact },
  };
  assert.equal(
    conversationRows([result], [])[0].artifact.html,
    artifact.html,
    'orphan history retains display metadata',
  );
  const rows = conversationRows(
    [
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          { type: 'toolCall', id: 'read-before', name: 'read', arguments: {} },
          { type: 'toolCall', id: 'show-1', name: 'show', arguments: { html: artifact.html } },
          { type: 'toolCall', id: 'read-after', name: 'read', arguments: {} },
        ],
      },
      result,
    ],
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['tools', 'display', 'tools'],
  );
  assert.equal(conversationRows([{ ...result, isError: true }], [])[0].kind, 'tools');
  const element = exports.MobileDisplay({ artifact, onInspect: () => {} });
  const preview = element.props.children.find((child) => typeof child?.type === 'function');
  const webview = preview.type(preview.props);
  assert.equal(webview.type, WebView);
  assert.match(webview.props.source.html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(webview.props.source.html, /<script>parent\.evil/);
  assert.equal(webview.props.scrollEnabled, false, 'the conversation owns scrolling');
  assert.equal(webview.props.incognito, true);
  const initial = JSON.parse(/const initial = (.*);/.exec(webview.props.source.html)[1]);
  assert.equal(initial.theme.background, colors.background);
  const report = (data) => webview.props.onMessage({ nativeEvent: { data } });
  for (const invalid of [
    'not json',
    'x'.repeat(257),
    JSON.stringify({ type: 'prompt', message: 'Run a command' }),
    JSON.stringify({ type: 'pim-display-size', id: 'old-preview', height: 900 }),
    JSON.stringify({ type: 'pim-display-size', id: initial.id, height: -1 }),
  ]) {
    report(invalid);
  }
  assert.equal(updates.length, 0, 'malformed, stale and action messages do nothing');
  report(JSON.stringify({ type: 'pim-display-size', id: initial.id, height: 700 }));
  assert.equal(updates.at(-1).height, 700);
  report(JSON.stringify({ type: 'pim-display-size', id: initial.id, height: 1e9 }));
  assert.equal(updates.at(-1).height, MAX_DISPLAY_HEIGHT);
  for (const key of [
    'allowFileAccess',
    'allowFileAccessFromFileURLs',
    'allowUniversalAccessFromFileURLs',
    'sharedCookiesEnabled',
    'thirdPartyCookiesEnabled',
    'domStorageEnabled',
    'javaScriptCanOpenWindowsAutomatically',
  ]) {
    assert.equal(webview.props[key], false, key);
  }
  for (const url of [
    'https://example.com',
    'http://localhost:3141/sessions',
    'file:///etc/passwd',
    'javascript:evil()',
    'data:text/html,evil',
    'about:blank#external',
  ]) {
    assert.equal(webview.props.onShouldStartLoadWithRequest({ url }), false, url);
  }
  assert.equal(webview.props.onShouldStartLoadWithRequest({ url: 'about:blank' }), true);
  assert.equal(webview.props.onShouldStartLoadWithRequest({ url: 'about:srcdoc' }), true);
});
