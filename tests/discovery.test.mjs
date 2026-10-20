import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createApi } from '../dist/api/http.js';
import { NativeBridges } from '../dist/bridge/server.js';
import { loadConfig } from '../dist/config.js';
import { Events } from '../dist/events.js';
import { Sessions } from '../dist/sessions.js';
import { SessionDiscovery } from '../dist/storage/discovery.js';
import { fixture } from './helpers.mjs';

const piId = '3b3bc786-0ff4-4ae9-a50e-bda91a3b3dd7';

function seed(file, cwd, id = piId) {
  mkdirSync(join(file, '..'), { recursive: true });
  const header = { type: 'session', version: 3, id, cwd, timestamp: '2026-01-01T00:00:00Z' };
  const message = {
    type: 'message',
    id: 'first',
    parentId: null,
    timestamp: header.timestamp,
    message: { role: 'user', content: 'Existing history', timestamp: 1 },
  };
  const name = {
    type: 'session_info',
    id: 'name',
    parentId: 'first',
    timestamp: header.timestamp,
    name: 'Native conversation',
  };
  writeFileSync(
    file,
    `${[header, message, name].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  );
}

test('discovery uses canonical header cwd, stable path IDs, and never changes original files', (t) => {
  const { root, config } = fixture(t);
  const sessions = join(root, 'pi-sessions');
  const file = join(sessions, 'encoded-cwd', 'one.jsonl');
  const copy = join(sessions, 'encoded-cwd', 'copy.jsonl');
  const alias = join(root, 'project-alias');
  symlinkSync(config.projects[0].directory, alias);
  seed(file, alias);
  seed(copy, config.projects[0].directory);
  seed(join(sessions, 'unrelated.jsonl'), root);
  seed(join(sessions, 'custom.jsonl'), config.projects[0].directory, 'custom-session-id');
  const before = readFileSync(file);
  const first = new SessionDiscovery([sessions, sessions], config.projects);
  assert.equal(first.list().length, 3);
  assert.equal(first.warnings.length, 0);
  const session = first.list().find((item) => item.file === file);
  assert.equal(session.piSessionId, piId);
  assert.equal(session.directory, config.projects[0].directory);
  assert.equal(session.connection, 'disconnected');
  assert.equal(session.title, 'Native conversation');
  assert.ok(Number.isFinite(Date.parse(session.updatedAt)));
  assert.notEqual(session.id, first.list().find((item) => item.file === copy).id);
  assert.deepEqual(new SessionDiscovery([sessions], config.projects).list(), first.list());
  assert.equal(first.inspect(session.id).messages[0].content, 'Existing history');
  assert.equal(first.inspect(session.id).name, 'Native conversation');
  assert.deepEqual(readFileSync(file), before);
});

test('inventory falls back to the first user text and reads names near the file end', (t) => {
  const { root, config } = fixture(t);
  const sessions = join(root, 'pi-sessions');
  const file = join(sessions, 'one.jsonl');
  seed(file, config.projects[0].directory);
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  const message = JSON.parse(lines[1]);
  message.message.content = [{ type: 'text', text: '  Fix\n the sidebar  ' }];
  writeFileSync(file, `${lines[0]}\n${JSON.stringify(message)}\n`);
  assert.equal(
    new SessionDiscovery([sessions], config.projects).list()[0].title,
    'Fix the sidebar',
  );
  writeFileSync(
    file,
    `${readFileSync(file, 'utf8')}${JSON.stringify({ type: 'custom', data: 'x'.repeat(100_000) })}\n${lines[2]}\n`,
  );
  assert.equal(
    new SessionDiscovery([sessions], config.projects).list()[0].title,
    'Native conversation',
  );
});

test('discovery ignores nested files and symlinks and warns on invalid headers', (t) => {
  const { root, config } = fixture(t);
  const sessions = join(root, 'pi-sessions');
  const file = join(sessions, 'group', 'one.jsonl');
  seed(file, config.projects[0].directory);
  seed(join(sessions, 'group', 'nested', 'deep.jsonl'), config.projects[0].directory);
  symlinkSync(file, join(sessions, 'alias.jsonl'));
  symlinkSync(join(sessions, 'group'), join(sessions, 'folder-alias'));
  writeFileSync(join(sessions, 'invalid.jsonl'), '{}\n');
  writeFileSync(join(sessions, 'partial.jsonl'), '{"type":"session"');
  const discovery = new SessionDiscovery([sessions], config.projects);
  assert.equal(discovery.list().length, 1);
  assert.equal(discovery.list()[0].file, file);
  assert.equal(discovery.warnings.length, 2);
  assert.deepEqual(new SessionDiscovery([join(root, 'missing')], config.projects).list(), []);
});

test('read-only inspection sees persisted changes but rejects partial records and replaced identities', (t) => {
  const { root, config } = fixture(t);
  const sessions = join(root, 'pi-sessions');
  const file = join(sessions, 'one.jsonl');
  seed(file, config.projects[0].directory);
  const discovery = new SessionDiscovery([sessions], config.projects);
  const session = discovery.list()[0];
  const initial = readFileSync(file, 'utf8');
  writeFileSync(file, `${initial}{"type":`);
  assert.throws(
    () => discovery.inspect(session.id),
    (error) => error.status === 409,
  );
  writeFileSync(file, initial.replace('Existing history', 'Updated history'));
  assert.equal(discovery.inspect(session.id).messages[0].content, 'Updated history');
  seed(file, config.projects[0].directory, 'replaced-session');
  assert.throws(() => discovery.inspect(session.id), /identity changed/);
  renameSync(file, `${file}.removed`);
  assert.throws(() => discovery.inspect(session.id));
});

test('saved sessions are visible through HTTP but cannot be executed by the relay', async (t) => {
  const { root, config, defer } = fixture(t);
  const sessions = join(root, 'pi-sessions');
  const file = join(sessions, 'one.jsonl');
  seed(file, config.projects[0].directory);
  const original = readFileSync(file);
  const discovery = new SessionDiscovery([sessions], config.projects);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  defer(() => bridges.close());
  const inventory = new Sessions(discovery, bridges, events);
  const session = discovery.list()[0];
  const api = createApi(config, inventory, bridges);
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  defer(() => new Promise((resolve) => api.close(resolve)));
  config.port = api.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await get('/sessions')).sessions[0].id, session.id);
  assert.equal((await get(`/sessions/${session.id}`)).piSessionId, piId);
  const snapshot = await get(`/sessions/${session.id}/snapshot`);
  assert.equal(snapshot.session.connection, 'disconnected');
  assert.equal(snapshot.state.readOnly, true);
  assert.equal(snapshot.view.messages[0].content, 'Existing history');
  assert.match(snapshot.view.notice, /Read-only/);
  for (const path of [
    '/sessions',
    `/sessions/${session.id}/start`,
    `/sessions/${session.id}/stop`,
  ]) {
    assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 404);
  }
  await assert.rejects(bridges.command(session.id, 0, { type: 'prompt', message: 'unsafe' }));
  assert.deepEqual(readFileSync(file), original);
});

test('session roots default to isolated HOME, support explicit empty/custom roots and reject invalid paths', (t) => {
  const { root, config } = fixture(t);
  const home = join(root, 'home');
  const path = join(root, 'config.json');
  const load = (extra) => {
    writeFileSync(path, JSON.stringify({ ...config, projects: undefined, ...extra }));
    return loadConfig(path, home);
  };
  assert.deepEqual(load({ piSessionRoots: undefined }).piSessionRoots, [
    join(home, '.pi/agent/sessions'),
  ]);
  assert.deepEqual(load({ piSessionRoots: [] }).piSessionRoots, []);
  assert.deepEqual(load({ piSessionRoots: ['~/custom', '~/custom'] }).piSessionRoots, [
    join(home, 'custom'),
  ]);
  assert.throws(() => load({ piSessionRoots: 'invalid' }), /must be an array/);
  assert.throws(() => load({ piSessionRoots: ['relative'] }), /absolute/);
});
