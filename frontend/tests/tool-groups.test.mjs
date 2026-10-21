import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView } from '../../src/shared/client-state.ts';
import { transcriptEntries, transcriptState } from '../src/transcript-state.ts';

const call = (id, name = 'read') => ({ type: 'toolCall', id, name, arguments: { path: id } });
const assistant = (...content) => ({ role: 'assistant', timestamp: 1, content });
const result = (id, isError = false) => ({
  role: 'toolResult',
  timestamp: 2,
  toolCallId: id,
  content: 'Output',
  isError,
});
const entriesFor = (messages, overrides = {}) => {
  const state = transcriptState({ ...emptyView(), messages, ...overrides });
  return state.groups.flatMap((group) =>
    transcriptEntries(group.messages, group.messageKeys, state.tools),
  );
};

test('adjacent mixed calls group across messages and paired results retain output and failures', () => {
  const messages = [
    assistant(call('a')),
    result('a'),
    assistant(call('b', 'edit'), call('c', 'bash')),
    result('b', true),
    result('c'),
  ];
  const entries = entriesFor(messages);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'tools');
  assert.deepEqual(
    entries[0].tools.map(({ key }) => key),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    entries[0].tools.map(({ tool }) => tool.name),
    ['read', 'edit', 'bash'],
  );
  assert.deepEqual(
    entries[0].tools.map(({ tool }) => tool.status),
    ['Completed', 'Failed', 'Completed'],
  );
  assert.equal(entries[0].tools[1].tool.result, messages[3]);
  assert.equal(messages[0].content.length, 1, 'projection does not modify source messages');
});

test('text, thinking, codemode, unknown calls and user messages break groups', () => {
  for (const boundary of [
    { type: 'text', text: 'Checking.' },
    { type: 'thinking', thinking: 'Reasoning' },
    call('script', 'codemode'),
    { type: 'toolCall', name: 'unknown' },
  ]) {
    const entries = entriesFor([assistant(call('a'), boundary, call('b'))]);
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ['tools', 'message', 'tools'],
    );
    assert.equal(entries[0].tools.length, 1);
    assert.equal(entries[2].tools.length, 1);
  }
  const entries = entriesFor([
    assistant(call('a')),
    { role: 'user', timestamp: 2, content: 'Continue' },
    assistant(call('b')),
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['tools', 'message', 'tools'],
  );
});

test('invisible text and thinking do not split calls within or across assistant messages', () => {
  const invisible = [
    { type: 'thinking' },
    { type: 'thinking', thinking: '' },
    { type: 'thinking', thinking: ' \n\t ' },
    { type: 'thinking', thinking: null, thinkingSignature: 'encrypted' },
    { type: 'text' },
    { type: 'text', text: '' },
    { type: 'text', text: ' \n\t ' },
  ];
  for (const block of invisible) {
    for (const messages of [
      [assistant(call('a'), block, call('b'))],
      [assistant(call('a')), assistant(block, call('b'))],
      [assistant(call('a')), assistant(block), assistant(call('b'))],
    ]) {
      const entries = entriesFor(messages);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].kind, 'tools');
      assert.deepEqual(
        entries[0].tools.map(({ key }) => key),
        ['a', 'b'],
      );
    }
  }
  for (const content of [[], '', ' \n\t ', undefined]) {
    const entries = entriesFor([
      assistant(call('a')),
      { role: 'assistant', timestamp: 1, content },
      assistant(call('b')),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tools.length, 2);
  }
});

test('invisible blocks do not hide visible message metadata', () => {
  for (const metadata of [
    { summary: 'Summary' },
    { output: 'Output' },
    { errorMessage: 'Error' },
    { isError: true },
  ]) {
    const entries = entriesFor([
      assistant(call('a')),
      { ...assistant({ type: 'thinking', thinking: '' }), ...metadata },
      assistant(call('b')),
    ]);
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      ['tools', 'message', 'tools'],
    );
    for (const [field, value] of Object.entries(metadata)) {
      assert.equal(entries[1].item[field], value);
    }
  }
});

test('live partial calls append to existing groups with stable group keys', () => {
  const messages = [assistant(call('a')), result('a')];
  const before = entriesFor(messages);
  const live = entriesFor(messages, {
    running: true,
    partial: assistant(call('b', 'bash')),
    tools: [{ id: 'b', name: 'bash', args: { command: 'pwd' } }],
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].key, before[0].key);
  assert.deepEqual(
    live[0].tools.map(({ tool }) => tool.status),
    ['Completed', 'Running'],
  );
});

test('split message text keeps action ownership and renders trailing metadata only once', () => {
  const source = {
    ...assistant({ type: 'text', text: 'Before' }, call('a'), { type: 'text', text: 'After' }),
    summary: 'Summary',
    output: 'Output',
    errorMessage: 'Error',
  };
  const entries = entriesFor([source]);
  const text = entries.filter((entry) => entry.kind === 'message');
  assert.equal(text.filter((entry) => entry.actions).length, 1);
  assert.equal(text.find((entry) => entry.actions).item.content[0].text, 'After');
  assert.equal(text.find((entry) => entry.actions).source, source);
  for (const field of ['summary', 'output', 'errorMessage']) {
    assert.equal(text.filter((entry) => entry.item[field] !== undefined).length, 1);
  }
});
