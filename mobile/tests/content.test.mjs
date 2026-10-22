import assert from 'node:assert/strict';
import test from 'node:test';
import { linkUrl, markdownTokens, messageBlocks } from '../src/features/conversation/content.ts';

test('conversation Markdown preserves headings, nested formatting, lists, tables, and code', () => {
  const tokens = markdownTokens(
    '# Title\n\nA **bold** [link](https://example.com).\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |',
  );
  assert.equal(tokens[0].type, 'heading');
  const paragraph = tokens.find((token) => token.type === 'paragraph');
  assert.ok(paragraph.tokens.some((token) => token.type === 'strong'));
  assert.ok(paragraph.tokens.some((token) => token.type === 'link'));
  assert.equal(tokens.find((token) => token.type === 'list').items.length, 2);
  assert.equal(tokens.find((token) => token.type === 'code').text, 'const x = 1;');
  assert.equal(tokens.find((token) => token.type === 'table').rows.length, 1);
  assert.doesNotThrow(() => markdownTokens('Partial **bold\n\n```ts\nunfinished'));
});

test('only explicit web and mail links are actionable, with no embedded HTML execution', () => {
  assert.equal(linkUrl('https://example.com'), 'https://example.com/');
  assert.equal(linkUrl('mailto:test@example.com'), 'mailto:test@example.com');
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    'exp://host',
    '/relative',
  ]) {
    assert.equal(linkUrl(url), null);
  }
  assert.equal(markdownTokens('<script>alert(1)</script>')[0].type, 'html');
});

test('user attachment resize hints are hidden without changing messages or quoted text', () => {
  const note =
    '[Image: original 1206x2622, displayed at 920x2000. Multiply coordinates by 1.31 to map to original image.]';
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
  const message = {
    role: 'user',
    timestamp: 1,
    content: [{ type: 'text', text: `Look here\n\n${note}\n${note}` }, image, image],
  };
  const original = structuredClone(message);
  const blocks = messageBlocks(message);
  assert.equal(blocks[0].text, 'Look here');
  assert.equal(blocks.filter((block) => block.kind === 'image').length, 2);
  assert.deepEqual(message, original);
  assert.deepEqual(
    messageBlocks({ ...message, content: [{ type: 'text', text: note }, image] }).map(
      (block) => block.kind,
    ),
    ['image'],
  );
  assert.equal(
    messageBlocks({ ...message, content: [{ type: 'text', text: note }] })[0].text,
    note,
  );
  const quoted = `Here is the metadata:\n\`\`\`\n${note}\n\`\`\``;
  assert.equal(
    messageBlocks({ ...message, content: [{ type: 'text', text: quoted }, image] })[0].text,
    quoted,
  );
  assert.equal(messageBlocks({ ...message, role: 'assistant' })[0].text, message.content[0].text);
});

test('conversation content keeps thinking and tool arguments inspectable without hiding text', () => {
  const blocks = messageBlocks({
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'thinking', thinking: 'Consider the options.' },
      { type: 'text', text: 'Answer' },
      { type: 'toolCall', name: 'read', arguments: { path: 'test.ts' } },
      { type: 'image', data: 'not-rendered-or-requested' },
    ],
  });
  assert.equal(blocks[0].text, 'Consider the options.');
  assert.deepEqual(blocks[1], { kind: 'text', label: '', text: 'Answer' });
  assert.equal(blocks[2].label, 'read');
  assert.deepEqual(JSON.parse(blocks[2].text), { path: 'test.ts' });
  assert.equal(blocks[3].label, 'Image attachment');
  assert.deepEqual(messageBlocks({ role: 'user', timestamp: 1, content: 'Hello' }), [
    { kind: 'text', label: '', text: 'Hello' },
  ]);
});
