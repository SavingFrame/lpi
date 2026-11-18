import { emptyView } from '../../src/shared/client-state.ts';
import { createRelayClient } from '../src/client/relay-client.ts';

export const id = '11111111-1111-1111-1111-111111111111';
export const otherId = '22222222-2222-2222-2222-222222222222';
export const partial = { role: 'assistant', timestamp: 2, content: [], stopReason: 'pending' };

export function boundary(cursor = 0, sessionId = id, epoch = 'server-one') {
  return {
    epoch,
    cursor,
    session: {
      id: sessionId,
      projectId: 'test',
      directory: '/tmp/project',
      file: '/tmp/session.jsonl',
      createdAt: '2026-01-01T00:00:00Z',
      piSessionId: 'native-id',
      connection: 'connected',
      generation: 3,
    },
    readState: { completionId: null, viewedCompletionId: null },
    state: { isStreaming: false, hasPendingMessages: false },
    controls: {
      availableModels: [{ provider: 'fake', id: 'first', name: 'First' }],
      scopedModels: [],
      model: { provider: 'fake', id: 'first', name: 'First' },
      thinkingLevel: 'medium',
      availableThinkingLevels: ['off', 'low', 'medium', 'high'],
      contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 },
    },
    view: emptyView(),
  };
}

export function setup(t) {
  const sockets = [];
  const relayOrigin = 'http://127.0.0.1:3141';
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      sockets.push(this);
    }
    send(record) {
      this.onmessage?.({ data: JSON.stringify(record) });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  const requests = [];
  t.mock.method(
    globalThis,
    'fetch',
    (path, options) => new Promise((resolve) => requests.push({ path, options, resolve })),
  );
  const { live, queryClient } = createRelayClient({ relayOrigin });
  let invalidations = 0;
  t.mock.method(queryClient, 'invalidateQueries', async ({ queryKey }) => {
    if (queryKey[0] === 'sessions') {
      invalidations++;
    }
  });
  t.after(() => {
    live.disconnect();
    globalThis.WebSocket = original;
  });
  live.select(id);
  live.connect();
  sockets[0].send({ type: 'connected', epoch: 'server-one', cursor: 0 });
  const send = (cursor, data, generation = 3) =>
    sockets
      .at(-1)
      .send({ epoch: 'server-one', cursor, sessionId: id, generation, type: 'pi-event', data });
  return { live, sockets, requests, send, invalidations: () => invalidations };
}
