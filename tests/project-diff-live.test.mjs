import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { WebSocket } from 'ws';
import { registerProjectRoutes } from '../dist/src/api/projects.js';
import { validateRequest } from '../dist/src/api/security.js';
import { ProjectDiffWatch } from '../dist/src/project-diff-watch.js';
import { fixture } from './helpers.mjs';

async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) {
      return;
    }
    await setTimeout(25);
  }
  throw new Error('Diff update timed out');
}

test('relay shares and caches bounded project reads, deduplicates updates and releases its last subscriber', async (t) => {
  const { config } = fixture(t);
  let patch = 'first';
  let calls = 0;
  let active = 0;
  let peak = 0;
  const watch = new ProjectDiffWatch(
    config,
    async () => {
      calls++;
      peak = Math.max(peak, ++active);
      await setTimeout(5);
      active--;
      return { patch, truncated: false };
    },
    20,
  );
  t.after(() => watch.close());
  let first = 0;
  let second = 0;
  const releaseFirst = watch.subscribe('test', () => first++);
  const releaseSecond = watch.subscribe('test', () => second++);
  const initial = await watch.get('test', new AbortController().signal);
  assert.equal(initial.patch, 'first');
  assert.equal(first, 1);
  assert.equal(second, 1);
  await setTimeout(60);
  assert.equal(first, 1, 'unchanged data emits nothing');
  assert.equal(await watch.get('test', new AbortController().signal), initial);
  patch = 'external edit';
  await until(() => first === 2 && second === 2);
  assert.equal((await watch.get('test', new AbortController().signal)).patch, patch);
  assert.equal(peak, 1);
  releaseFirst();
  patch = 'still subscribed';
  await until(() => second === 3);
  assert.equal(first, 2);
  releaseSecond();
  await setTimeout(20);
  const stopped = calls;
  await setTimeout(60);
  assert.equal(calls, stopped);
  assert.throws(() => watch.subscribe('unknown', () => {}), /Project not found/);
});

test('read-only diff websocket detects external Git edits and enforces project, origin and message boundaries', async (t) => {
  const base = fixture(t);
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'];
  const previous = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    HOME: base.home,
    XDG_CONFIG_HOME: join(base.home, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  });
  t.after(() =>
    keys.forEach((key, index) => {
      if (previous[index] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[index];
      }
    }),
  );
  const directory = base.config.projects[0].directory;
  execFileSync('git', ['-C', directory, 'init', '--quiet']);
  writeFileSync(join(directory, 'file.txt'), 'first\n');
  const app = Fastify();
  await app.register(websocket);
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error.status ?? 500).send({ error: error.message }),
  );
  app.addHook('onRequest', async (request) => validateRequest(request.raw, base.config));
  registerProjectRoutes(app, base.config);
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  base.config.port = app.server.address().port;
  const origin = `http://127.0.0.1:${base.config.port}`;
  const connect = (path, source = 'http://localhost:5173') => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + path, { origin: source });
    socket.on('error', () => {});
    return socket;
  };
  for (const [path, source] of [
    ['/projects/unknown/diff/events', undefined],
    ['/projects/test/diff/events?unexpected=1', undefined],
    ['/projects/test/diff/events', 'http://evil.example'],
  ]) {
    const socket = connect(path, source);
    t.after(() => socket.terminate());
    await assert.rejects(once(socket, 'open'));
  }
  const socket = connect('/projects/test/diff/events');
  t.after(() => socket.terminate());
  const messages = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  await until(
    () =>
      messages.some((message) => message.type === 'diff-ready') &&
      messages.some((message) => message.type === 'diff-changed'),
  );
  const read = async () => (await fetch(`${origin}/projects/test/diff`)).json();
  assert.match((await read()).patch, /\+first/);
  const count = messages.length;
  writeFileSync(join(directory, 'file.txt'), 'external update\n');
  await until(() => messages.length > count);
  assert.match((await read()).patch, /\+external update/);
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ command: 'launch' }));
  assert.equal((await closed)[0], 1008);
});
