import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, reduceEvent } from '../../src/shared/client-state.ts';
import { writePreview } from '../src/session/transcript/tools/write-preview.ts';
import { transcriptState } from '../src/session/transcript/transcript-state.ts';

test('saved and live writes preview requested content independently of execution status', () => {
  const args = { path: 'src/example.ts', content: 'const value = 1;\n' };
  const message = {
    role: 'assistant',
    timestamp: 1,
    content: [{ type: 'toolCall', id: 'write-1', name: 'write', arguments: args }],
  };
  const expected = { name: args.path, contents: args.content };
  const saved = { ...emptyView(), messages: [message] };
  assert.deepEqual(writePreview(transcriptState(saved).tools.get('write-1')), expected);
  const live = reduceEvent(
    { ...emptyView(), running: true },
    { type: 'tool_execution_start', toolCallId: 'write-1', toolName: 'write', args },
  );
  assert.deepEqual(writePreview(transcriptState(live).tools.get('write-1')), expected);
  assert.deepEqual(writePreview({ name: 'write', args, status: 'Failed' }), expected);
  assert.deepEqual(
    writePreview({ name: 'write', args: { ...args, content: '' }, status: 'Completed' }),
    { name: args.path, contents: '' },
  );
});

test('missing or malformed write arguments retain the ordinary tool display', () => {
  for (const args of [undefined, null, [], 'bad', {}, { path: 'a' }, { path: 1, content: 'a' }]) {
    assert.equal(writePreview({ name: 'write', args, status: 'Completed' }), undefined);
  }
  assert.equal(
    writePreview({ name: 'edit', args: { path: 'a', content: 'b' }, status: 'Completed' }),
    undefined,
  );
});
