import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeCodemodeEdits } from '../dist/extensions/lpi/native/codemode-edits.js';
import { fakePi } from './bridge-fixture.mjs';

const patch = '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n';
const start = (id) => ({ toolCallId: id, toolName: 'codemode', args: {} });
const end = (parent, id, extra = {}) => ({
  toolCallId: id,
  parentToolCallId: parent,
  toolName: 'edit',
  isError: false,
  result: { details: { patch }, content: [{ type: 'text', text: 'Success' }] },
  ...extra,
});
const result = (id, extra = {}) => ({
  toolCallId: id,
  toolName: 'codemode',
  content: [{ type: 'text', text: 'Script failed' }],
  details: { calls: [{ id: `${id}/1`, name: 'edit', status: 'ok' }] },
  isError: true,
  ...extra,
});

test('bridge saves final nested edit patches in parent details without changing model output', async () => {
  const fake = fakePi({ cwd: '/tmp', id: 'test' }, '/tmp/unused.jsonl', {
    type: 'message',
    id: 'entry',
    message: { role: 'user', timestamp: 1, content: 'test' },
  });
  await fake.emit('tool_execution_start', start('script'));
  await fake.emit('tool_execution_start', start('other'));
  // Parallel parents finish children out of order. Argument previews are not used.
  await fake.emit('tool_execution_end', end('other', 'other/1'));
  await fake.emit('tool_execution_end', end('script', 'script/2', { isError: true }));
  await fake.emit('tool_execution_end', end('script', 'script/1'));
  const original = result('script');
  const changes = await fake.emit('tool_result', original);
  assert.deepEqual(Object.keys(changes), ['details']);
  assert.deepEqual(changes.details.calls, original.details.calls);
  assert.deepEqual(changes.details.lpiEditPatches, [{ toolCallId: 'script/1', patch }]);
  assert.equal(original.details.lpiEditPatches, undefined, 'original data is not mutated');
  // This is the data Pi persists, and the same details survive JSONL serialization/resume.
  const persisted = JSON.parse(JSON.stringify({ ...original, ...changes }));
  assert.deepEqual(persisted.content, original.content);
  assert.equal(persisted.isError, true, 'script failure does not erase a successful edit');
  assert.deepEqual(persisted.details.lpiEditPatches, changes.details.lpiEditPatches);
  assert.deepEqual((await fake.emit('tool_result', result('other'))).details.lpiEditPatches, [
    { toolCallId: 'other/1', patch },
  ]);
  assert.equal(await fake.emit('tool_result', original), undefined, 'pending state is released');
  await fake.emit('session_shutdown');
});

test('only final successful direct codemode children are captured, and reset drops pending data', () => {
  const edits = new NativeCodemodeEdits();
  edits.start(start('script'));
  edits.end(end('unknown', 'unknown/1'));
  edits.end(end('script/1', 'script/1/1'));
  edits.end(end('script', 'script/2', { isError: true }));
  edits.end(end('script', 'script/3', { toolName: 'write' }));
  edits.end(end('script', 'script/4', { result: { details: { patch: 1 } } }));
  edits.end(end('script', 'script/5', { result: { details: undefined } }));
  assert.equal(edits.result(result('script')), undefined);
  edits.start(start('script'));
  edits.end(end('script', 'script/1'));
  edits.clear();
  edits.end(end('script', 'script/2'));
  assert.equal(edits.result(result('script')), undefined);
  edits.start(start('script'));
  edits.end({ ...start('script'), isError: true });
  assert.equal(edits.result(result('script')), undefined, 'execution without a result is released');
});

test('storage limits omit whole patches and preserve other parent details', () => {
  const edits = new NativeCodemodeEdits();
  edits.start(start('script'));
  edits.end(
    end('script', 'script/1', { result: { details: { patch: 'x'.repeat(1024 * 1024 + 1) } } }),
  );
  edits.end(end('script', 'script/2'));
  for (let i = 3; i <= 258; i++) {
    edits.end(end('script', `script/${i}`));
  }
  const changes = edits.result(result('script'));
  assert.equal(changes.details.lpiEditPatchesOmitted, true);
  assert.equal(changes.details.lpiEditPatches.length, 256);
  assert.equal(changes.details.lpiEditPatches[0].toolCallId, 'script/2');
  assert.equal(changes.details.lpiEditPatches[0].patch, patch);
});
