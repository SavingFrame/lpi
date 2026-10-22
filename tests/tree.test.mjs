import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createApi } from '../dist/src/api/http.js';
import { NativeBridges } from '../dist/src/bridge/server.js';
import { Events } from '../dist/src/events.js';
import { historyMessages, historyNodes } from '../dist/src/pi-history.js';
import { Sessions } from '../dist/src/sessions.js';
import { bridgeCommand } from '../dist/src/shared/commands.js';
import { branchPreview, sessionTree } from '../dist/src/shared/session-tree.js';
import { SessionDiscovery } from '../dist/src/storage/discovery.js';
import { SessionReadStore } from '../dist/src/storage/read-state.js';
import { fixture } from './helpers.mjs';

const timestamp = '2026-01-01T00:00:00Z';
const entry = (id, parentId, role, content) => ({
  type: 'message',
  id,
  parentId,
  timestamp,
  message: { role, content, timestamp: 1 },
});
const entries = [
  entry('root', null, 'user', 'Build authentication'),
  entry('answer', 'root', 'assistant', 'Choose a database'),
  entry('a', 'answer', 'user', 'SQLite approach'),
  entry('a-tip', 'a', 'assistant', 'Use migrations'),
  entry('b', 'answer', 'user', 'JSON approach'),
  entry('b-tip', 'b', 'assistant', 'Use file locking'),
  {
    type: 'label',
    id: 'label',
    parentId: 'b-tip',
    targetId: 'a-tip',
    label: 'Checkpoint A',
    timestamp,
  },
];

test('tree contracts validate bounded ancestry and navigation requires an expected native leaf', () => {
  const value = {
    sessionId: 'session',
    generation: 1,
    connected: true,
    activeLeafId: 'a-tip',
    nodes: historyNodes(entries),
  };
  assert.deepEqual(sessionTree(value), value);
  assert.deepEqual(
    branchPreview({
      sessionId: 'session',
      entryId: 'a-tip',
      messages: historyMessages(entries, 'a-tip'),
    }).messages.map((message) => message.entryId),
    ['root', 'answer', 'a', 'a-tip'],
  );
  for (const nodes of [
    [...value.nodes, value.nodes[0]],
    [{ ...value.nodes[0], parentId: 'root' }],
    [{ ...value.nodes[0], parentId: 'missing' }],
    Array(100_001).fill(value.nodes[0]),
  ]) {
    assert.throws(() => sessionTree({ ...value, nodes }));
  }
  assert.throws(() => sessionTree({ ...value, activeLeafId: 1 }));
  assert.throws(() => bridgeCommand({ type: 'navigate_tree', targetId: 'a-tip' }));
  assert.deepEqual(
    bridgeCommand({ type: 'navigate_tree', targetId: 'a-tip', expectedLeafId: null }),
    { type: 'navigate_tree', targetId: 'a-tip', expectedLeafId: null },
  );
});

test('transcript preserves raw history through context edits and repeated compaction on its branch', () => {
  const history = [
    entry('first', null, 'user', 'Original'),
    entry('reply', 'first', 'assistant', 'Old reply'),
    {
      type: 'context_edit',
      id: 'edit',
      parentId: 'reply',
      targetId: 'first',
      replacement: { content: 'Replacement' },
      timestamp,
    },
  ];
  assert.equal(historyMessages(history)[0].entryId, 'first');
  assert.equal(historyMessages(history)[0].content, 'Original');
  history.push({
    type: 'compaction',
    id: 'compact',
    parentId: 'edit',
    firstKeptEntryId: 'compact',
    summary: 'Summary',
    tokensBefore: 100,
    timestamp,
  });
  history.push(
    entry('next', 'compact', 'user', 'Continue'),
    {
      type: 'context_edit',
      id: 'omit',
      parentId: 'next',
      targetId: 'reply',
      replacement: null,
      timestamp,
    },
    {
      type: 'compaction',
      id: 'compact-again',
      parentId: 'omit',
      firstKeptEntryId: 'next',
      summary: 'Second summary',
      tokensBefore: 200,
      timestamp,
    },
    entry('latest', 'compact-again', 'assistant', 'Continued'),
    entry('sibling', 'reply', 'user', 'Other branch'),
  );
  const original = structuredClone(history);
  const messages = historyMessages(history, 'latest');
  assert.deepEqual(
    messages.map((message) => message.entryId),
    ['first', 'reply', 'compact', 'next', 'compact-again', 'latest'],
  );
  assert.equal(messages[0].content, 'Original');
  assert.equal(messages[1].content, 'Old reply');
  assert.deepEqual(
    messages
      .filter((message) => message.role === 'compactionSummary')
      .map((message) => message.summary),
    ['Summary', 'Second summary'],
  );
  assert.deepEqual(
    historyMessages(history).map((message) => message.entryId),
    ['first', 'reply', 'sibling'],
  );
  assert.deepEqual(
    historyMessages(history, 'reply').map((message) => message.entryId),
    ['first', 'reply'],
  );
  assert.deepEqual(historyMessages(history, null), []);
  assert.deepEqual(historyMessages([]), []);
  assert.deepEqual(history, original);
  assert.equal(
    historyNodes([entry('tool', null, 'toolResult', 'private tool output')])[0].preview,
    '',
  );
  assert.throws(() => historyMessages([entry('cycle', 'cycle', 'user', 'Invalid')]), /ancestry/);
});

test('tree and branch HTTP reads preserve files, distinguish saved paths, and expose separate-session origins', async (t) => {
  const { root, config, defer } = fixture(t);
  const parentFile = join(root, 'parent.jsonl');
  const file = join(root, 'fork.jsonl');
  const header = {
    type: 'session',
    version: 3,
    id: 'native-tree',
    cwd: config.projects[0].directory,
    timestamp,
    parentSession: parentFile,
  };
  writeFileSync(file, `${[header, ...entries].map((value) => JSON.stringify(value)).join('\n')}\n`);
  const original = readFileSync(file);
  const discovery = new SessionDiscovery([root], config.projects);
  const session = discovery.list()[0];
  assert.equal(session.parentSession, parentFile);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  const sessions = new Sessions(discovery, bridges, events, new SessionReadStore(':memory:'));
  const server = createApi(config, sessions, bridges);
  defer(() => {
    bridges.close();
    server.close();
    server.closeAllConnections();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}/sessions/${session.id}`;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const tree = sessionTree(await get('/tree'));
  assert.equal(tree.connected, false);
  assert.equal(tree.activeLeafId, null);
  assert.equal(tree.nodes.find((node) => node.id === 'a-tip').label, 'Checkpoint A');
  const preview = branchPreview(await get('/branch?entryId=a-tip'));
  assert.deepEqual(
    preview.messages.map((message) => message.entryId),
    ['root', 'answer', 'a', 'a-tip'],
  );
  assert.equal((await fetch(`${base}/branch?entryId=missing`)).status, 404);
  assert.equal((await fetch(`${base}/branch`)).status, 400);
  assert.equal((await get('')).parentSession, parentFile);
  t.mock.method(bridges, 'get', () => ({ ...session, connection: 'connected', generation: 2 }));
  t.mock.method(bridges, 'snapshot', () => ({ state: { leafId: 'a-tip' } }));
  const live = sessionTree(await get('/tree'));
  assert.equal(live.connected, true);
  assert.equal(live.activeLeafId, 'a-tip');
  assert.equal(live.generation, 2);
  assert.deepEqual(readFileSync(file), original);
  writeFileSync(file, `${original.toString()} {"type":`);
  assert.equal((await fetch(`${base}/tree`)).status, 409);
  assert.equal((await fetch(`${base}/branch?entryId=a-tip`)).status, 409);
});
