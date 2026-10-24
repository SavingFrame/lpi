import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, view as parseView, reduceEvent } from '../../src/shared/client-state.ts';
import { createConversationRows } from '../src/features/conversation/timeline.ts';

const script = {
  role: 'assistant',
  timestamp: 1,
  content: [{ type: 'toolCall', id: 'script', name: 'codemode', arguments: { code: 'return 1;' } }],
};
const parent = { toolCallId: 'script', toolName: 'codemode', args: { code: 'return 1;' } };
const child = {
  toolCallId: 'script/1',
  parentToolCallId: 'script',
  toolName: 'read',
  args: { path: 'a.ts' },
};
const metadata = (status) => ({
  calls: [{ id: 'script/1', name: 'read', args: '{"path":"a.ts"}', status }],
});

test('codemode owns nested progress from the first event through the saved result', () => {
  let view = { ...emptyView(), running: true, messages: [script] };
  const project = createConversationRows();
  const render = () => project(view.messages, view.tools, view.running);
  view = reduceEvent(view, { type: 'tool_execution_start', ...parent });
  const started = render();
  assert.equal(started[0].kind, 'codemode');
  view = reduceEvent(view, { type: 'tool_execution_start', ...child });
  view = parseView(view);
  assert.equal(view.tools[1].parentToolCallId, 'script', 'snapshot hydration preserves ownership');
  const nested = render();
  assert.deepEqual(
    nested.map((row) => row.kind),
    ['codemode', 'codemode-call', 'codemode-details'],
  );
  assert.equal(nested[0].key, started[0].key);
  assert.equal(nested[1].call.name, 'read');
  view = reduceEvent(view, {
    type: 'tool_execution_update',
    ...parent,
    partialResult: { content: [], details: metadata('running') },
  });
  const progress = render();
  assert.equal(progress[1].key, nested[1].key, 'metadata must reuse the initial nested row');
  view = reduceEvent(view, { type: 'tool_execution_end', ...child });
  view = reduceEvent(view, { type: 'tool_execution_end', ...parent });
  const awaitingHistory = render();
  assert.deepEqual(
    awaitingHistory.map((row) => row.key),
    progress.map((row) => row.key),
  );
  assert.equal(
    awaitingHistory[1].call.status,
    'running',
    'do not empty the group before persistence arrives',
  );
  view = reduceEvent(view, {
    type: 'message_end',
    message: {
      role: 'toolResult',
      timestamp: 2,
      toolCallId: 'script',
      toolName: 'codemode',
      content: [{ type: 'text', text: 'Done' }],
      details: metadata('ok'),
    },
  });
  const completed = render();
  assert.deepEqual(
    completed.map((row) => row.key),
    progress.map((row) => row.key),
  );
  assert.equal(completed[0].tool.status, 'complete');
  assert.equal(completed[1].call.status, 'ok');
  assert.equal(progress[1].call.status, 'running', 'published progress stays immutable');
});

test('settling without a saved result clears provisional nested progress', () => {
  let view = { ...emptyView(), running: true, messages: [script] };
  const project = createConversationRows();
  view = reduceEvent(view, { type: 'tool_execution_start', ...parent });
  view = reduceEvent(view, { type: 'tool_execution_start', ...child });
  project(view.messages, view.tools, view.running);
  view = reduceEvent(view, { type: 'agent_settled' });
  const rows = project(view.messages, view.tools, view.running);
  assert.equal(
    rows.some((row) => row.kind === 'codemode-call'),
    false,
  );
  assert.equal(rows[0].tool.status, 'unknown');
});
