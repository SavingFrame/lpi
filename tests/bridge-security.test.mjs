import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { setup, waitFor } from './bridge-fixture.mjs';

test('bridge rejection logs identify invalid fields and redact payload contents', async (t) => {
  const logs = [];
  t.mock.method(console, 'warn', (prefix, line) => {
    assert.equal(prefix, '[pim:bridge]');
    logs.push(JSON.parse(line));
  });
  const { url, identity, snapshot, open } = await setup(t);
  const secret = 'PRIVATE_TRANSCRIPT_AND_IMAGE_DATA';
  const invalid = structuredClone(snapshot);
  delete invalid.controls.availableThinkingLevels;
  invalid.view.messages[0].content = secret;
  const socket = new WebSocket(url);
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'attach', session: identity, snapshot: invalid }));
  assert.equal((await closed)[0], 1008);
  assert.equal(logs[0].event, 'rejected');
  assert.equal(logs[0].phase, 'registration');
  assert.equal(logs[0].frame, 'attach');
  assert.match(logs[0].reason, /controls.availableThinkingLevels/);
  assert.equal(typeof logs[0].connectionId, 'string');
  assert.ok(Number.isFinite(Date.parse(logs[0].timestamp)));

  const { socket: connected, attached } = await open();
  const connectedClosed = once(connected, 'close');
  connected.send(JSON.stringify({ type: 'event', event: { type: secret } }));
  assert.equal((await connectedClosed)[0], 1008);
  assert.equal(logs[1].phase, 'connected');
  assert.equal(logs[1].frame, 'event');
  assert.equal(logs[1].reason, 'Unsupported bridge event');
  assert.equal(logs[1].sessionId, attached.sessionId);
  assert.equal(logs[1].generation, attached.generation);

  const malformed = new WebSocket(url);
  await once(malformed, 'open');
  const malformedClosed = once(malformed, 'close');
  malformed.send(`${secret} is not JSON`);
  assert.equal((await malformedClosed)[0], 1008);
  assert.equal(logs[2].reason, 'Invalid JSON');
  assert.equal(logs[2].frame, 'unparsed');
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test('duplicate connections and stale generations are blocked; reloaded instances can reconnect', async (t) => {
  const logs = [];
  t.mock.method(console, 'warn', (_prefix, line) => logs.push(JSON.parse(line)));
  const { open, bridges, url, identity, snapshot } = await setup(t);
  const { socket, attached } = await open();
  const conflict = new WebSocket(url);
  conflict.on('error', () => {});
  await once(conflict, 'open');
  const conflictClosed = once(conflict, 'close');
  conflict.send(JSON.stringify({ type: 'attach', session: identity, snapshot }));
  assert.equal((await conflictClosed)[0], 1008);
  assert.equal(logs[0].phase, 'registration');
  assert.equal(logs[0].reason, 'Conflicting native connection or session identity');
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation - 1, { type: 'abort' }),
    /stale/,
  );
  socket.terminate();
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  const reconnected = await open();
  assert.ok(reconnected.attached.generation > attached.generation);
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  reconnected.socket.terminate();
});

test('lost acknowledgments are unknown and never replayed', async (t) => {
  const { open, bridges } = await setup(t, 50);
  const { socket, attached } = await open();
  let commands = 0;
  socket.on('message', () => commands++);
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation, {
      type: 'prompt',
      message: 'Uncertain',
    }),
    (error) => error.outcome === 'unknown',
  );
  await waitFor(() => bridges.get(attached.sessionId).connection === 'disconnected');
  assert.equal(commands, 1);
  await assert.rejects(bridges.command(attached.sessionId, attached.generation, { type: 'abort' }));
  assert.equal(commands, 1);
});

test('bridge socket needs no token but rejects browser origins and unknown hosts', async (t) => {
  const { open, url } = await setup(t);
  const { socket: connected } = await open();
  connected.terminate();
  for (const headers of [
    { Origin: 'http://localhost:5173' },
    { Origin: 'https://evil.example' },
    { Host: 'evil.example' },
  ]) {
    const socket = new WebSocket(url, { headers });
    socket.on('error', () => {});
    const response = await once(socket, 'unexpected-response');
    assert.equal(response[1].statusCode, 403);
    response[1].resume();
    socket.terminate();
  }
});
