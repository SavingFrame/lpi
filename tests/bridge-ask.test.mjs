import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ASK_ANSWER,
  ASK_ANSWER_RESULT,
  ASK_BLOCKED,
  ASK_PROMPT,
} from '../dist/extension-support/ask-user-question/contract.js';
import {
  answer as askAnswer,
  prompt as askPrompt,
} from '../src/extension-support/ask-user-question/tests/fixtures.mjs';
import { nativePi, setup, waitFor } from './bridge-fixture.mjs';

async function setupAsk(t, timeout = 1000) {
  const base = await setup(t, timeout);
  const fake = nativePi(base);
  await fake.emit('session_start');
  await waitFor(() => base.bridges.list()[0]?.connection === 'connected');
  return { ...base, fake, session: base.bridges.list()[0] };
}

test('Ask support publishes questions and previews and waits for the actual answer verdict', async (t) => {
  const { config, fake, session, bridges, events, file, defer } = await setupAsk(t);
  const original = readFileSync(file);
  const received = [];
  defer(events.subscribe((event) => received.push(event)));
  const prompt = askPrompt();
  await fake.emit('tool_execution_start', {
    toolName: 'ask_user_question',
    toolCallId: prompt.toolCallId,
    args: {
      questions: prompt.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option, preview: 'schema\n  table' })),
      })),
    },
  });
  fake.bus.emit(ASK_PROMPT, prompt);
  fake.bus.emit(ASK_BLOCKED, { active: true, toolCallId: prompt.toolCallId });
  await fake.emit('ui_prompt_start', { kind: 'custom' });
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 1,
  );
  const pending = bridges.snapshot(session.id).view.extensions['ask-user-question'][0];
  assert.equal(pending.questions[0].options[0].preview, 'schema\n  table');
  assert.equal(pending.questions[0].options[1].preview, undefined);
  assert.match(bridges.snapshot(session.id).view.notice, /supported questions/);
  assert.equal(bridges.list()[0].activity, 'blocked');
  assert.ok(
    received.some((event) => event.type === 'pi-event' && event.data.type === 'extension_support'),
  );

  const inbound = [];
  fake.bus.on(ASK_ANSWER, (payload) => inbound.push(payload));
  let completed = false;
  const response = fetch(`http://127.0.0.1:${config.port}/sessions/${session.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'browser-ask-answer',
      generation: session.generation,
      command: {
        type: 'extension',
        extension: 'ask-user-question',
        action: { ...askAnswer(), requestId: 'untrusted-client-correlation' },
      },
    }),
  }).then((result) => {
    completed = true;
    return result;
  });
  await waitFor(() => inbound.length === 1);
  assert.equal(completed, false);
  assert.notEqual(inbound[0].requestId, 'untrusted-client-correlation');
  assert.deepEqual(inbound[0].answers, askAnswer().answers);
  fake.bus.emit(ASK_ANSWER_RESULT, { ...inbound[0], ok: true });
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal((await result.json()).outcome, 'acknowledged');
  await fake.emit('ui_prompt_end');
  fake.bus.emit(ASK_BLOCKED, { active: false, toolCallId: prompt.toolCallId });
  await waitFor(() => Object.keys(bridges.snapshot(session.id).view.extensions).length === 0);
  await waitFor(() => bridges.snapshot(session.id).view.notice === null);
  assert.equal(fake.sent.length, 0);
  assert.equal(fake.appended.length, 0);
  assert.deepEqual(readFileSync(file), original);
});

test('Ask invalid answers, upstream rejection and terminal races are rejected without disconnecting Pi', async (t) => {
  const { fake, session, bridges } = await setupAsk(t);
  fake.bus.emit(ASK_PROMPT, askPrompt());
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 1,
  );
  const inbound = [];
  fake.bus.on(ASK_ANSWER, (payload) => inbound.push(payload));
  const command = { type: 'extension', extension: 'ask-user-question', action: askAnswer() };
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      ...command,
      action: { toolCallId: 'ask-1', answers: [askAnswer().answers[0]] },
    }),
    /every/,
  );
  assert.equal(inbound.length, 0);
  const rejected = bridges.command(session.id, session.generation, command);
  await waitFor(() => inbound.length === 1);
  fake.bus.emit(ASK_ANSWER_RESULT, { ...inbound[0], ok: false, code: 'invalid_answer' });
  await assert.rejects(rejected, /invalid_answer/);
  assert.equal(bridges.get(session.id).connection, 'connected');
  assert.equal(bridges.snapshot(session.id).view.extensions['ask-user-question'].length, 1);

  fake.bus.emit(ASK_BLOCKED, { active: false, toolCallId: 'ask-1' });
  await waitFor(() => !bridges.snapshot(session.id).view.extensions['ask-user-question']);
  await assert.rejects(bridges.command(session.id, session.generation, command), /no longer open/);
  assert.equal(inbound.length, 1);
  assert.equal(bridges.get(session.id).connection, 'connected');
});

test('Ask pending state survives bridge disconnects and captures offline opens and terminal closures', async (t) => {
  const { fake, session, bridges } = await setupAsk(t);
  fake.bus.emit(ASK_PROMPT, askPrompt('first'));
  fake.bus.emit(ASK_PROMPT, askPrompt('second'));
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 2,
  );
  await fake.commands.get('pim-disconnect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  assert.deepEqual(bridges.snapshot(session.id).view.extensions, {});
  fake.bus.emit(ASK_BLOCKED, { active: false, toolCallId: 'first' });
  fake.bus.emit(ASK_PROMPT, askPrompt('offline'));
  await fake.commands.get('pim-connect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'connected');
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 2,
  );
  assert.deepEqual(
    bridges
      .snapshot(session.id)
      .view.extensions['ask-user-question'].map((item) => item.toolCallId),
    ['second', 'offline'],
  );
  assert.ok(bridges.get(session.id).generation > session.generation);
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'extension',
      extension: 'ask-user-question',
      action: { toolCallId: 'second', cancel: true },
    }),
    /stale/,
  );
  const inbound = [];
  fake.bus.on(ASK_ANSWER, (payload) => {
    inbound.push(payload);
    fake.bus.emit(ASK_ANSWER_RESULT, { ...payload, ok: true });
  });
  await bridges.command(session.id, bridges.get(session.id).generation, {
    type: 'extension',
    extension: 'ask-user-question',
    action: { toolCallId: 'second', cancel: true },
  });
  assert.equal(inbound[0].cancel, true);
  assert.deepEqual(
    bridges
      .snapshot(session.id)
      .view.extensions['ask-user-question'].map((item) => item.toolCallId),
    ['offline'],
  );
});

test('Ask session replacement drops old pending questions instead of reopening unfinished tools', async (t) => {
  const { fake, session, bridges } = await setupAsk(t);
  fake.bus.emit(ASK_PROMPT, askPrompt());
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 1,
  );
  await fake.emit('session_shutdown');
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  await fake.emit('session_start');
  await waitFor(() => bridges.get(session.id).connection === 'connected');
  assert.deepEqual(bridges.snapshot(session.id).view.extensions, {});
  await assert.rejects(
    bridges.command(session.id, bridges.get(session.id).generation, {
      type: 'extension',
      extension: 'ask-user-question',
      action: askAnswer(),
    }),
    /no longer open/,
  );
});

test('Ask unknown delivery is never replayed and late verdicts do not acknowledge a new connection', async (t) => {
  const { fake, session, bridges } = await setupAsk(t, 50);
  fake.bus.emit(ASK_PROMPT, askPrompt());
  await waitFor(
    () => bridges.snapshot(session.id).view.extensions['ask-user-question']?.length === 1,
  );
  const inbound = [];
  fake.bus.on(ASK_ANSWER, (payload) => inbound.push(payload));
  await assert.rejects(
    bridges.command(session.id, session.generation, {
      type: 'extension',
      extension: 'ask-user-question',
      action: askAnswer(),
    }),
    (error) => error.outcome === 'unknown',
  );
  await waitFor(() => bridges.get(session.id).connection === 'disconnected');
  assert.equal(inbound.length, 1);
  await fake.commands.get('pim-connect')('', fake.ctx);
  await waitFor(() => bridges.get(session.id).connection === 'connected');
  const reconnected = bridges.get(session.id).generation;
  fake.bus.emit(ASK_ANSWER_RESULT, { ...inbound[0], ok: true });
  await waitFor(() => !bridges.snapshot(session.id).view.extensions['ask-user-question']);
  await delay(30);
  assert.equal(bridges.get(session.id).connection, 'connected');
  assert.equal(bridges.get(session.id).generation, reconnected);
  assert.equal(inbound.length, 1);
});
