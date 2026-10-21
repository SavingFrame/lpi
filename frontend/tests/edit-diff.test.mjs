import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, reduceEvent } from '../../src/shared/client-state.ts';
import { editDiff } from '../src/edit-diff.ts';
import { transcriptState } from '../src/transcript-state.ts';

export const patch =
  '--- src/example.ts\n+++ src/example.ts\n@@ -1,2 +1,2 @@\n-const value = 1;\n+const value = 2;\n export { value };\n';
const result = {
  role: 'toolResult',
  timestamp: 2,
  toolName: 'edit',
  toolCallId: 'edit-1',
  isError: false,
  content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
  details: { patch },
};

test('saved and live edit results use the applied patch, not requested replacements', () => {
  const message = {
    role: 'assistant',
    timestamp: 1,
    content: [
      {
        type: 'toolCall',
        id: 'edit-1',
        name: 'edit',
        arguments: {
          path: 'src/example.ts',
          edits: [{ oldText: 'not the applied text', newText: 'also not applied' }],
        },
      },
    ],
  };
  const saved = { ...emptyView(), messages: [message, result] };
  const savedDiff = editDiff(transcriptState(saved).tools.get('edit-1'));
  assert.equal(savedDiff.name, 'src/example.ts');
  assert.deepEqual(savedDiff.additionLines, ['const value = 2;\n', 'export { value };\n']);
  let live = { ...emptyView(), running: true, messages: [message] };
  live = reduceEvent(live, {
    type: 'tool_execution_start',
    toolCallId: 'edit-1',
    toolName: 'edit',
    args: message.content[0].arguments,
  });
  assert.equal(editDiff(transcriptState(live).tools.get('edit-1')), undefined);
  live = reduceEvent(live, { type: 'message_end', message: result });
  assert.deepEqual(editDiff(transcriptState(live).tools.get('edit-1')), savedDiff);
  assert.ok(
    editDiff({ name: 'edit', status: 'Completed', result }),
    'unpaired saved result needs no arguments',
  );
});

test('unavailable, failed and malformed patches retain the ordinary tool display', () => {
  const tool = { name: 'edit', status: 'Completed', result };
  for (const details of [
    undefined,
    null,
    [],
    'bad',
    { diff: '-1 old\n+1 new' },
    { patch: 12 },
    { patch: '' },
    { patch: 'not a patch' },
    { patch: '--- a\n+++ a\n' },
  ]) {
    assert.equal(editDiff({ ...tool, result: { ...result, details } }), undefined);
  }
  assert.equal(editDiff({ ...tool, name: 'bash' }), undefined);
  assert.equal(editDiff({ ...tool, status: 'Failed' }), undefined);
  assert.equal(editDiff({ ...tool, result: { ...result, isError: true } }), undefined);
  assert.equal(
    editDiff({
      ...tool,
      result: {
        ...result,
        details: { patch: `${patch}--- other.ts\n+++ other.ts\n@@ -1 +1 @@\n-a\n+b\n` },
      },
    }),
    undefined,
  );
});
