import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ApiError, RelayApi } from '../../src/client/api.ts';
import { LiveSession } from '../../src/client/live.ts';
import { boundary, id } from './live-fixture.mjs';

test('shared transport uses injected addressing and request IDs without replaying mutations', async () => {
  const requests = [];
  const api = new RelayApi({
    requestId: () => 'mobile-request',
    fetch: async (path, request) => {
      requests.push({ url: new URL(path, 'http://relay.example:3141').href, request });
      throw new Error('app suspended');
    },
  });
  await assert.rejects(
    api.operate(id, 3, { type: 'abort' }),
    (error) => error instanceof ApiError && error.outcome === 'unknown',
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `http://relay.example:3141/sessions/${id}/commands`);
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    generation: 3,
    command: { type: 'abort' },
    requestId: 'mobile-request',
  });
});

test('shared transport forwards cancellation without AbortSignal composition helpers', async () => {
  const controller = new AbortController();
  const api = new RelayApi({
    requestId: () => 'unused',
    fetch: (_path, request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      }),
  });
  const request = api.inspect(id, controller.signal);
  controller.abort();
  await assert.rejects(request, /aborted/);
});

test('lifecycle disconnect retains history but requires a new synchronized snapshot', async (t) => {
  const sockets = [];
  const requests = [];
  const live = new LiveSession(
    {
      openSocket: () => {
        const socket = {
          readyState: 1,
          onmessage: null,
          onerror: null,
          onclose: null,
          close() {
            this.readyState = 3;
            this.onclose?.();
          },
        };
        sockets.push(socket);
        return socket;
      },
      inspect: (_id, signal) => new Promise((resolve) => requests.push({ signal, resolve })),
    },
    () => {},
  );
  t.after(() => live.disconnect());
  const connected = () =>
    sockets.at(-1).onmessage({
      data: JSON.stringify({ type: 'connected', epoch: 'server-one', cursor: 0 }),
    });
  live.select(id);
  live.connect();
  connected();
  requests[0].resolve(boundary());
  await setImmediate();
  const history = live.getState().snapshot;
  live.disconnect();
  assert.equal(live.getState().status, 'offline');
  assert.equal(live.getState().snapshot, history);
  live.connect();
  connected();
  assert.equal(live.getState().status, 'syncing');
  live.disconnect();
  assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve(boundary(2));
  await setImmediate();
  assert.equal(live.getState().status, 'offline');
  assert.equal(live.getState().snapshot, history);
  assert.equal(sockets.length, 2);
});
