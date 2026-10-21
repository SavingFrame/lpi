import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { emptyView, view } from '../dist/shared/client-state.js';
import { bridgeCommand } from '../dist/shared/commands.js';
import { inventorySession, project, promptTitle, session } from '../dist/shared/sessions.js';
import {
  bridgeSnapshot,
  bridgeStatus,
  projectEvent,
  projectStatus,
  snapshot,
} from '../dist/shared/snapshots.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const shared = join(root, 'src/shared');
const support = join(root, 'src/extension-support');

function imports(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  return source.statements.filter(ts.isImportDeclaration).map((statement) => ({
    specifier: statement.moduleSpecifier.text,
    typeOnly:
      statement.importClause?.isTypeOnly ||
      (statement.importClause?.name === undefined &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)),
  }));
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('shared runtime dependencies stay browser-safe, including extension contracts', () => {
  const pending = files(shared);
  const visited = new Set();
  for (const path of pending) {
    if (visited.has(path)) {
      continue;
    }
    visited.add(path);
    assert.ok(path.startsWith(`${shared}/`) || path.startsWith(`${support}/`), path);
    for (const { specifier, typeOnly } of imports(path)) {
      if (!specifier.startsWith('.')) {
        assert.ok(typeOnly, `${path} imports runtime package ${specifier}`);
        continue;
      }
      const target = resolve(dirname(path), specifier.replace(/\.js$/, '.ts'));
      assert.ok(target.startsWith(`${shared}/`) || target.startsWith(`${support}/`), target);
      if (!typeOnly) {
        pending.push(target);
      }
    }
  }
});

test('frontend imports shared contracts instead of server implementations, even for types', () => {
  const server = join(root, 'src');
  for (const path of files(join(root, 'frontend/src'))) {
    for (const { specifier } of imports(path)) {
      if (!specifier.startsWith('.')) {
        continue;
      }
      const target = resolve(dirname(path), specifier);
      if (target.startsWith(`${server}/`)) {
        assert.ok(target.startsWith(`${shared}/`) || target.startsWith(`${support}/`), target);
      }
    }
  }
});

const native = () => ({
  state: { isStreaming: false, hasPendingMessages: false, sessionName: 'Test' },
  controls: {
    availableModels: [],
    scopedModels: [],
    model: null,
    thinkingLevel: null,
    availableThinkingLevels: [],
    contextUsage: null,
  },
  view: emptyView(),
});

const identity = {
  id: '11111111-1111-1111-1111-111111111111',
  projectId: 'project',
  directory: '/isolated/project',
  file: '/isolated/session.jsonl',
  createdAt: '2026-01-01T00:00:00Z',
  piSessionId: 'native',
  connection: 'connected',
  generation: 3,
};

function envelope(branch) {
  return {
    ...branch,
    epoch: 'relay-epoch',
    cursor: 7,
    session: identity,
    readState: { completionId: null, viewedCompletionId: null },
  };
}

test('shared snapshot parsers accept native and saved history without requiring a runtime', () => {
  const live = bridgeSnapshot(native());
  assert.equal(live.state.nativeTui, true);
  assert.equal(live.state.readOnly, false);
  assert.deepEqual(snapshot(envelope(live)), envelope(live));
  const saved = envelope({ ...native(), state: { readOnly: true, bridgeConnected: false } });
  saved.session = { ...identity, connection: 'disconnected' };
  assert.deepEqual(snapshot(saved), saved);
  assert.throws(() => bridgeSnapshot(saved), /Invalid native status/);
});

test('bridge and browser snapshots share bounded view and control validation', () => {
  const invalidViews = [
    { ...emptyView(), tools: [{ id: '', name: 'read' }] },
    { ...emptyView(), tools: Array(513).fill({ id: 'tool', name: 'read' }) },
    { ...emptyView(), partial: { role: 'assistant', timestamp: 'invalid' } },
    { ...emptyView(), messages: [{ role: 'user', timestamp: 1, content: [null] }] },
    { ...emptyView(), notice: 42 },
    { ...emptyView(), extensions: { unsupported: [] } },
  ];
  for (const invalid of invalidViews) {
    assert.throws(() => view(invalid));
    assert.throws(() => bridgeSnapshot({ ...native(), view: invalid }));
    assert.throws(() => snapshot(envelope({ ...native(), view: invalid })));
  }
  const invalid = { ...native(), controls: { ...native().controls, availableModels: [{}] } };
  assert.throws(() => bridgeSnapshot(invalid));
  assert.throws(() => snapshot(envelope(invalid)));
  assert.throws(() => bridgeStatus({ ...native(), notice: null, state: {} }));
  assert.throws(() => bridgeStatus({ ...native(), notice: 42 }));
});

test('metadata projection preserves transcript references and native event projection is immutable', () => {
  const initial = bridgeSnapshot(native());
  const status = bridgeStatus({
    ...native(),
    state: { isStreaming: false, hasPendingMessages: true },
    notice: 'Native dialog',
  });
  const updated = projectStatus(initial, status);
  assert.equal(updated.view.messages, initial.view.messages);
  assert.equal(updated.view.tools, initial.view.tools);
  assert.equal(updated.view.notice, 'Native dialog');
  assert.equal(updated.state.hasPendingMessages, true);
  assert.equal(initial.view.notice, null);
  const running = projectEvent(updated, { type: 'agent_start' });
  assert.equal(running.state.isStreaming, true);
  assert.equal(initial.view.running, false);
  const waiting = projectEvent(running, {
    type: 'extension_support',
    extensions: {},
    notice: 'Answer in terminal',
  });
  assert.equal(waiting.state.pendingDialog, 'Answer in terminal');
  const settled = projectEvent(waiting, { type: 'agent_settled' });
  assert.equal(settled.view.running, false);
  assert.equal(settled.state.isStreaming, false);
  assert.equal(settled.view.partial, null);
  assert.deepEqual(settled.view.tools, []);
});

test('shared inventory models validate metadata and title extraction has no service dependency', () => {
  const record = { ...identity, activity: 'idle', readState: envelope(native()).readState };
  assert.deepEqual(inventorySession(record), record);
  assert.deepEqual(session(identity), identity);
  assert.deepEqual(project({ id: 'project', name: 'Project', directory: '/isolated' }), {
    id: 'project',
    name: 'Project',
    directory: '/isolated',
  });
  assert.throws(() => inventorySession({ ...record, activity: 'invalid' }));
  assert.throws(() => inventorySession({ ...record, readState: {} }));
  assert.throws(() => project({ id: 'project' }));
  assert.equal(promptTitle([{ type: 'text', text: '  First\nmessage  ' }]), 'First message');
  assert.equal(promptTitle([{ type: 'image' }]), undefined);
  assert.equal(promptTitle('x'.repeat(200)).length, 160);
  assert.deepEqual(bridgeCommand({ type: 'abort', ignored: true }), { type: 'abort' });
});
