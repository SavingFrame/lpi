import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { Launches } from '../dist/src/launches.js';
import { SessionDiscovery } from '../dist/src/storage/discovery.js';
import { setup, waitFor } from './bridge-fixture.mjs';

async function unconfigured(t) {
  const base = await setup(t);
  const directory = join(base.root, 'outside-projects');
  mkdirSync(directory);
  const alias = join(base.root, 'outside-alias');
  symlinkSync(directory, alias);
  base.identity.cwd = alias;
  base.header.cwd = directory;
  writeFileSync(base.file, `${JSON.stringify(base.header)}\n${JSON.stringify(base.entry)}\n`);
  return { ...base, directory };
}

test('unconfigured native sessions attach, accept commands, disconnect and reconnect with stable saved identity', async (t) => {
  const base = await unconfigured(t);
  const { socket, attached } = await base.open();
  const session = base.bridges.get(attached.sessionId);
  assert.equal(session.directory, base.directory);
  assert.notEqual(session.projectId, base.config.projects[0].id);
  assert.equal(
    base.inventory.snapshot(session.id).view.messages[0].content,
    base.entry.message.content,
  );
  assert.ok(base.inventory.list().some((item) => item.id === session.id));
  const command = once(socket, 'message');
  const pending = base.bridges.command(session.id, session.generation, { type: 'abort' });
  const frame = JSON.parse(String((await command)[0]));
  assert.equal(frame.command.type, 'abort');
  socket.send(JSON.stringify({ type: 'ack', id: frame.id, outcome: 'acknowledged' }));
  await pending;
  socket.terminate();
  await waitFor(() => base.bridges.get(session.id).connection === 'disconnected');
  const saved = new SessionDiscovery([join(base.file, '..')], base.config.projects).get(session.id);
  assert.equal(saved.projectId, session.projectId);
  const reconnected = await base.open();
  assert.equal(reconnected.attached.sessionId, session.id);
  assert.ok(reconnected.attached.generation > session.generation);
  reconnected.socket.terminate();
  const launches = new Launches(base.config, base.inventory, base.bridges, async () => {
    assert.fail('Unconfigured directories must not launch a runtime');
  });
  await assert.rejects(launches.start(session.projectId, session.id, true), /Project not found/);
});

test('unconfigured sessions retain absolute-file, header-identity and duplicate-connection guards', async (t) => {
  const base = await unconfigured(t);
  async function rejected(identity) {
    const socket = new WebSocket(base.url);
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send(JSON.stringify({ type: 'attach', session: identity, snapshot: base.snapshot }));
    assert.equal((await closed)[0], 1008);
  }
  await rejected({ ...base.identity, file: 'relative.jsonl' });
  await rejected({ ...base.identity, id: 'wrong-header-id' });
  const { socket, attached } = await base.open();
  await rejected(base.identity);
  assert.equal(base.bridges.get(attached.sessionId).connection, 'connected');
  socket.terminate();
});

test('unconfigured new sessions can attach before the transcript is persisted', async (t) => {
  const base = await unconfigured(t);
  base.identity.file = join(base.root, 'not-yet-written.jsonl');
  const { socket, attached } = await base.open();
  assert.equal(base.bridges.get(attached.sessionId).file, base.identity.file);
  socket.terminate();
});
