import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as inventory from '../../src/client/inventory.ts';
import { hasUnreadCompletion } from '../../src/shared/session-read-state.ts';
import * as theme from '../src/theme/colors.ts';

test('drawer keeps unread independent from activity and selection, and switches archive tabs', () => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const native = Object.fromEntries(
    ['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [
      name,
      Symbol(name),
    ]),
  );
  const states = [];
  let index = 0;
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
          (next) => {
            states[slot] = typeof next === 'function' ? next(states[slot]) : next;
          },
        ];
      },
      useSyncExternalStore: (_, getState) => getState(),
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...native,
      StyleSheet: { create: (value) => value, hairlineWidth: 1 },
    },
    '../../../../src/client/inventory': inventory,
    '../../../../src/client/relative-time': { relativeTime: () => 'Just now' },
    '../../../../src/shared/session-read-state': { hasUnreadCompletion },
    '../../theme/colors': theme,
    './inventory-action': { InventoryAction: Symbol('InventoryAction') },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/sessions/drawer.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  );
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  const session = {
    id: 'live',
    projectId: 'pim',
    title: 'Working session',
    activity: 'running',
    connection: 'connected',
    archived: false,
    createdAt: new Date().toISOString(),
    readState: { completionId: 'completion', viewedCompletionId: null },
  };
  const props = {
    inventory: {
      projects: [{ id: 'pim', name: 'Pim', directory: '/pim' }],
      sessions: [session, { ...session, id: 'archive', title: 'Archived session', archived: true }],
      selectedId: 'live',
    },
    online: true,
    launches: { subscribe: () => {}, getState: () => ({ status: 'ready' }) },
    messages: () => ({}),
    onSelect: (id) => selected.push(id),
  };
  const selected = [];
  function nodes(element, type) {
    if (!element || typeof element !== 'object') {
      return [];
    }
    return [
      ...(element.type === type ? [element] : []),
      ...[element.props?.children].flat(Infinity).flatMap((child) => nodes(child, type)),
    ];
  }
  function render() {
    index = 0;
    return exports.ProjectDrawer(props);
  }
  let tree = render();
  const row = nodes(tree, native.Pressable).find(
    (node) => node.props.accessibilityLabel === 'Working session, Running, unread',
  );
  assert.equal(row.props.accessibilityState.selected, true);
  assert.equal(nodes(row, native.ActivityIndicator).length, 1);
  assert.ok(nodes(row, native.Text).some((node) => node.props.children === 'Unviewed turn'));
  row.props.onPress();
  assert.deepEqual(selected, ['live']);

  const tabs = nodes(tree, native.Pressable).filter(
    (node) => node.props.accessibilityRole === 'tab',
  );
  assert.equal(tabs[0].props.accessibilityState.selected, true);
  assert.equal(tabs[1].props.accessibilityState.selected, false);
  tabs[1].props.onPress();
  tree = render();
  assert.ok(
    nodes(tree, native.Pressable).some(
      (node) => node.props.accessibilityLabel === 'Archived session, Running, unread',
    ),
  );
  assert.ok(
    !nodes(tree, native.Pressable).some((node) =>
      node.props.accessibilityLabel?.startsWith('Working session,'),
    ),
  );

  props.online = false;
  tree = render();
  assert.ok(
    nodes(tree, native.Pressable).some(
      (node) => node.props.accessibilityLabel === 'Archived session, Saved, unread',
    ),
  );
});
