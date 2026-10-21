import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationBranchCount, sessionGraph } from '../src/tree-graph.ts';

const node = (id, parentId, kind, preview = id) => ({ id, parentId, kind, preview });
const tree = {
  sessionId: 'session',
  generation: 1,
  connected: true,
  activeLeafId: 'a-tip',
  nodes: [
    node('root', null, 'user', 'Start'),
    node('answer', 'root', 'assistant', 'Choose'),
    node('a', 'answer', 'user', 'SQLite'),
    node('a-tip', 'a', 'assistant', 'Migrations'),
    node('b', 'answer', 'user', 'JSON'),
    node('b-tip', 'b', 'assistant', 'Files'),
    node('metadata', 'b-tip', 'label', ''),
  ],
};
const options = (overrides = {}) => ({
  showAll: false,
  search: '',
  paths: new Map(),
  ...overrides,
});
const messages = (outline) =>
  outline.rows.filter((row) => row.type === 'message').map((row) => row.entryId);

function validOutline(outline) {
  assert.equal(new Set(outline.rows.map((row) => row.id)).size, outline.rows.length);
  const pending = [...outline.groups];
  const ids = new Set();
  while (pending.length) {
    const group = pending.pop();
    if (group.header) {
      assert.equal(group.header.segmentId, group.id);
      ids.add(group.header.id);
      if (!group.header.expanded) {
        assert.equal(group.messages.length, 0);
        assert.equal(group.children.length, 0);
      }
    }
    for (const row of group.messages) {
      ids.add(row.id);
      assert.equal(row.segmentId, group.id);
    }
    for (const child of group.children) {
      assert.ok(child.header);
      assert.equal(child.header.depth, (group.header?.depth ?? 0) + 1);
      pending.push(child);
    }
  }
  assert.deepEqual(ids, new Set(outline.rows.map((row) => row.id)));
}

test('both children of a split are equal expanded groups directly below their shared history', () => {
  const outline = sessionGraph(tree, options());
  validOutline(outline);
  assert.deepEqual(messages(outline), ['root', 'answer', 'a', 'a-tip', 'b', 'b-tip']);
  assert.equal(outline.groups.length, 1);
  const root = outline.groups[0];
  assert.equal(root.header, null);
  assert.deepEqual(
    root.messages.map((row) => row.id),
    ['root', 'answer'],
  );
  assert.deepEqual(
    root.children.map((group) => group.id),
    ['a', 'b'],
  );
  for (const branch of root.children) {
    assert.equal(branch.header.depth, 1);
    assert.equal(branch.header.expanded, true);
    assert.equal(branch.header.count, 2);
    assert.ok(branch.messages.every((row) => row.depth === 1));
  }
  assert.equal(root.children[0].header.active, true);
  assert.equal(root.children[1].header.active, false);
});

test('active and preview positions do not reorder siblings or change hierarchy', () => {
  const outline = sessionGraph(
    { ...tree, activeLeafId: 'b-tip' },
    options({ selectedId: 'a-tip' }),
  );
  validOutline(outline);
  assert.deepEqual(
    outline.groups[0].children.map((group) => group.id),
    ['a', 'b'],
  );
  assert.equal(outline.groups[0].children[1].header.active, true);
  assert.equal(outline.groups[0].children[0].header.selected, true);
});

test('either branch can collapse without hiding its sibling or the shared history', () => {
  for (const id of ['a', 'b']) {
    const outline = sessionGraph(tree, options({ paths: new Map([[id, false]]) }));
    validOutline(outline);
    assert.ok(messages(outline).includes('root'));
    assert.ok(messages(outline).includes(id === 'a' ? 'b-tip' : 'a-tip'));
    assert.ok(!messages(outline).includes(id));
    const header = outline.rows.find((row) => row.id === `path:${id}`);
    assert.equal(header.expanded, false);
    assert.equal(header.count, 2);
    assert.equal(header.active, id === 'a');
    const reopened = sessionGraph(tree, options({ paths: new Map([[id, true]]) }));
    assert.equal(messages(reopened).length, 6);
  }
});

test('linear sessions retain every message, with no root heading or collapse control', () => {
  const linear = { ...tree, nodes: tree.nodes.slice(0, 4) };
  const outline = sessionGraph(linear, options({ paths: new Map([['root', false]]) }));
  validOutline(outline);
  assert.equal(outline.rows.length, 4);
  assert.ok(outline.rows.every((row) => row.type === 'message' && row.depth === 0));
});

test('search reveals collapsed matches and keeps ancestors without changing collapse choices', () => {
  const paths = new Map([['b', false]]);
  const outline = sessionGraph(tree, options({ search: ' JSON ', paths }));
  validOutline(outline);
  assert.deepEqual(messages(outline), ['root', 'answer', 'b']);
  assert.equal(outline.rows.find((row) => row.id === 'root').context, true);
  assert.equal(outline.messageCount, 1);
  assert.equal(paths.get('b'), false);
  assert.ok(!messages(sessionGraph(tree, options({ paths }))).includes('b'));
  assert.equal(sessionGraph(tree, options({ search: 'missing' })).groups.length, 0);
});

test('branch count uses projected conversation leaves rather than metadata-only side paths', () => {
  const metadataForks = {
    ...tree,
    nodes: [
      node('prompt', null, 'user'),
      node('reply', 'prompt', 'assistant'),
      node('call', 'reply', 'assistant', ''),
      node('tool', 'call', 'toolResult', ''),
      node('old-extension-state', 'tool', 'custom', ''),
      node('continuation', 'tool', 'assistant'),
      node('state1', 'continuation', 'custom', ''),
      node('state2', 'continuation', 'custom', ''),
      node('last-prompt', 'state1', 'user'),
      node('last-reply', 'last-prompt', 'assistant'),
    ],
  };
  assert.equal(conversationBranchCount(metadataForks), 1);
  const projected = sessionGraph(metadataForks, options());
  assert.equal(projected.groups[0].children.length, 0);
  assert.ok(projected.rows.every((row) => row.type === 'message'));
  const all = sessionGraph(metadataForks, options({ showAll: true }));
  assert.ok(all.rows.some((row) => row.type === 'path'));
  assert.equal(messages(all).length, metadataForks.nodes.length);
  assert.equal(conversationBranchCount(tree), 2);
  assert.equal(conversationBranchCount({ ...tree, activeLeafId: 'answer' }), 2);
  assert.equal(conversationBranchCount({ ...tree, nodes: [] }), 0);
  assert.equal(conversationBranchCount({ ...tree, nodes: [node('metadata', null, 'custom')] }), 0);
});

test('active hidden entries map to visible ancestors without changing sibling order', () => {
  const tools = {
    ...tree,
    activeLeafId: 'result',
    nodes: [
      ...tree.nodes,
      node('call', 'b-tip', 'assistant', ''),
      node('result', 'call', 'toolResult', ''),
    ],
  };
  const outline = sessionGraph(tools, options());
  const active = outline.rows.find((row) => row.type === 'message' && row.active);
  assert.equal(active.entryId, 'b-tip');
  assert.equal(active.exactActive, false);
  assert.deepEqual(
    outline.groups[0].children.map((group) => group.id),
    ['a', 'b'],
  );
  const all = sessionGraph(tools, options({ showAll: true }));
  assert.equal(all.rows.find((row) => row.type === 'message' && row.active).entryId, 'result');
  assert.ok(
    sessionGraph({ ...tools, connected: false }, options()).rows.every((row) => !row.active),
  );
});

test('nested splits increase depth equally for every sibling and multiple roots remain separate', () => {
  const nested = {
    ...tree,
    nodes: [
      ...tree.nodes,
      node('a-alt', 'a', 'user'),
      node('a-alt-tip', 'a-alt', 'assistant'),
      node('new-root', null, 'user'),
    ],
  };
  const outline = sessionGraph(nested, options());
  validOutline(outline);
  assert.equal(outline.groups.length, 2);
  assert.deepEqual(
    outline.groups.map((group) => group.header.depth),
    [1, 1],
  );
  const a = outline.groups[0].children[0];
  assert.deepEqual(
    a.children.map((group) => group.id),
    ['a-tip', 'a-alt'],
  );
  assert.deepEqual(
    a.children.map((group) => group.header.depth),
    [3, 3],
  );
  assert.equal(conversationBranchCount(nested), 4);
});

test('large linear histories remain flat and preserve all messages without recursive projection', () => {
  const large = {
    ...tree,
    activeLeafId: 'n19999',
    nodes: Array.from({ length: 20_000 }, (_, index) =>
      node(`n${index}`, index ? `n${index - 1}` : null, 'user'),
    ),
  };
  const outline = sessionGraph(large, options());
  validOutline(outline);
  assert.equal(outline.rows.length, 20_000);
  assert.equal(outline.groups.length, 1);
  assert.equal(outline.groups[0].children.length, 0);
  assert.equal(conversationBranchCount(large), 1);
});
