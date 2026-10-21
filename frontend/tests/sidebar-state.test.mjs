import assert from 'node:assert/strict';
import test from 'node:test';
import { activityCounts, groupSessions, visibleSessions } from '../../src/client/inventory.ts';
import { hasUnreadCompletion } from '../../src/shared/session-read-state.ts';
import { projectColor, relativeTime } from '../src/sidebar-state.ts';

const projects = [
  { id: 'a', name: 'same', directory: '/projects/a' },
  { id: 'b', name: 'same', directory: '/projects/b' },
  { id: 'empty', name: 'empty', directory: '/projects/empty' },
];
const session = (id, projectId, activity, updatedAt = '2026-01-01T12:00:00Z') => ({
  id,
  projectId,
  activity,
  updatedAt,
  createdAt: '2026-01-01T00:00:00Z',
  connection: 'connected',
  generation: 1,
  readState: { completionId: null, viewedCompletionId: null },
});

test('groups by project identity, sorts by recency, and retains empty projects', () => {
  const items = [
    session('old', 'a', 'idle'),
    session('newest', 'b', 'running', '2026-01-02T00:00:00Z'),
    session('new', 'a', 'idle', '2026-01-01T13:00:00Z'),
  ];
  const groups = groupSessions(projects, items, true);
  assert.deepEqual(
    groups.map((group) => group.project.id),
    ['b', 'a', 'empty'],
  );
  assert.deepEqual(
    groups[1].sessions.map((item) => item.id),
    ['new', 'old'],
  );
  assert.equal(groups[2].sessions.length, 0);
  assert.equal(items[0].id, 'old');
});

test('project activity retains both waiting and running counts', () => {
  const items = [
    session('1', 'a', 'running'),
    session('2', 'a', 'blocked'),
    session('3', 'a', 'running'),
    session('4', 'a', 'idle'),
  ];
  assert.deepEqual(activityCounts(groupSessions(projects, items, true)[0].sessions), {
    running: 2,
    blocked: 1,
  });
});

test('lost relay or native connections cannot advertise stale runtime activity', () => {
  const items = [
    session('1', 'a', 'running'),
    { ...session('2', 'a', 'idle'), connection: 'disconnected' },
  ];
  const offline = groupSessions(projects, items, false)[0].sessions;
  assert.ok(offline.every((item) => item.activity === 'unknown'));
  assert.deepEqual(activityCounts(offline), { running: 0, blocked: 0 });
  assert.deepEqual(
    groupSessions(projects, items, true)[0].sessions.map((item) => item.activity),
    ['running', 'unknown'],
  );
});

test('unread completions survive disconnection and remain separate from running activity', () => {
  const item = {
    ...session('1', 'a', 'running'),
    readState: { completionId: 'latest', viewedCompletionId: 'older' },
  };
  const offline = groupSessions(projects, [item], false)[0].sessions[0];
  assert.equal(offline.activity, 'unknown');
  assert.equal(hasUnreadCompletion(offline.readState), true);
  assert.equal(
    hasUnreadCompletion({ completionId: 'latest', viewedCompletionId: 'latest' }),
    false,
  );
  assert.equal(hasUnreadCompletion({ completionId: null, viewedCompletionId: null }), false);
});

test('recent sessions retain selected, active, and unread rows while older history expands', () => {
  const items = [
    session('recent', 'a', 'idle'),
    session('older', 'a', 'idle'),
    session('selected', 'a', 'idle'),
    session('running', 'a', 'running'),
    session('blocked', 'a', 'blocked'),
    {
      ...session('unread', 'a', 'idle'),
      readState: { completionId: 'turn', viewedCompletionId: null },
    },
  ];
  assert.deepEqual(
    visibleSessions(items, 'selected', false, 1).map((item) => item.id),
    ['recent', 'selected', 'running', 'blocked', 'unread'],
  );
  assert.equal(visibleSessions(items, 'selected', true, 1), items);
  assert.equal(items.length, 6);
});

test('project colors remain stable and relative times are compact', () => {
  assert.equal(projectColor('a'), projectColor('a'));
  assert.match(projectColor('a'), /^#[0-9a-f]{6}$/);
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(relativeTime('2026-01-01T12:01:00Z', now), 'now');
  assert.equal(relativeTime('2026-01-01T11:55:00Z', now), '5m');
  assert.equal(relativeTime('2026-01-01T10:00:00Z', now), '2h');
  assert.equal(relativeTime('2025-12-30T12:00:00Z', now), '2d');
});
