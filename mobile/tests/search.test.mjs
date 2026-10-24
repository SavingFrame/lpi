import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTextMatch, textMatches } from '../../src/client/text-search.ts';
import { markdownTokens } from '../src/features/conversation/content.ts';
import { markdownProjection, searchConversation } from '../src/features/conversation/search.ts';
import { conversationRows } from '../src/features/conversation/timeline.ts';

test('literal search preserves original offsets, counts occurrences and wraps navigation', () => {
  assert.deepEqual(textMatches('İ NEEDLE [x]. needle', 'needle'), [
    { start: 2, end: 8 },
    { start: 14, end: 20 },
  ]);
  assert.deepEqual(textMatches('[x]. regex?', '[x].'), [{ start: 0, end: 4 }]);
  assert.deepEqual(textMatches('anything', ''), []);
  assert.equal(nextTextMatch(0, -1, 3), 2);
  assert.equal(nextTextMatch(2, 1, 3), 0);
  assert.equal(nextTextMatch(0, 1, 0), 0);
});

test('native search includes only message text in chronological order, including partial replies', () => {
  const messages = [
    { role: 'user', content: 'NEEDLE needle', timestamp: 1 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'needle reasoning' },
        { type: 'text', text: 'A **needle** reply' },
        { type: 'toolCall', id: 'tool', name: 'bash', arguments: { command: 'needle' } },
        { type: 'text', text: 'Partial needle' },
      ],
      timestamp: 2,
    },
    { role: 'toolResult', toolCallId: 'tool', content: 'needle output', timestamp: 3 },
    { role: 'system', content: 'needle instructions', timestamp: 4 },
  ];
  const rows = conversationRows(messages, []).reverse();
  const matches = searchConversation(rows, 'needle');
  assert.equal(matches.length, 4);
  assert.deepEqual(
    matches.map((match) => match.rowKey),
    ['0', '0', '1:message:0', '1:message:1'],
  );
  assert.equal(searchConversation(rows, 'a needle reply').length, 1);
  assert.deepEqual(searchConversation(rows, ''), []);
  assert.equal(searchConversation(rows, 'bash').length, 0);
  assert.equal(searchConversation(rows, 'reasoning').length, 0);
  assert.equal(searchConversation(rows, 'output').length, 0);
});

test('Markdown search maps formatted text to native leaf offsets without searching link targets', () => {
  const tokens = markdownTokens(
    '# A **needle** reply\n\n> [needle](https://secret.example)\n\n- `needle`\n\n```needle-language\nneedle\n```\n\n| needle | value |\n| --- | --- |\n| data | needle |',
  );
  const { text, offsets } = markdownProjection(tokens);
  assert.equal(textMatches(text, 'needle').length, 6);
  assert.equal(textMatches(text, 'a needle reply').length, 1);
  assert.equal(text.includes('secret.example'), false);
  assert.equal(text.includes('needle-language'), false);
  const bold = tokens[0].tokens.find((token) => token.type === 'strong');
  assert.equal(text.slice(offsets.get(bold.tokens[0]), offsets.get(bold.tokens[0]) + 6), 'needle');
});
