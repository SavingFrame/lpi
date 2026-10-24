import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, reduceEvent } from '../../src/shared/client-state.ts';
import {
  conversationRows,
  createConversationRows,
  toolPreview,
} from '../src/features/conversation/timeline.ts';

const assistant = (content) => ({ role: 'assistant', timestamp: 1, content });
const call = (id, path) => ({ type: 'toolCall', id, name: 'read', arguments: { path } });
const result = (id, text, isError = false) => ({
  role: 'toolResult',
  timestamp: 2,
  toolCallId: id,
  toolName: 'read',
  isError,
  content: [{ type: 'text', text }],
});

test('long tool-only runs stay virtualizable and preserve unchanged rows during streaming', () => {
  const history = [];
  for (let i = 0; i < 1000; i++) {
    history.push(assistant([call(String(i), `${i}.ts`)]), result(String(i), `output ${i}`));
  }
  const project = createConversationRows();
  const initial = project(history, []);
  assert.ok(initial.length > 1, 'a tool-only run must not become one unbounded native row');
  assert.ok(initial.every((row) => row.kind === 'tools' && row.tools.length <= 12));
  assert.equal(initial.flatMap((row) => row.tools).length, 1000, 'all tools remain inspectable');
  const streaming = project([...history, assistant('First token')], []);
  const updated = project([...history, assistant('Next token')], []);
  assert.equal(streaming[0], initial[0], 'completed rows can skip React rendering');
  assert.equal(updated[0], initial[0]);
  assert.notEqual(updated.at(-1), streaming.at(-1));
  assert.equal(streaming.at(-1).blocks[0].text, 'First token', 'old rows remain immutable');
  const withCall = [...history, assistant([call('live', 'live.ts')])];
  const progress = project(withCall, [
    { id: 'live', name: 'read', args: {}, result: { text: 'partial' } },
  ]);
  const nextProgress = project(withCall, [
    { id: 'live', name: 'read', args: {}, result: { text: 'new output' } },
  ]);
  assert.equal(nextProgress[0], initial[0]);
  assert.match(progress.at(-1).tools.at(-1).output, /partial/);
  assert.match(nextProgress.at(-1).tools.at(-1).output, /new output/);
  const replacement = project([{ role: 'user', timestamp: 3, content: 'Different branch' }], []);
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0].blocks[0].text, 'Different branch');
});

test('hides all thinking and empty assistant content while grouping paired tools in order', () => {
  const rows = conversationRows(
    [
      assistant([
        { type: 'thinking', thinking: '' },
        { type: 'thinking', thinking: 'Hidden' },
      ]),
      assistant('  '),
      assistant([{ type: 'text', text: '\n' }]),
      assistant([
        { type: 'thinking', thinking: '**Plan**\n\nInspect the files.' },
        call('a', 'first.ts'),
        call('b', 'second.ts'),
      ]),
      result('b', 'second output', true),
      result('a', 'first output'),
      assistant([{ type: 'thinking', thinking: 'Check another file.' }, call('c', 'third.ts')]),
      result('c', 'third output'),
      assistant([{ type: 'text', text: 'Finished.' }]),
      { role: 'user', timestamp: 3, content: 'Next request' },
      assistant([call('d', 'fourth.ts')]),
    ],
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['tools', 'message', 'message', 'tools'],
  );
  const tools = rows[0].tools;
  assert.equal(tools.length, 3);
  assert.equal(tools[0].preview, 'first.ts');
  assert.equal(JSON.parse(tools[0].arguments).path, 'first.ts');
  assert.equal(tools[0].output, 'first output');
  assert.equal(tools[0].status, 'complete');
  assert.equal(tools[1].output, 'second output');
  assert.equal(tools[1].status, 'error');
  assert.equal(tools[2].output, 'third output');
  assert.equal(rows[1].blocks[0].text, 'Finished.');
  assert.equal(rows[2].role, 'user');
  assert.equal(rows[3].tools.length, 1, 'user messages must start a separate group');
  assert.deepEqual(
    conversationRows(
      [
        assistant([
          { type: 'thinking', thinking: '' },
          { type: 'thinking', thinking: 'Only reasoning' },
        ]),
      ],
      [],
    ),
    [],
  );
});

test('keeps orphan results and missing results visible without pairing by tool name', () => {
  const rows = conversationRows(
    [
      result('old', 'orphan output'),
      assistant([
        call('a', 'first.ts'),
        { type: 'text', text: 'Between calls' },
        call('b', 'second.ts'),
      ]),
      result(undefined, 'unidentified output'),
    ],
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['tools', 'message', 'tools'],
  );
  assert.equal(rows[0].tools[0].output, 'orphan output');
  assert.equal(rows[0].tools[1].status, 'unknown');
  assert.equal(rows[2].tools[0].status, 'unknown');
  assert.equal(rows[2].tools[1].output, 'unidentified output');
});

test('live calls retain their group and row identities as streamed calls enter history', () => {
  const active = [
    { id: 'a', name: 'read', args: { path: 'first.ts' } },
    { id: 'b', name: 'read', args: { path: 'second.ts' } },
  ];
  const initial = conversationRows([], [active[0]]);
  const parallel = conversationRows([], active);
  const streamed = conversationRows([assistant([call('a', 'first.ts')])], active);
  const saved = conversationRows(
    [
      assistant([call('a', 'first.ts'), call('b', 'second.ts')]),
      result('a', 'first output'),
      result('b', 'second output'),
    ],
    [],
  );
  for (const rows of [parallel, streamed, saved]) {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'tools');
    assert.equal(rows[0].key, initial[0].key, 'the native list must reuse the group');
    assert.equal(rows[0].tools[0].key, initial[0].tools[0].key);
    assert.equal(rows[0].tools[1].key, parallel[0].tools[1].key);
  }
  assert.deepEqual(
    saved[0].tools.map((tool) => tool.status),
    ['complete', 'complete'],
  );
  const orphan = conversationRows([result('a', 'first output')], []);
  assert.equal(orphan[0].key, initial[0].key, 'late orphan results reuse the live group');
});

test('parallel progress updates do not reorder live calls or replace the group anchor', () => {
  let view = emptyView();
  for (const id of ['a', 'b', 'c']) {
    view = reduceEvent(view, {
      type: 'tool_execution_start',
      toolCallId: id,
      toolName: 'read',
      args: { path: `${id}.ts` },
    });
  }
  const initial = conversationRows([], view.tools);
  const before = view;
  view = reduceEvent(view, {
    type: 'tool_execution_update',
    toolCallId: 'a',
    toolName: 'read',
    args: { path: 'a.ts' },
    partialResult: { text: 'progress' },
  });
  assert.deepEqual(
    view.tools.map((tool) => tool.id),
    ['a', 'b', 'c'],
  );
  assert.equal(before.tools[0].result, undefined, 'the previous state stays immutable');
  const updated = conversationRows([], view.tools);
  assert.equal(updated[0].key, initial[0].key);
  assert.deepEqual(
    updated[0].tools.map((tool) => tool.key),
    initial[0].tools.map((tool) => tool.key),
  );
  assert.match(updated[0].tools[0].output, /progress/);
});

test('tool previews show bounded command, path, search, or script hints without changing arguments', () => {
  const command = '  npm run check\n  && npm run build  ';
  assert.equal(toolPreview({ command, path: 'ignored.ts' }), 'npm run check && npm run build');
  assert.equal(
    toolPreview({ path: 'mobile/src/features/conversation/preview.tsx' }),
    'mobile/src/features/conversation/preview.tsx',
  );
  assert.equal(toolPreview({ query: 'some search' }), 'some search');
  assert.equal(toolPreview({ code: 'const x = 1;\ntext(x);' }), 'const x = 1; text(x);');
  assert.equal(toolPreview({ command: ' ', path: 'fallback.ts' }), 'fallback.ts');
  assert.equal(toolPreview({ command: 'x'.repeat(500) }).length, 240);
  for (const value of [undefined, null, [], 1, { command: 5 }, { content: 'not an input hint' }]) {
    assert.equal(toolPreview(value), undefined);
  }
  const rows = conversationRows(
    [assistant([{ type: 'toolCall', id: 'shell', name: 'bash', arguments: { command } }])],
    [],
  );
  assert.equal(rows[0].tools[0].preview, 'npm run check && npm run build');
  assert.equal(JSON.parse(rows[0].tools[0].arguments).command, command);
});

test('live activity updates a matching call once and never replaces a completed result', () => {
  const messages = [
    assistant([call('a', 'first.ts'), call('b', 'second.ts')]),
    result('b', 'final'),
  ];
  const activity = [
    { id: 'a', name: 'read', args: { path: 'first.ts' }, result: { text: 'partial' } },
    { id: 'b', name: 'read', args: {}, result: { text: 'stale' } },
    { id: 'c', name: 'bash', args: { command: 'pwd' } },
  ];
  const before = structuredClone(messages);
  const tools = conversationRows(messages, activity)[0].tools;
  assert.equal(tools.length, 3);
  assert.equal(tools[0].status, 'running');
  assert.match(tools[0].output, /partial/);
  assert.equal(tools[1].status, 'complete');
  assert.equal(tools[1].output, 'final');
  assert.equal(tools[2].name, 'bash');
  assert.equal(tools[2].preview, 'pwd');
  assert.equal(tools[2].status, 'running');
  assert.deepEqual(messages, before, 'presentation must not mutate authoritative history');
});
