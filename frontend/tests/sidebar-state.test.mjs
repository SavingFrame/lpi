import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activityCounts,
  filterSessions,
  groupSessions,
  visibleSessions,
} from '../../src/client/inventory.ts';
import { relativeTime } from '../../src/client/relative-time.ts';
import { hasUnreadCompletion } from '../../src/shared/session-read-state.ts';
import { projectColor } from '../src/sidebar-state.ts';

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
  archived: false,
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

test('archive view excludes archived running, unread, and selected sessions from normal groups', () => {
  const hidden = {
    ...session('archived', 'a', 'running'),
    archived: true,
    readState: { completionId: 'turn', viewedCompletionId: null },
  };
  const items = [session('visible', 'a', 'idle'), hidden];
  const normal = groupSessions(projects, items, true)[0].sessions;
  assert.deepEqual(
    visibleSessions(normal, hidden.id, false).map((item) => item.id),
    ['visible'],
  );
  const archived = groupSessions(projects, items, true, true)[0].sessions;
  assert.deepEqual(
    archived.map((item) => item.id),
    ['archived'],
  );
  assert.equal(archived[0].activity, 'running');
  assert.equal(hasUnreadCompletion(archived[0].readState), true);
  assert.equal(items[1].archived, true);
});

test('search and live/saved filters include idle runtimes without mistaking offline activity for exit', () => {
  const live = { ...session('live', 'a', 'idle'), title: 'Review API' };
  const saved = {
    ...session('saved', 'b', 'unknown'),
    connection: 'disconnected',
    title: 'Review UI',
  };
  const archived = { ...saved, id: 'archived', archived: true };
  const items = [live, saved, archived];
  assert.deepEqual(filterSessions(items, projects, 'live', '', true), [live]);
  assert.deepEqual(filterSessions(items, projects, 'live', '', false), []);
  assert.deepEqual(filterSessions(items, projects, 'saved', '', false), [saved]);
  assert.deepEqual(filterSessions(items, projects, 'all', 'REVIEW api', true), [live]);
  assert.deepEqual(filterSessions(items, projects, 'all', '/projects/b', true), [saved]);
  assert.deepEqual(filterSessions(items, projects, 'archived', 'review', true), [archived]);
  assert.equal(filterSessions(items, projects, 'all', 'missing', true).length, 0);
});

test('unconfigured directories remain visible, searchable and grouped without creation controls', () => {
  const live = { ...session('outside', 'outside-id', 'idle'), directory: '/tmp/work' };
  const saved = { ...live, id: 'saved', connection: 'disconnected' };
  const archived = { ...live, id: 'archived', archived: true };
  const items = [live, saved, archived];
  const groups = groupSessions(projects, items, true);
  const outside = groups.find((group) => group.project.id === live.projectId);
  assert.equal(outside.configured, false);
  assert.equal(outside.project.name, '/tmp/work');
  assert.deepEqual(
    outside.sessions.map((item) => item.id),
    ['outside', 'saved'],
  );
  assert.ok(
    groups
      .filter((group) => group.project.id !== live.projectId)
      .every((group) => group.configured),
  );
  assert.deepEqual(filterSessions(items, projects, 'all', '/tmp/work', true), [live, saved]);
  assert.deepEqual(filterSessions(items, projects, 'live', '/tmp/work', true), [live]);
  assert.deepEqual(filterSessions(items, projects, 'saved', '/tmp/work', true), [saved]);
  assert.deepEqual(
    groupSessions([], items, true, true)[0].sessions.map((item) => item.id),
    ['archived'],
  );
  assert.equal(groupSessions([], [archived], true).length, 0);
});

test('project colors remain stable and relative times are compact', () => {
  assert.equal(projectColor('a'), projectColor('a'));
  assert.match(projectColor('a'), /^#[0-9a-f]{6}$/);
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(relativeTime('invalid', now), '');
  assert.equal(relativeTime('2026-01-01T12:01:00Z', now), 'now');
  assert.equal(relativeTime('2026-01-01T11:59:01Z', now), 'now');
  assert.equal(relativeTime('2026-01-01T11:59:00Z', now), '1m');
  assert.equal(relativeTime('2026-01-01T11:00:00Z', now), '1h');
  assert.equal(relativeTime('2025-12-31T12:00:00Z', now), '1d');
  assert.equal(relativeTime('2026-01-01T11:55:00Z', now), '5m');
  assert.equal(relativeTime('2026-01-01T10:00:00Z', now), '2h');
  assert.equal(relativeTime('2025-12-30T12:00:00Z', now), '2d');
});
