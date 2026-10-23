import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WebSocket } from 'ws';
import { BRIDGE_LIMIT } from '../dist/src/shared/commands.js';
import { nativePi, setup, waitFor } from './bridge-fixture.mjs';

test('native extension streams history, partial responses, tools and routes commands into the same runtime', async (t) => {
  const { config, defer, file, header, entry, url, inventory, bridges, events } = await setup(t);
  const original = readFileSync(file);
  const fake = nativePi({ defer, file, header, entry, url });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  const generation = session.generation;
  assert.equal(inventory.list().filter((item) => item.file === file).length, 1);
  const initial = await inventory.snapshot(session.id);
  assert.equal(initial.state.nativeTui, true);
  assert.equal(initial.view.messages[0].content, 'Original native history');
  assert.equal(initial.session.connection, 'connected');
  assert.equal(initial.epoch, events.epoch);
  fake.ctx.sessionManager.getSessionName = () => 'Fix mobile reconnect';
  await fake.emit('session_info_changed', { name: 'Fix mobile reconnect' });
  await waitFor(() => bridges.snapshot(session.id).state.sessionName === 'Fix mobile reconnect');
  assert.equal(bridges.list()[0].title, 'Fix mobile reconnect');
  const response = await fetch(`http://127.0.0.1:${config.port}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'browser-prompt',
      generation,
      command: { type: 'prompt', message: 'Browser prompt' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.disposition, 'dispatched');
  assert.equal(fake.sent[0].message, 'Browser prompt');
  assert.equal(fake.sent[0].expandPromptTemplates, false);
  const duplicate = await fetch(`http://127.0.0.1:${config.port}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'browser-prompt',
      generation,
      command: { type: 'prompt', message: 'Browser prompt' },
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(fake.sent.length, 1);
  fake.state.idle = false;
  await fake.emit('agent_start');
  await fake.emit('message_start', { message: { role: 'assistant', timestamp: 2, content: [] } });
  await fake.emit('message_update', {
    message: { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'Streaming' }] },
  });
  await waitFor(() => bridges.snapshot(session.id).view.partial?.content[0]?.text === 'Streaming');
  await fake.emit('tool_execution_start', {
    toolCallId: 'tool',
    toolName: 'read',
    args: { path: 'example' },
  });
  await waitFor(() => bridges.snapshot(session.id).view.tools.length === 1);
  assert.equal((await inventory.snapshot(session.id)).view.running, true);
  await bridges.command(session.id, generation, { type: 'steer', message: 'Focus' });
  await bridges.command(session.id, generation, { type: 'follow_up', message: 'Next task' });
  assert.equal(fake.sent[1].deliverAs, 'steer');
  assert.equal(fake.sent[2].deliverAs, 'followUp');
  await assert.rejects(
    bridges.command(session.id, generation, { type: 'prompt', message: 'Busy' }),
    /busy/,
  );
  await bridges.command(session.id, generation, { type: 'abort' });
  assert.equal(fake.state.aborts, 1);
  await fake.emit('ui_prompt_start', { kind: 'confirm' });
  await waitFor(() => bridges.snapshot(session.id).view.notice?.includes('terminal'));
  await fake.emit('ui_prompt_end', { kind: 'confirm' });
  await waitFor(() => bridges.snapshot(session.id).view.notice === null);
  fake.state.idle = true;
  await fake.emit('agent_settled');
  await waitFor(() => !bridges.snapshot(session.id).view.running);
  assert.deepEqual(readFileSync(file), original);
  assert.equal(fake.appended.length, 0);
  await fake.commands.get('lpi-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  const offline = await inventory.snapshot(session.id);
  assert.equal(offline.state.bridgeConnected, false);
  assert.match(offline.view.notice, /may still be running/);
  await assert.rejects(
    bridges.command(session.id, generation, { type: 'prompt', message: 'Offline' }),
  );
});

test('large native history attaches, grows, syncs and reconnects without a cumulative limit', async (t) => {
  const { defer, file, header, entry, url, bridges } = await setup(t);
  entry.message.content = 'x'.repeat(BRIDGE_LIMIT + 1024);
  const fake = nativePi({ defer, file, header, entry, url });
  await fake.emit('session_start');
  await waitFor(() => bridges.list()[0]?.connection === 'connected');
  const session = bridges.list()[0];
  assert.equal(bridges.snapshot(session.id).view.messages[0].content, entry.message.content);
  const message = { role: 'assistant', timestamp: 2, content: 'History keeps growing' };
  fake.state.entries.push({ ...entry, id: 'second', parentId: entry.id, message });
  await fake.emit('message_end', { message });
  await waitFor(() => bridges.snapshot(session.id).view.messages.length === 2);
  const browser = new WebSocket(url.replace('/bridge', '/events'));
  const browserFrames = [];
  browser.on('message', (data) => browserFrames.push(JSON.parse(String(data))));
  defer(() => browser.terminate());
  await once(browser, 'open');
  await waitFor(() => browserFrames.some((frame) => frame.type === 'connected'));
  const partialResult = { content: 'large result'.repeat(BRIDGE_LIMIT / 8) };
  await fake.emit('tool_execution_update', {
    toolCallId: 'large-tool',
    toolName: 'read',
    args: {},
    partialResult,
  });
  await waitFor(() => bridges.snapshot(session.id).view.tools.length === 1);
  assert.deepEqual(bridges.snapshot(session.id).view.tools[0].result, partialResult);
  await waitFor(() => browserFrames.some((frame) => frame.type === 'bridge-sync'));
  assert.equal(browser.readyState, WebSocket.OPEN);
  assert.equal(browserFrames.find((frame) => frame.type === 'bridge-sync').data, null);
  await fake.emit('session_tree');
  await bridges.command(session.id, session.generation, { type: 'abort' });
  assert.equal(bridges.snapshot(session.id).view.messages.length, 2);
  await fake.commands.get('lpi-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  await fake.commands.get('lpi-connect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'connected');
  assert.ok(bridges.get(session.id).generation > session.generation);
  assert.equal(bridges.snapshot(session.id).view.messages[0].content, entry.message.content);
  assert.equal(bridges.snapshot(session.id).view.messages.length, 2);
  assert.deepEqual(bridges.snapshot(session.id).view.tools[0].result, partialResult);
});

test('more than 512 active tools survive events and explicit snapshots', async (t) => {
  const { open, bridges, snapshot } = await setup(t);
  const { socket, attached } = await open();
  for (let index = 0; index < 513; index++) {
    socket.send(
      JSON.stringify({
        type: 'event',
        event: {
          type: 'tool_execution_start',
          toolCallId: `tool-${index}`,
          toolName: 'read',
          args: {},
        },
      }),
    );
  }
  await waitFor(() => bridges.snapshot(attached.sessionId).view.tools.length === 513);
  snapshot.view.tools = bridges.snapshot(attached.sessionId).view.tools;
  snapshot.view.notice = 'Synced';
  socket.send(JSON.stringify({ type: 'sync', snapshot }));
  await waitFor(() => bridges.snapshot(attached.sessionId).view.notice === 'Synced');
  assert.equal(bridges.snapshot(attached.sessionId).view.tools.length, 513);
  assert.equal(bridges.get(attached.sessionId).connection, 'connected');
  socket.terminate();
});
