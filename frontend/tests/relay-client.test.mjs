import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { clientStorageKey } from '../../src/client/storage.ts';
import { createRelayClient } from '../src/client/relay-client.ts';
import { boundary, id } from './live-fixture.mjs';

function fixture(t, requireInventory = false) {
  let holdPcInventory;
  const projectId = boundary().session.projectId;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  function relay(relayOrigin, name) {
    const snapshot = boundary(0, id, name);
    snapshot.session.title = name;
    const requests = [];
    const sockets = [];
    const client = createRelayClient({
      relayOrigin,
      requireInventory,
      storage,
      openSocket: (url) => {
        const socket = {
          url,
          readyState: 1,
          close() {
            this.readyState = 3;
            this.onclose?.();
          },
        };
        sockets.push(socket);
        return socket;
      },
      fetch: async (url, request) => {
        assert.equal(url.origin, new URL(relayOrigin).origin);
        requests.push({ path: url.pathname, method: request.method });
        const body = request.body && JSON.parse(request.body);
        switch (`${request.method} ${url.pathname}`) {
          case 'GET /projects':
            if (name === 'PC' && holdPcInventory) {
              await holdPcInventory.promise;
            }
            return Response.json({
              projects: [{ id: projectId, name, directory: '/tmp/project' }],
            });
          case 'GET /sessions':
            return Response.json({
              sessions: [
                {
                  ...snapshot.session,
                  activity: 'idle',
                  archived: false,
                  managedRuntime: true,
                  readState: snapshot.readState,
                },
              ],
            });
          case `GET /sessions/${id}/snapshot`:
            return Response.json(snapshot);
          case 'POST /sessions':
            assert.equal(body.projectId, projectId);
            return Response.json({
              requestId: body.requestId,
              outcome: 'acknowledged',
              data: { session: snapshot.session },
            });
          case `POST /sessions/${id}/commands`:
            assert.equal(body.generation, snapshot.session.generation);
            assert.deepEqual(body.command, { type: 'prompt', message: name });
            return name === 'PC'
              ? holdPcPrompt.promise.then(() => {
                  throw new Error('Lost response');
                })
              : Response.json({ requestId: body.requestId, outcome: 'acknowledged' });
          default:
            throw new Error(`Unexpected request: ${url.href}`);
        }
      },
    });
    t.after(() => {
      client.live.disconnect();
      client.queryClient.clear();
    });
    return {
      ...client,
      requests,
      sockets,
      connect() {
        client.live.connect();
        sockets.at(-1).onmessage({
          data: JSON.stringify({ type: 'connected', epoch: name, cursor: 0 }),
        });
      },
    };
  }
  const holdPcPrompt = Promise.withResolvers();
  const pc = relay('https://PC.example:443/', 'PC');
  const homelab = relay('https://homelab.example', 'Homelab');
  return {
    pc,
    homelab,
    projectId,
    values,
    holdPcPrompt,
    pauseInventory() {
      const hold = Promise.withResolvers();
      holdPcInventory = hold;
      t.after(() => hold.resolve());
      return () => {
        holdPcInventory = undefined;
        hold.resolve();
      };
    },
  };
}

test('identical local IDs keep inventory, snapshots, launches, drafts, and pending prompts isolated', async (t) => {
  const { pc, homelab, projectId, values, holdPcPrompt } = fixture(t);
  t.after(() => holdPcPrompt.resolve());
  for (const client of [pc, homelab]) {
    client.connect();
    await client.queryClient.fetchQuery({
      queryKey: ['projects'],
      queryFn: () => client.api.projects(),
    });
    await client.launches.initialize();
  }
  assert.equal(pc.sockets[0].url.href, 'wss://pc.example/events');
  assert.equal(homelab.sockets[0].url.href, 'wss://homelab.example/events');
  assert.equal(pc.queryClient.getQueryData(['projects'])[0].name, 'PC');
  assert.equal(homelab.queryClient.getQueryData(['projects'])[0].name, 'Homelab');

  homelab.live.select(id);
  await setImmediate();
  assert.equal(homelab.live.getState().snapshot.session.title, 'Homelab');
  assert.equal(pc.live.getState().snapshot, null);
  assert.equal(
    pc.requests.some(({ path }) => path.endsWith('/snapshot')),
    false,
  );
  assert.equal((await homelab.launches.start(projectId)).title, 'Homelab');
  assert.equal(
    pc.requests.some(({ method }) => method === 'POST'),
    false,
  );
  assert.equal((await pc.launches.start(projectId)).title, 'PC');
  homelab.live.select(null);
  pc.live.select(id);
  await setImmediate();
  assert.equal(pc.live.getState().snapshot.session.title, 'PC');

  const pcDraft = pc.drafts.get(id);
  const labDraft = homelab.drafts.get(id);
  // An existing desktop draft is keyed by origin, not the future profile ID or label.
  values.set(clientStorageKey('https://pc.example', 'draft', id), JSON.stringify({ text: 'PC' }));
  await Promise.all([pcDraft.initialize(), labDraft.initialize()]);
  assert.equal(pcDraft.getState().draft.text, 'PC');
  assert.equal(labDraft.getState().draft.text, '');
  labDraft.update(() => ({ text: 'Homelab', images: [] }));
  await labDraft.flush();

  const pcCommands = pc.sessionCommands(id, projectId);
  const labCommands = homelab.sessionCommands(id, projectId);
  await Promise.all([pcCommands.initialize(), labCommands.initialize()]);
  const pending = pcCommands.submit({ type: 'prompt', message: 'PC' });
  await setImmediate();
  assert.equal(pcCommands.getState().pending, true);
  assert.equal(pc.hasPendingMutation(), true);
  assert.equal(homelab.hasPendingMutation(), false);
  assert.equal(
    homelab.requests.some(({ path }) => path.endsWith('/commands')),
    false,
  );
  assert.equal(values.get(clientStorageKey('https://pc.example', 'command', id)), 'true');
  assert.equal(values.has(clientStorageKey('https://homelab.example', 'command', id)), false);

  pc.sockets[0].close();
  assert.equal(pc.live.getState().status, 'offline');
  assert.equal(homelab.live.getState().status, 'ready');
  pc.live.select(null);
  homelab.live.select(id);
  await setImmediate();
  assert.equal(await labCommands.submit({ type: 'prompt', message: 'Homelab' }), true);

  pc.connect();
  assert.equal(pc.sockets.length, 2);
  assert.equal(homelab.sockets.length, 1);
  assert.equal(pc.queryClient.getQueryState(['projects']).isInvalidated, true);
  assert.equal(homelab.queryClient.getQueryState(['projects']).isInvalidated, false);
  holdPcPrompt.resolve();
  assert.equal(await pending, false);
  assert.equal(pcCommands.getState().uncertain, true);
  assert.equal(pc.hasPendingMutation(), false);
  assert.equal(labCommands.getState().uncertain, false);
  assert.equal(labDraft.getState().draft.text, 'Homelab');
  const prompts = ({ requests }) => requests.filter(({ path }) => path.endsWith('/commands'));
  assert.equal(prompts(pc).length, 1, 'reconnect never replays the pending command');
  assert.equal(prompts(homelab).length, 1, 'the pending command never moves to another relay');
});

test('desktop reconnect leaves stale inventory visible and blocks only the recovering relay', async (t) => {
  const { pc, homelab, projectId, pauseInventory } = fixture(t, true);
  pc.connect();
  homelab.connect();
  await setImmediate();
  assert.equal(pc.canMutate(), true);
  assert.equal(homelab.canMutate(), true);
  await pc.launches.initialize();
  await homelab.launches.initialize();
  const labReads = homelab.requests.length;

  pc.sockets[0].close();
  assert.equal(pc.canMutate(), false);
  assert.equal(pc.queryClient.getQueryData(['projects'])[0].name, 'PC');
  const resume = pauseInventory();
  pc.connect();
  await setImmediate();
  assert.equal(pc.live.getState().status, 'ready', 'socket alone does not validate inventory');
  assert.equal(pc.canMutate(), false);
  assert.equal(await pc.launches.start(projectId), null);
  assert.equal(homelab.requests.length, labReads, 'PC reconnect does not refresh Homelab');
  assert.equal((await homelab.launches.start(projectId)).title, 'Homelab');
  homelab.live.select(id);
  await setImmediate();
  const commands = homelab.sessionCommands(id, projectId);
  await commands.initialize();
  assert.equal(await commands.submit({ type: 'prompt', message: 'Homelab' }), true);

  resume();
  await setImmediate();
  assert.equal(pc.canMutate(), true);
  assert.equal(pc.requests.filter(({ method }) => method === 'POST').length, 0);
});
