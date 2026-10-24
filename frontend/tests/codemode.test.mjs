import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, reduceEvent } from '../../src/shared/client-state.ts';
import { codemodeCallInput, codemodeState } from '../../src/shared/codemode.ts';
import { editDiff } from '../src/session/transcript/tools/edit-diff.ts';
import { transcriptState } from '../src/session/transcript/transcript-state.ts';

const call = (overrides = {}) => ({
  id: 'script/1',
  name: 'read',
  args: '{"path":"src/main.ts"}',
  status: 'ok',
  durationMs: 8,
  ...overrides,
});
const result = (calls) => ({
  role: 'toolResult',
  timestamp: 2,
  toolName: 'codemode',
  toolCallId: 'script',
  isError: false,
  details: { calls },
  content: [
    { type: 'text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' },
    { type: 'text', text: 'Combined output' },
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
  ],
});

test('saved codemode calls retain order and separate nested errors from script status', () => {
  const output = result([
    call(),
    call({ name: 'edit', status: 'error', error: 'No unique match' }),
    call({ name: 'bash', status: 'cancelled' }),
  ]);
  output.details.fullOutputPath = '/tmp/pi-output.txt';
  const tool = {
    name: 'codemode',
    args: { code: 'text(await tools.read({path: "src/main.ts"}));' },
    result: output,
    status: 'Completed',
  };
  const state = codemodeState(tool);
  assert.equal(state.errors, 1);
  assert.equal(state.cancelled, 1);
  assert.deepEqual(
    state.calls.map((c) => c.name),
    ['read', 'edit', 'bash'],
  );
  assert.equal(state.calls[1].error, 'No unique match');
  assert.equal(state.script, tool.args.code);
  assert.equal(state.wallTime, '0.1s');
  assert.equal(state.fullOutputPath, '/tmp/pi-output.txt');
  assert.deepEqual(state.output.content, output.content.slice(1));
  assert.equal(output.content.length, 3, 'original result is not mutated');
  assert.equal(tool.status, 'Completed');
});

test('live partial metadata and final saved result use the same projection', () => {
  let view = {
    ...emptyView(),
    running: true,
    messages: [
      {
        role: 'assistant',
        timestamp: 1,
        content: [
          { type: 'toolCall', id: 'script', name: 'codemode', arguments: { code: 'return 1;' } },
        ],
      },
    ],
  };
  const event = { toolCallId: 'script', toolName: 'codemode', args: { code: 'return 1;' } };
  view = reduceEvent(view, { type: 'tool_execution_start', ...event });
  view = reduceEvent(view, {
    type: 'tool_execution_update',
    ...event,
    partialResult: {
      content: [],
      details: { calls: [call({ id: 'script/?', status: 'running' })] },
    },
  });
  let tool = transcriptState(view).tools.get('script');
  assert.equal(tool.status, 'Running');
  assert.equal(codemodeState(tool).calls[0].status, 'running');
  assert.equal(codemodeState(tool).script, 'return 1;');
  view = reduceEvent(view, { type: 'tool_execution_end', ...event });
  view = reduceEvent(view, { type: 'message_end', message: result([call()]) });
  tool = transcriptState(view).tools.get('script');
  assert.equal(tool.status, 'Completed');
  assert.equal(codemodeState(tool).calls[0].status, 'ok');
});

test('argument previews expose paths and command beginnings even with truncated JSON', () => {
  for (const name of ['read', 'edit', 'write']) {
    assert.equal(
      codemodeCallInput(call({ name, args: '{"path":"src/main.ts","edits":[...' })),
      'src/main.ts',
    );
  }
  assert.equal(
    codemodeCallInput(
      call({ name: 'bash', args: '{"command":"npm run check && rg \\"tool\\" src/...' }),
    ),
    'npm run check && rg "tool" src/...',
  );
  assert.equal(codemodeCallInput(call({ args: '{"path":"a\\\\b\\nfile.ts"}' })), 'a\\b\nfile.ts');
  assert.equal(
    codemodeCallInput(call({ name: 'bash', args: '{"command":"trailing\\' })),
    'trailing',
  );
  assert.equal(
    codemodeCallInput(call({ name: 'models.classify', args: 'provider/model' })),
    'provider/model',
  );
  assert.equal(codemodeCallInput(call({ args: 'not JSON' })), 'not JSON');
});

test('malformed metadata is ignored without dropping combined output', () => {
  const output = result([
    null,
    {},
    call({ name: 12 }),
    call({ args: {} }),
    call({ status: 'unknown' }),
    call({ durationMs: Number.NaN, cost: -1, error: {} }),
  ]);
  const state = codemodeState({
    name: 'codemode',
    args: null,
    result: output,
    status: 'Completed',
  });
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].durationMs, undefined);
  assert.equal(state.calls[0].cost, undefined);
  assert.equal(state.calls[0].error, undefined);
  assert.equal(state.script, undefined);
  assert.equal(state.output.content[0].text, 'Combined output');
  for (const details of [undefined, null, 'invalid', { calls: {} }]) {
    const fallback = codemodeState({ result: { ...output, details }, status: 'Completed' });
    assert.deepEqual(fallback.calls, []);
    assert.equal(fallback.output.content[0].text, 'Combined output');
  }
});

test('saved patches match stable nested IDs, not preview text or completion order', () => {
  const patch = '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new\n';
  const output = result([
    call({ id: 'script/2', name: 'edit', args: '{"path":"wrong.ts","edits":...' }),
    call({ id: 'script/1', name: 'edit' }),
    call({ id: 'script/3', name: 'edit', status: 'error' }),
    call({ id: 'script/4', name: 'read' }),
  ]);
  output.isError = true;
  output.details.lpiEditPatches = [
    { toolCallId: 'script/1', patch },
    { toolCallId: 'script/3', patch },
    { toolCallId: 'script/4', patch },
    { toolCallId: 'unrelated/1', patch },
  ];
  output.details.lpiEditPatchesOmitted = true;
  const state = codemodeState({ result: JSON.parse(JSON.stringify(output)), status: 'Failed' });
  assert.equal(state.calls[0].editTool, undefined);
  assert.equal(editDiff(state.calls[1].editTool).name, 'a.ts');
  assert.equal(state.calls[2].editTool, undefined);
  assert.equal(state.calls[3].editTool, undefined);
  assert.equal(state.patchesOmitted, true);
  for (const patches of [undefined, null, {}, [null], [{ toolCallId: 'script/1', patch: 12 }]]) {
    output.details.lpiEditPatches = patches;
    assert.equal(codemodeState({ result: output }).calls[1].editTool, undefined);
  }
  output.details.lpiEditPatches = [{ toolCallId: 'script/1', patch: 'invalid' }];
  assert.equal(editDiff(codemodeState({ result: output }).calls[1].editTool), undefined);
  output.details.lpiEditPatches = [
    { toolCallId: 'script/1', patch },
    { toolCallId: 'script/1', patch },
  ];
  assert.equal(codemodeState({ result: output }).calls[1].editTool, undefined);
});

test('zero-call scripts, missing results and nonstandard failures keep their content', () => {
  const empty = codemodeState({ result: result([]), status: 'Completed' });
  assert.deepEqual(empty.calls, []);
  const pending = codemodeState({ args: { code: '' }, status: 'Pending' });
  assert.equal(pending.script, '');
  assert.equal(pending.output, undefined);
  const output = { role: 'toolResult', timestamp: 1, content: 'Invalid options', isError: true };
  assert.equal(codemodeState({ result: output, status: 'Failed' }).output, output);
});
