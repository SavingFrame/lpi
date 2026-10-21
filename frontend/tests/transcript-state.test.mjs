import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView, reduceEvent } from '../../src/shared/client-state.ts';
import { transcriptState } from '../src/transcript-state.ts';
import { partial } from './live-fixture.mjs';

test('native partials replace content authoritatively and settlement clears transient state', () => {
  let view = reduceEvent(emptyView(), { type: 'agent_start' });
  view = reduceEvent(view, { type: 'message_start', message: partial });
  const streamed = {
    ...partial,
    content: [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'reason' },
      { type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } },
    ],
  };
  view = reduceEvent(view, { type: 'message_update', message: streamed });
  assert.deepEqual(view.partial.content, streamed.content);
  const final = { ...partial, content: [{ type: 'text', text: 'final' }], stopReason: 'stop' };
  view = reduceEvent(view, { type: 'message_end', message: final });
  assert.equal(view.messages.length, 1);
  assert.equal(view.partial, null);
  view = reduceEvent(view, { type: 'agent_end' });
  assert.equal(view.running, true);
  assert.equal(reduceEvent(view, { type: 'agent_settled' }).running, false);
});

test('transcript pairs parallel tool results by ID without changing native messages', () => {
  const calls = {
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'thinking', thinking: 'Inspect files' },
      { type: 'toolCall', id: 'first', name: 'read', arguments: { path: 'a' } },
      { type: 'text', text: 'Also checking another file.' },
      { type: 'toolCall', id: 'second', name: 'read', arguments: { path: 'b' } },
    ],
  };
  const second = {
    role: 'toolResult',
    timestamp: 2,
    toolCallId: 'second',
    content: [{ type: 'text', text: 'failed' }],
    isError: true,
  };
  const first = {
    role: 'toolResult',
    timestamp: 3,
    toolCallId: 'first',
    content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
  };
  const orphan = { role: 'toolResult', timestamp: 4, toolCallId: 'missing', content: 'kept' };
  const hidden = { role: 'toolResult', timestamp: 5, toolCallId: 'first', display: false };
  const view = { ...emptyView(), messages: [calls, second, first, orphan, hidden] };
  const projected = transcriptState(view);
  assert.deepEqual(projected.messages, [calls, orphan]);
  assert.equal(projected.tools.get('first').result, first);
  assert.equal(projected.tools.get('first').status, 'Completed');
  assert.equal(projected.tools.get('second').result, second);
  assert.equal(projected.tools.get('second').status, 'Failed');
  assert.equal(view.messages.length, 5);
});

test('transcript keeps one tool block through streaming, progress and completion', () => {
  const call = {
    ...partial,
    content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } }],
  };
  let view = { ...emptyView(), running: true, partial: call };
  assert.equal(transcriptState(view).tools.get('call').status, 'Pending');
  view = reduceEvent(view, { type: 'message_end', message: call });
  view = reduceEvent(view, {
    type: 'tool_execution_start',
    toolCallId: 'call',
    toolName: 'bash',
    args: { command: 'true' },
  });
  const progress = { content: [{ type: 'text', text: 'working' }] };
  view = reduceEvent(view, {
    type: 'tool_execution_update',
    toolCallId: 'call',
    toolName: 'bash',
    args: { command: 'true' },
    partialResult: progress,
  });
  assert.equal(transcriptState(view).tools.get('call').status, 'Running');
  assert.equal(transcriptState(view).tools.get('call').progress, progress);
  assert.deepEqual(transcriptState(view).unpaired, []);
  view = reduceEvent(view, { type: 'tool_execution_end', toolCallId: 'call' });
  const result = { role: 'toolResult', timestamp: 3, toolCallId: 'call', content: 'done' };
  view = reduceEvent(view, { type: 'message_end', message: result });
  const projected = transcriptState(view);
  assert.deepEqual(projected.messages, [call]);
  assert.deepEqual(projected.tools.get('call').result, result);
  assert.equal(projected.tools.get('call').status, 'Completed');
});

test('transcript preserves unmatched activity and marks missing saved results honestly', () => {
  const view = {
    ...emptyView(),
    messages: [{ ...partial, content: [{ type: 'toolCall', id: 'old', name: 'bash' }] }],
    tools: [{ id: 'unknown', name: 'read', args: { path: 'a' } }],
  };
  const projected = transcriptState(view);
  assert.equal(projected.tools.get('old').status, 'No result');
  assert.deepEqual(projected.unpaired, view.tools);
  assert.equal(projected.tools.get('unknown').status, 'Running');
});

test('transcript groups consecutive authors across tools but not across user turns', () => {
  const user = { role: 'user', timestamp: 1, content: 'Check this' };
  const call = {
    role: 'assistant',
    timestamp: 2,
    content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'true' } }],
  };
  const result = { role: 'toolResult', timestamp: 3, toolCallId: 'call', content: 'done' };
  const answer = { role: 'assistant', timestamp: 4, content: 'Checked.' };
  const nextUser = { ...user, timestamp: 5, content: 'Continue' };
  const nextAnswer = { ...answer, timestamp: 6, content: 'Continuing.' };
  const view = { ...emptyView(), messages: [user, call, result, answer, nextUser, nextAnswer] };
  const { groups } = transcriptState(view);
  assert.deepEqual(
    groups.map((group) => group.author),
    ['You', 'Pi', 'You', 'Pi'],
  );
  assert.deepEqual(
    groups.map((group) => group.messages),
    [[user], [call, answer], [nextUser], [nextAnswer]],
  );
  assert.equal(view.messages.length, 6);
  assert.deepEqual(
    transcriptState({ ...emptyView(), messages: [user, nextUser] }).groups[0].messages,
    [user, nextUser],
  );
});

test('streaming content joins its author group and stays grouped after completion', () => {
  const first = { role: 'assistant', timestamp: 1, content: 'Checking.' };
  const streamed = { ...partial, content: [{ type: 'text', text: 'Done.' }] };
  const view = { ...emptyView(), messages: [first], partial: streamed };
  const { groups } = transcriptState(view);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].streaming, true);
  assert.deepEqual(groups[0].messages, [first, streamed]);
  const completed = transcriptState(reduceEvent(view, { type: 'message_end', message: streamed }));
  assert.equal(completed.groups.length, 1);
  assert.equal(completed.groups[0].streaming, false);
  assert.deepEqual(completed.groups[0].messages, groups[0].messages);
  const onlyPartial = transcriptState({ ...emptyView(), partial: streamed });
  assert.equal(onlyPartial.groups[0].author, 'Pi');
  assert.equal(onlyPartial.groups[0].streaming, true);
});

test('unmatched tool output retains separate authors and breaks assistant groups', () => {
  const first = { role: 'assistant', timestamp: 1, content: 'Checking.' };
  const read = { role: 'toolResult', toolName: 'read', timestamp: 2, content: 'file' };
  const bash = { role: 'toolResult', toolName: 'bash', timestamp: 3, content: 'output' };
  const answer = { ...first, timestamp: 4, content: 'Done.' };
  const { groups } = transcriptState({ ...emptyView(), messages: [first, read, bash, answer] });
  assert.deepEqual(
    groups.map((group) => group.author),
    ['Pi', 'read', 'bash', 'Pi'],
  );
});

test('distinct messages with the same timestamp are preserved', () => {
  const first = { role: 'user', timestamp: 1, content: 'first' };
  let view = reduceEvent(emptyView(), { type: 'message_end', message: first });
  view = reduceEvent(view, { type: 'message_end', message: { ...first, content: 'second' } });
  assert.deepEqual(
    view.messages.map((item) => item.content),
    ['first', 'second'],
  );
});
