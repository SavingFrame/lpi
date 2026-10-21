import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { sessionTreeQuery } from '../src/tree-query.ts';

const savedTree = (sessionId) => ({
  sessionId,
  generation: 1,
  connected: false,
  activeLeafId: null,
  nodes: [],
});

test('sidebar never fetches trees; only open details fetch and refresh their shared cache', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const id = url.split('/')[2];
    requests.push(id);
    return Response.json(savedTree(id));
  });
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const observers = [];
  const subscriptions = [];
  t.after(() => {
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
    client.clear();
  });
  for (const id of ['a', 'b', 'c']) {
    const observer = new QueryObserver(client, sessionTreeQuery(id, 'sidebar'));
    observers.push(observer);
    subscriptions.push(observer.subscribe(() => {}));
  }
  await client.invalidateQueries({ queryKey: ['tree'] });
  assert.deepEqual(requests, []);
  assert.equal(observers[0].getCurrentResult().data, undefined);

  const details = new QueryObserver(client, sessionTreeQuery('b', 'details'));
  const closeDetails = details.subscribe(() => {});
  subscriptions.push(closeDetails);
  await client.ensureQueryData(sessionTreeQuery('b', 'details'));
  assert.deepEqual(requests, ['b']);
  assert.deepEqual(observers[1].getCurrentResult().data, savedTree('b'));
  assert.equal(observers[0].getCurrentResult().data, undefined);

  await client.invalidateQueries({ queryKey: ['tree'] });
  assert.deepEqual(requests, ['b', 'b']);
  closeDetails();
  await client.invalidateQueries({ queryKey: ['tree'] });
  assert.deepEqual(requests, ['b', 'b']);
  assert.deepEqual(observers[1].getCurrentResult().data, savedTree('b'));

  const nextDetails = new QueryObserver(client, sessionTreeQuery('c', 'details'));
  subscriptions.push(nextDetails.subscribe(() => {}));
  await client.ensureQueryData(sessionTreeQuery('c', 'details'));
  assert.deepEqual(requests, ['b', 'b', 'c']);
});

test('tree errors can be retried from details without enabling sidebar fetching', async (t) => {
  let failed = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (failed) {
      return Response.json({ error: 'History unavailable' }, { status: 500 });
    }
    return Response.json(savedTree('a'));
  });
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  t.after(() => client.clear());
  const sidebar = new QueryObserver(client, sessionTreeQuery('a', 'sidebar'));
  const unsubscribe = sidebar.subscribe(() => {});
  t.after(unsubscribe);
  await assert.rejects(client.fetchQuery(sessionTreeQuery('a', 'details')), /History unavailable/);
  assert.equal(sidebar.getCurrentResult().data, undefined);
  failed = false;
  await client.fetchQuery(sessionTreeQuery('a', 'details'));
  assert.deepEqual(sidebar.getCurrentResult().data, savedTree('a'));
});
