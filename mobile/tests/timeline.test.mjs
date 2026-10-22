import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationRows, toolPreview } from '../src/features/conversation/timeline.ts';

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
