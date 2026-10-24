import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyView } from '../../src/shared/client-state.ts';
import { LivePresentation } from '../src/lib/live-presentation.ts';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let current = {
    status: 'ready',
    error: null,
    snapshot: {
      epoch: 'isolated',
      cursor: 0,
      session: { id: 'one', generation: 1, connection: 'connected' },
      controls: {},
      readState: { completionId: null, viewedCompletionId: null },
      state: { isStreaming: true },
      view: { ...emptyView(), running: true },
    },
  };
  const subscribers = new Set();
  const source = {
    getState: () => current,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  const presentation = new LivePresentation(source);
  const publish = (next) => {
    current = next;
    for (const listener of subscribers) {
      listener();
    }
  };
  const token = (text) =>
    publish({
      ...current,
      snapshot: {
        ...current.snapshot,
        cursor: current.snapshot.cursor + 1,
        view: {
          ...current.snapshot.view,
          partial: { role: 'assistant', timestamp: 1, content: text },
        },
      },
    });
  return { source, subscribers, presentation, publish, token };
}

test('continuous token bursts coalesce without delaying authoritative state or starving rendering', (t) => {
  const { source, presentation, token } = setup(t);
  let updates = 0;
  const unsubscribe = presentation.subscribe(() => updates++);
  t.after(unsubscribe);
  for (let i = 0; i < 100; i++) {
    token(String(i));
  }
  assert.equal(source.getState().snapshot.cursor, 100);
  assert.equal(presentation.getState().snapshot.cursor, 0);
  assert.equal(updates, 0);
  t.mock.timers.tick(99);
  token('latest');
  t.mock.timers.tick(1);
  assert.equal(updates, 1, 'new tokens must not postpone trailing delivery');
  assert.equal(presentation.getState(), source.getState());
  token('next interval');
  t.mock.timers.tick(100);
  assert.equal(updates, 2);
});

test('disconnects, selection boundaries and completions bypass pending token delivery', (t) => {
  const { source, presentation, publish, token } = setup(t);
  let updates = 0;
  const unsubscribe = presentation.subscribe(() => updates++);
  t.after(unsubscribe);
  token('pending');
  publish({ ...source.getState(), status: 'offline' });
  assert.equal(presentation.getState().status, 'offline');
  t.mock.timers.tick(100);
  assert.equal(updates, 1, 'no stale timer notification after an urgent boundary');
  publish({
    ...source.getState(),
    status: 'ready',
    snapshot: {
      ...source.getState().snapshot,
      session: { id: 'two', generation: 2, connection: 'connected' },
    },
  });
  assert.equal(presentation.getState().snapshot.session.id, 'two');
  token('completion incoming');
  publish({
    ...source.getState(),
    snapshot: {
      ...source.getState().snapshot,
      readState: { completionId: 'new', viewedCompletionId: null },
      view: { ...source.getState().snapshot.view, running: false, partial: null },
    },
  });
  assert.equal(presentation.getState(), source.getState());
  assert.equal(presentation.getState().snapshot.readState.completionId, 'new');
});

test('hiding removes the subscription and timer; showing reads the latest snapshot', (t) => {
  const { source, subscribers, presentation, token } = setup(t);
  let updates = 0;
  const unsubscribe = presentation.subscribe(() => updates++);
  token('pending');
  unsubscribe();
  assert.equal(subscribers.size, 0);
  token('arrived while hidden');
  t.mock.timers.tick(1000);
  assert.equal(updates, 0);
  assert.equal(presentation.getState(), source.getState());
  const stop = presentation.subscribe(() => updates++);
  t.after(stop);
  assert.equal(subscribers.size, 1);
  assert.equal(presentation.getState().snapshot.view.partial.content, 'arrived while hidden');
  token('visible again');
  t.mock.timers.tick(100);
  assert.equal(updates, 1);
});
