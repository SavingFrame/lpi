import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView } from '../../src/shared/client-state.ts';
import {
  messageActionTargets,
  messageActionText,
} from '../src/session/transcript/transcript-state.ts';

const message = (role, content) => ({ role, content, timestamp: 1 });

test('message actions retain user messages including image-only prompts', () => {
  assert.equal(messageActionText(message('user', 'Hello')), 'Hello');
  assert.equal(messageActionText(message('user', [{ type: 'image', data: 'image' }])), '');
});

test('assistant actions require visible text and copy only text blocks', () => {
  const internal = [
    { type: 'thinking', thinking: 'Private reasoning' },
    { type: 'toolCall', id: 'tool', name: 'bash' },
  ];
  assert.equal(messageActionText(message('assistant', internal)), null);
  assert.equal(messageActionText(message('assistant', '  \n ')), null);
  assert.equal(messageActionText(message('assistant', undefined)), null);
  assert.equal(
    messageActionText(
      message('assistant', [
        ...internal,
        { type: 'text', text: '**First**\nline' },
        { type: 'text', text: 'Second' },
      ]),
    ),
    '**First**\nline\n\nSecond',
  );
});

test('only user prompts and final assistant replies receive actions', () => {
  const user = message('user', 'Start');
  const progress = message('assistant', 'Checking files.');
  const call = message('assistant', [
    { type: 'text', text: 'Applying changes.' },
    { type: 'toolCall', id: 'tool', name: 'edit' },
  ]);
  const result = message('toolResult', 'Done');
  const final = { ...message('assistant', 'Finished.'), stopReason: 'stop' };
  const nextUser = message('user', 'Continue');
  const messages = [user, progress, call, result, final];
  assert.deepEqual([...messageActionTargets({ ...emptyView(), messages })], [user, final]);
  assert.deepEqual([...messageActionTargets({ ...emptyView(), messages, running: true })], [user]);
  assert.deepEqual(
    [...messageActionTargets({ ...emptyView(), messages: [...messages, nextUser], running: true })],
    [user, final, nextUser],
  );
  for (const tail of [call, result]) {
    assert.deepEqual(
      [...messageActionTargets({ ...emptyView(), messages: [user, progress, call, result, tail] })],
      [user],
    );
  }
  for (const stopReason of ['aborted', 'error', 'toolUse']) {
    assert.deepEqual(
      [...messageActionTargets({ ...emptyView(), messages: [user, { ...final, stopReason }] })],
      [user],
    );
  }
  assert.deepEqual(
    [...messageActionTargets({ ...emptyView(), messages, partial: progress })],
    [user],
  );
});

test('tool results and other non-conversation messages have no message actions', () => {
  for (const role of ['toolResult', 'system', 'custom', 'bashExecution']) {
    assert.equal(messageActionText(message(role, 'Output')), null);
  }
});
