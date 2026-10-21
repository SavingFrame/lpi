import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bridgeCommand } from '../dist/shared/commands.js';
import { fakePi, nativePi, setup, waitFor } from './bridge-fixture.mjs';

test('browser tree navigation waits for native completion and synchronizes its in-memory leaf', async (t) => {
  const { defer, file, header, entry, url, inventory, bridges } = await setup(t);
  const original = readFileSync(file);
  const fake = nativePi({ defer, file, header, entry, url });
  let leaf = entry.id;
  let finish;
  fake.ctx.sessionManager.getLeafId = () => leaf;
  fake.ctx.sessionManager.getBranch = () => (leaf === null ? [] : [entry]);
  fake.ctx.navigateTree = async (target, options) => {
    assert.equal(target, entry.id);
    assert.deepEqual(options, { summarize: false });
    await new Promise((resolve) => {
      finish = resolve;
    });
    leaf = null;
    await fake.emit('session_tree');
    return { cancelled: false };
  };
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  let acknowledged = false;
  const pending = bridges
    .command(session.id, session.generation, {
      type: 'navigate_tree',
      targetId: entry.id,
      expectedLeafId: entry.id,
    })
    .then(() => {
      acknowledged = true;
    });
  await waitFor(() => finish !== undefined);
  assert.equal(acknowledged, false);
  finish();
  await pending;
  assert.equal(bridges.snapshot(session.id).state.leafId, null);
  assert.deepEqual(bridges.snapshot(session.id).view.messages, []);
  assert.equal(inventory.tree(session.id).activeLeafId, null);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual(readFileSync(file), original);
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'navigate_tree',
      targetId: entry.id,
      expectedLeafId: entry.id,
    }),
    /branch changed/,
  );
  fake.ctx.navigateTree = async () => ({ cancelled: true });
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'navigate_tree',
      targetId: entry.id,
      expectedLeafId: null,
    }),
    /cancelled/,
  );
  assert.equal(bridges.get(session.id).connection, 'connected');
});

test('model and thinking settings update native Pi and synchronize authoritative controls', async (t) => {
  const { defer, file, header, entry, url, bridges } = await setup(t);
  const fake = nativePi({ defer, file, header, entry, url });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const modelCommand = { type: 'set_model', provider: 'fake', modelId: 'second' };
  const thinkingCommand = { type: 'set_thinking_level', level: 'xhigh' };
  assert.equal(bridges.snapshot(session.id).controls.availableModels.length, 2);
  assert.deepEqual(bridges.snapshot(session.id).controls.scopedModels, [
    { provider: 'fake', id: 'second', name: 'Second' },
  ]);
  assert.deepEqual(bridges.snapshot(session.id).controls.availableThinkingLevels, ['off']);
  await bridges.command(session.id, session.generation, modelCommand);
  assert.equal(fake.ctx.model.id, 'second');
  assert.equal(bridges.snapshot(session.id).controls.model.id, 'second');
  assert.deepEqual(bridges.snapshot(session.id).controls.availableThinkingLevels, [
    'off',
    'low',
    'medium',
    'high',
    'max',
  ]);
  await bridges.command(session.id, session.generation, thinkingCommand);
  assert.equal(bridges.snapshot(session.id).controls.thinkingLevel, 'max');
  await bridges.command(session.id, session.generation, {
    type: 'set_thinking_level',
    level: 'max',
  });
  assert.equal(bridges.snapshot(session.id).controls.thinkingLevel, 'max');
  await assert.rejects(bridges.command(session.id, session.generation - 1, modelCommand), /stale/);
  await assert.rejects(
    bridges.command(session.id, session.generation, { ...modelCommand, modelId: 'missing' }),
    /unavailable/,
  );
  fake.state.authenticated = false;
  await assert.rejects(
    bridges.command(session.id, session.generation, modelCommand),
    /authentication/,
  );
  fake.state.authenticated = true;
  for (const command of [modelCommand, thinkingCommand]) {
    fake.state.idle = false;
    await assert.rejects(bridges.command(session.id, session.generation, command), /idle/);
    fake.state.idle = true;
    fake.state.pending = true;
    await assert.rejects(bridges.command(session.id, session.generation, command), /queued/);
    fake.state.pending = false;
    await fake.emit('ui_prompt_start', { kind: 'confirm' });
    await assert.rejects(bridges.command(session.id, session.generation, command), /dialogs/);
    await fake.emit('ui_prompt_end');
  }
  await fake.commands.get('pim-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  await assert.rejects(
    bridges.command(session.id, session.generation, modelCommand),
    /unavailable/,
  );
});

test('stop runtime is rejected for externally launched Pi', async (t) => {
  const { open, bridges } = await setup(t);
  const { socket, attached } = await open();
  await assert.rejects(
    bridges.command(attached.sessionId, attached.generation, { type: 'stop_runtime' }),
    /Only Pim-managed/,
  );
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  socket.terminate();
});

for (const busy of [false, true]) {
  test(`stop runtime requests graceful shutdown without changing history (busy: ${busy})`, async (t) => {
    const { config, root, defer, file, header, entry, url, bridges } = await setup(t);
    const original = readFileSync(file);
    const keys = ['PIM_BRIDGE_URL', 'PIM_LAUNCH_ID', 'PIM_TMUX_SESSION', 'PATH'];
    const previous = keys.map((key) => process.env[key]);
    const launchId = '11111111-1111-1111-1111-111111111111';
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // Stub reservations only. Never contact a real tmux server in this test.
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.PIM_BRIDGE_URL = url;
    process.env.PIM_LAUNCH_ID = launchId;
    process.env.PIM_TMUX_SESSION = `pim-${launchId}`;
    const fake = fakePi(header, file, entry);
    defer(async () => {
      await fake.emit('session_shutdown');
      for (const [index, key] of keys.entries()) {
        if (previous[index] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[index];
        }
      }
    });
    fake.state.idle = !busy;
    fake.state.pending = busy;
    await fake.emit('session_start');
    await waitFor(() => bridges.list()[0]?.connection === 'connected');
    const session = bridges.list()[0];
    assert.equal(bridges.snapshot(session.id).state.managedRuntime, true);
    await assert.rejects(
      bridges.command(session.id, session.generation - 1, { type: 'stop_runtime' }),
      /stale/,
    );
    assert.equal(fake.state.shutdowns, 0);
    const response = await fetch(
      `http://127.0.0.1:${config.port}/sessions/${session.id}/commands`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'stop-runtime',
          generation: session.generation,
          command: { type: 'stop_runtime' },
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outcome, 'acknowledged');
    await waitFor(() => bridges.get(session.id).connection === 'disconnected');
    assert.equal(fake.state.aborts, 1);
    assert.equal(fake.state.shutdowns, 1);
    assert.deepEqual(readFileSync(file), original);
    await assert.rejects(
      bridges.command(session.id, session.generation, { type: 'stop_runtime' }),
      /unavailable|stale/,
    );
    assert.equal(fake.state.shutdowns, 1);
  });
}

test('native command policy rejects slash commands, unsupported mutations and invalid settings', () => {
  for (const command of [
    { type: 'prompt', message: '/new' },
    { type: 'steer', message: '/compact' },
    { type: 'clear_queue' },
    { type: 'set_model', provider: '', modelId: 'fake' },
    { type: 'set_thinking_level', level: 'invalid' },
  ]) {
    assert.throws(() => bridgeCommand(command));
  }
});
