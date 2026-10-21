import assert from 'node:assert/strict';
import test from 'node:test';
import { branchRows, draftForBranch, fullTreeRows, visibleTreeRows } from '../src/branch-state.ts';

const node = (id, parentId, kind, preview = '', label) => ({
  id,
  parentId,
  kind,
  preview,
  ...(label ? { label } : {}),
});
const tree = {
  sessionId: 'session',
  generation: 1,
  connected: true,
  activeLeafId: 'a-tip',
  nodes: [
    node('root', null, 'user', 'Initial request'),
    node('answer', 'root', 'assistant', 'Choose an approach'),
    node('a', 'answer', 'user', 'SQLite approach'),
    node('a-tip', 'a', 'assistant', 'Migrations', 'Checkpoint A'),
    node('b', 'answer', 'user', 'JSON approach'),
    node('b-tip', 'b', 'assistant', 'File locking'),
    node('metadata', 'b-tip', 'label'),
  ],
};

test('sidebar collapses linear paths into labelled branch tips with a single active marker', () => {
  assert.deepEqual(branchRows(tree), [
    { id: 'a-tip', title: 'Checkpoint A', depth: 1, active: true },
    { id: 'metadata', title: 'JSON approach', depth: 1, active: false },
  ]);
  const saved = branchRows({ ...tree, connected: false, activeLeafId: null });
  assert.ok(saved.every((branch) => !branch.active));
  assert.equal(branchRows({ ...tree, nodes: [] }).length, 0);
});

test('empty, metadata-only and linear sessions do not expose multiple conversation paths', () => {
  for (const nodes of [
    [],
    [node('metadata', null, 'model_change')],
    [node('prompt', null, 'user', 'Hello'), node('reply', 'prompt', 'assistant', 'Hi')],
  ]) {
    assert.ok(branchRows({ ...tree, activeLeafId: null, nodes }).length < 2);
  }
  assert.equal(branchRows(tree).length, 2);
});

test('rewound internal positions, multiple roots and nested alternatives remain navigable', () => {
  const rows = branchRows({
    ...tree,
    activeLeafId: 'answer',
    nodes: [
      ...tree.nodes,
      node('nested', 'b', 'user', 'Different locking'),
      node('new-root', null, 'user', 'Independent root'),
    ],
  });
  assert.ok(rows.some((row) => row.id === 'answer' && row.active));
  assert.ok(rows.some((row) => row.id === 'nested' && row.depth === 2));
  assert.ok(rows.some((row) => row.id === 'new-root' && row.title === 'Independent root'));
  assert.equal(rows.filter((row) => row.active).length, 1);
});

test('interleaved appends stay grouped under their actual ancestry rather than file order', () => {
  const rows = branchRows({
    ...tree,
    nodes: [...tree.nodes, node('nested-a', 'a', 'user', 'Different SQLite approach')],
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a-tip', 'nested-a', 'metadata'],
  );
});

test('full tree retains internal entries, metadata, labels and ancestry order', () => {
  const rows = fullTreeRows({
    ...tree,
    activeLeafId: 'answer',
    nodes: [...tree.nodes, node('nested-a', 'a', 'user', 'Alternative')],
  });
  assert.deepEqual(
    rows.map(({ id, depth }) => [id, depth]),
    [
      ['root', 0],
      ['answer', 0],
      ['a', 1],
      ['a-tip', 2],
      ['nested-a', 2],
      ['b', 1],
      ['b-tip', 1],
      ['metadata', 1],
    ],
  );
  assert.equal(rows.find((row) => row.id === 'a-tip').title, 'Checkpoint A');
  assert.equal(rows.find((row) => row.id === 'metadata').kind, 'label');
  assert.deepEqual(
    rows.filter((row) => row.active).map((row) => row.id),
    ['answer'],
  );
  assert.ok(fullTreeRows({ ...tree, connected: false }).every((row) => !row.active));
  assert.deepEqual(fullTreeRows({ ...tree, nodes: [] }), []);
});

test('linear conversation rows stay aligned and only branch splits indent', () => {
  const rows = fullTreeRows(tree);
  assert.deepEqual(
    rows.map((row) => row.depth),
    [0, 0, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    rows.filter((row) => row.split).map((row) => row.id),
    ['a', 'b'],
  );
  const linear = { ...tree, nodes: tree.nodes.slice(0, 4) };
  assert.ok(fullTreeRows(linear).every((row) => row.depth === 0 && !row.split));
});

test('conversation filter hides tools and metadata, projecting active position onto visible ancestry', () => {
  const withTools = {
    ...tree,
    activeLeafId: 'result',
    nodes: [
      ...tree.nodes,
      node('call', 'a-tip', 'assistant'),
      node('result', 'call', 'toolResult'),
    ],
  };
  const rows = visibleTreeRows(withTools, false, '');
  assert.deepEqual(
    rows.map((row) => row.id),
    ['root', 'answer', 'a', 'a-tip', 'b', 'b-tip'],
  );
  assert.equal(rows.find((row) => row.active).id, 'a-tip');
  assert.equal(rows.find((row) => row.active).exactActive, false);
  const all = visibleTreeRows(withTools, true, '');
  assert.equal(all.length, withTools.nodes.length);
  assert.equal(all.find((row) => row.active).id, 'result');
  assert.equal(all.find((row) => row.active).exactActive, true);
  assert.ok(
    visibleTreeRows({ ...withTools, connected: false }, false, '').every((row) => !row.active),
  );
});

test('tree search matches text, labels, kinds and IDs without changing branch indentation', () => {
  assert.deepEqual(
    visibleTreeRows(tree, false, ' CHECKPOINT ').map((row) => row.id),
    ['a-tip'],
  );
  assert.equal(visibleTreeRows(tree, false, 'SQLite')[0].depth, 1);
  assert.equal(visibleTreeRows(tree, false, 'user').length, 3);
  assert.equal(visibleTreeRows(tree, false, 'metadata').length, 0);
  assert.equal(visibleTreeRows(tree, true, 'metadata')[0].id, 'metadata');
  assert.deepEqual(visibleTreeRows(tree, true, 'does not exist'), []);
  assert.deepEqual(visibleTreeRows({ ...tree, nodes: [] }, false, ''), []);
});

test('user-message navigation restores text and images without losing multiline content', () => {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  };
  const preview = {
    sessionId: 'session',
    entryId: 'user',
    messages: [
      {
        role: 'user',
        entryId: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: 'Keep\nnewlines' }, image],
      },
    ],
  };
  assert.deepEqual(draftForBranch(preview), { text: 'Keep\nnewlines', images: [image] });
  assert.equal(draftForBranch({ ...preview, entryId: 'assistant' }), null);
  assert.deepEqual(
    draftForBranch({
      ...preview,
      messages: [{ ...preview.messages[0], role: 'custom', entryType: 'custom_message' }],
    }),
    { text: 'Keep\nnewlines', images: [image] },
  );
  assert.throws(() =>
    draftForBranch({
      ...preview,
      messages: [{ ...preview.messages[0], content: Array(5).fill(image) }],
    }),
  );
});
