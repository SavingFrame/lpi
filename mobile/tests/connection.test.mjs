import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { checkRelay } from '../../src/client/connection-check.ts';
import { RelayConnection, serverPreferenceKey } from '../src/lib/connection.ts';

function probeFixture(fetchResponse = (path) => Response.json({ [path.slice(1)]: [] })) {
  const requests = [];
  const sockets = [];
  const environment = {
    fetch: async (path, request) => {
      requests.push({ path, ...request });
      return fetchResponse(path, request);
    },
    requestId: () => assert.fail('Validation must not generate mutation IDs'),
    openSocket: () => {
      const socket = {
        readyState: 1,
        onmessage: null,
        onerror: null,
        onclose: null,
        closed: false,
        close() {
          this.closed = true;
          this.onclose?.();
        },
      };
      sockets.push(socket);
      return socket;
    },
  };
  return {
    environment,
    requests,
    sockets,
    handshake: (frame = { type: 'connected', epoch: 'relay', cursor: 0, replay: false }) =>
      sockets.at(-1).onmessage({ data: JSON.stringify(frame) }),
  };
}

function connectionFixture(check) {
  const values = new Map([[serverPreferenceKey, 'http://previous:3141']]);
  const accepted = [];
  const writes = [];
  const storage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      writes.push(value);
      values.set(key, value);
    },
    removeItem: async (key) => values.delete(key),
  };
  const connection = new RelayConnection({
    storage,
    check,
    accept: (origin) => accepted.push(origin),
  });
  return { connection, values, accepted, writes, storage };
}

test('only validated inventory and an lpi event boundary allow saving/switching, on any port', async () => {
  const probe = probeFixture();
  const fixture = connectionFixture((_origin, signal) => checkRelay(probe.environment, signal));
  const connecting = fixture.connection.connect(' https://relay.example:8081/ ');
  await setImmediate();
  assert.equal(fixture.connection.getState().pending, true);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.accepted, []);
  await fixture.connection.connect('http://duplicate:3141');
  assert.equal(probe.sockets.length, 1);
  probe.handshake();
  await connecting;
  assert.deepEqual(fixture.writes, ['https://relay.example:8081']);
  assert.deepEqual(fixture.accepted, ['https://relay.example:8081']);
  assert.equal(fixture.connection.getState().pending, false);
  assert.deepEqual(
    probe.requests.map(({ path, method }) => [path, method]),
    [
      ['/projects', 'GET'],
      ['/sessions', 'GET'],
    ],
  );
  assert.ok(probe.requests.every((request) => request.body === undefined));
  assert.ok(probe.sockets[0].closed);
});

test('Expo HTML, malformed contracts, and unreachable servers preserve previous settings', async (t) => {
  for (const [name, response] of [
    ['Expo', () => new Response('<html>Expo dev server</html>')],
    [
      'projects',
      (path) => Response.json(path === '/projects' ? { projects: [{}] } : { sessions: [] }),
    ],
    [
      'sessions',
      (path) => Response.json(path === '/sessions' ? { sessions: [{}] } : { projects: [] }),
    ],
    ['unreachable', () => Promise.reject(new TypeError('Network request failed'))],
  ]) {
    await t.test(name, async () => {
      const probe = probeFixture(response);
      const fixture = connectionFixture((_origin, signal) => checkRelay(probe.environment, signal));
      await fixture.connection.connect('http://wrong:8081');
      assert.match(fixture.connection.getState().error, /relay.*Expo/s);
      assert.equal(fixture.values.get(serverPreferenceKey), 'http://previous:3141');
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.accepted, []);
      assert.equal(probe.sockets.length, 0);
    });
  }
});

test('invalid, closed, or silent event sockets fail and are cleaned up', async (t) => {
  for (const action of ['invalid', 'closed', 'silent']) {
    await t.test(action, async () => {
      const probe = probeFixture();
      const checking = checkRelay(probe.environment, new AbortController().signal, 30);
      const rejected = assert.rejects(checking, /handshake|WebSocket|timed out/);
      await setImmediate();
      if (action === 'invalid') {
        probe.handshake({ type: 'connected', epoch: 'x', cursor: '0' });
      }
      if (action === 'closed') {
        probe.sockets[0].onclose();
      }
      await rejected;
      assert.ok(probe.sockets[0].closed);
      assert.equal(probe.sockets[0].onmessage, null);
    });
  }
});

test('the overall timeout bounds even an HTTP transport that ignores abort', async () => {
  const gate = Promise.withResolvers();
  const probe = probeFixture(() => gate.promise);
  const fixture = connectionFixture((_origin, signal) => checkRelay(probe.environment, signal, 20));
  await fixture.connection.connect('http://silent:3141');
  assert.match(fixture.connection.getState().error, /timed out/);
  assert.equal(fixture.connection.getState().pending, false);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.accepted, []);
  assert.ok(probe.requests.every((request) => request.signal.aborted));
  gate.resolve(Response.json({ projects: [], sessions: [] }));
  await setImmediate();
  assert.equal(probe.sockets.length, 0);
});

test('closing cancels HTTP or WebSocket validation and ignores late results', async (t) => {
  for (const phase of ['http', 'socket']) {
    await t.test(phase, async () => {
      const gate = Promise.withResolvers();
      const probe = probeFixture(phase === 'http' ? () => gate.promise : undefined);
      const fixture = connectionFixture((_origin, signal) => checkRelay(probe.environment, signal));
      const connecting = fixture.connection.connect('http://candidate:3141');
      await setImmediate();
      const staleMessage = probe.sockets[0]?.onmessage;
      fixture.connection.cancel();
      await connecting;
      gate.resolve(Response.json({ projects: [], sessions: [] }));
      staleMessage?.({ data: '{"type":"connected","epoch":"stale","cursor":0,"replay":false}' });
      await setImmediate();
      assert.equal(fixture.connection.getState().pending, false);
      assert.equal(fixture.connection.getState().error, null);
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.accepted, []);
      if (phase === 'socket') {
        assert.ok(probe.sockets[0].closed);
      } else {
        assert.equal(probe.sockets.length, 0);
      }
    });
  }
});

test('a stale check cannot save or interfere with a newer connection attempt', async () => {
  const gates = [];
  const fixture = connectionFixture(() => {
    const gate = Promise.withResolvers();
    gates.push(gate);
    return gate.promise;
  });
  const first = fixture.connection.connect('http://stale:3141');
  fixture.connection.cancel();
  gates[0].resolve();
  await first;
  const second = fixture.connection.connect('http://current:9000');
  gates[1].resolve();
  await second;
  assert.deepEqual(fixture.writes, ['http://current:9000']);
  assert.deepEqual(fixture.accepted, ['http://current:9000']);
});

test('storage failure does not switch clients; closing during a write restores the old preference', async () => {
  const fixture = connectionFixture(async () => {});
  const save = fixture.storage.setItem;
  fixture.storage.setItem = async () => {
    throw new Error('Device storage unavailable');
  };
  await fixture.connection.connect('http://candidate:3141');
  assert.match(fixture.connection.getState().error, /storage unavailable/);
  assert.equal(fixture.values.get(serverPreferenceKey), 'http://previous:3141');
  assert.deepEqual(fixture.accepted, []);

  const gate = Promise.withResolvers();
  fixture.storage.setItem = async (key, value) => {
    if (value === 'http://candidate:3141') {
      await gate.promise;
    }
    await save(key, value);
  };
  const connecting = fixture.connection.connect('http://candidate:3141');
  await setImmediate();
  fixture.connection.cancel();
  await fixture.connection.connect('http://duplicate:3141');
  gate.resolve();
  await connecting;
  assert.equal(fixture.values.get(serverPreferenceKey), 'http://previous:3141');
  assert.deepEqual(fixture.accepted, []);
});
