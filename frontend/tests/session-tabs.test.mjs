import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeSessionTab,
  openSessionTab,
  parseSessionTabs,
} from '../src/navigation/session-tabs-state.ts';

const first = { projectId: 'a'.repeat(64), sessionId: '11111111-1111-1111-1111-111111111111' };
const second = { projectId: 'b'.repeat(64), sessionId: '22222222-2222-2222-2222-222222222222' };
const third = { ...first, sessionId: '33333333-3333-3333-3333-333333333333' };

test('opening sessions deduplicates tabs and restores the active working set', () => {
  let state = openSessionTab(parseSessionTabs(null), first);
  state = openSessionTab(state, second);
  state = openSessionTab(state, { ...first, branch: 'entry-one' });
  assert.equal(state.tabs.length, 2);
  assert.equal(state.active, first.sessionId);
  assert.equal(state.tabs[0].branch, 'entry-one');
  assert.deepEqual(parseSessionTabs(JSON.parse(JSON.stringify(state))), state);
  state = openSessionTab(state, first);
  assert.equal(state.tabs[0].branch, undefined);
});

test('closing background, active and final tabs chooses a neighbor without reopening sessions', () => {
  let state = [first, second, third].reduce(openSessionTab, parseSessionTabs(null));
  state = closeSessionTab(state, second.sessionId);
  assert.equal(state.active, third.sessionId);
  assert.deepEqual(state.tabs, [first, third]);
  state = closeSessionTab(state, third.sessionId);
  assert.equal(state.active, first.sessionId);
  state = closeSessionTab(state, first.sessionId);
  assert.deepEqual(state, { tabs: [], active: null });
  assert.deepEqual(parseSessionTabs(state), state);
});

test('invalid stored tabs and duplicates are discarded and invalid active IDs fall back', () => {
  assert.deepEqual(
    parseSessionTabs({
      tabs: [null, first, first, { ...second, projectId: '../bad' }],
      active: 'missing',
    }),
    {
      tabs: [first],
      active: first.sessionId,
    },
  );
  assert.deepEqual(parseSessionTabs({ tabs: 'bad' }), { tabs: [], active: null });
});
