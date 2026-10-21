import assert from 'node:assert/strict';
import test from 'node:test';
import { messageActionText } from '../src/transcript-state.ts';

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

test('tool results and other non-conversation messages have no message actions', () => {
  for (const role of ['toolResult', 'system', 'custom', 'bashExecution']) {
    assert.equal(messageActionText(message(role, 'Output')), null);
  }
});
