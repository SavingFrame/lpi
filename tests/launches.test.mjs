import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NativeBridges } from '../dist/src/bridge/server.js';
import { Events } from '../dist/src/events.js';
import { Launches } from '../dist/src/launches.js';
import { Sessions } from '../dist/src/sessions.js';
import { SessionDiscovery } from '../dist/src/storage/discovery.js';
import { SessionReadStore } from '../dist/src/storage/read-state.js';
import { fixture } from './helpers.mjs';

const id = '11111111-1111-1111-1111-111111111111';

function setup(t, options = {}) {
  const { config } = fixture(t);
  const saved = {
    id,
    projectId: 'test',
    directory: config.projects[0].directory,
    file: `${config.projects[0].directory}/saved ' file.jsonl`,
    piSessionId: 'saved-id',
    connection: 'disconnected',
  };
  const calls = [];
  let started = false;
  let validated = false;
  const sessions = {
    get: () => ({ ...saved, connection: options.connected ? 'connected' : 'disconnected' }),
    validateResume: () => {
      validated = true;
    },
  };
  const bridges = {
    findLaunch: (launchId) => {
      if (!started || options.noAttach) {
        return undefined;
      }
      const command = calls.find((args) => args[0] === 'new-session');
      return {
        ...saved,
        piSessionId:
          options.wrongIdentity || command.includes('--session') ? saved.piSessionId : launchId,
        connection: 'connected',
      };
    },
  };
  const run = async (args) => {
    calls.push(args);
    if (options.inspectError && args[0] === 'list-sessions') {
      throw new Error('Permission denied');
    }
    if (args[0] === 'new-session') {
      started = true;
      if (options.spawnError) {
        throw new Error('Lost result');
      }
      return '';
    }
    if (args[0] === 'show-options') {
      assert.deepEqual(args, ['show-options', '-t', '=lpi-existing:']);
      return options.unbound ? '' : `@lpi_file_${id} 1\n`;
    }
    if (started) {
      return options.exited ? '' : calls.find((call) => call[0] === 'new-session')[3];
    }
    return options.existing ? 'lpi-existing\n' : '';
  };
  const launches = new Launches(config, sessions, bridges, run, options.noAttach ? 5 : 1000);
  return { launches, calls, saved, validated: () => validated };
}

test('new session launches global Pi without npm-local binaries and with correlated environment', async (t) => {
  const originalPath = process.env.PATH;
  t.after(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });
  process.env.PATH = '/tmp/lpi/node_modules/.bin:/tmp/node_modules/.bin/:/usr/local/bin:/usr/bin';
  const { launches, calls } = setup(t);
  assert.equal((await launches.start('test')).connection, 'connected');
  const command = calls.find((args) => args[0] === 'new-session');
  const name = command[3];
  assert.match(name, /^lpi-[a-f0-9-]{36}$/);
  assert.ok(command.includes(`LPI_LAUNCH_ID=${name.slice(4)}`));
  assert.ok(command.includes(`LPI_TMUX_SESSION=${name}`));
  assert.ok(command.includes('LPI_BRIDGE_URL=ws://127.0.0.1:3141/bridge'));
  assert.ok(command.includes('--session-id'));
  assert.ok(command.includes('PATH=/usr/local/bin:/usr/bin'));
  assert.deepEqual(command.slice(-3), ['pi', '--session-id', name.slice(4)]);
  assert.ok(!command.includes('--extension'));
  assert.ok(!command.some((arg) => arg.endsWith('/dist/extensions/lpi/index.js')));
  assert.ok(!command.includes('--mode'));
});

test('resume validates history and passes the exact file as one argument', async (t) => {
  const { launches, calls, saved, validated } = setup(t);
  await launches.start('test', id, true);
  assert.equal(validated(), true);
  const command = calls.find((args) => args[0] === 'new-session');
  assert.equal(command[command.indexOf('--session') + 1], saved.file);
  assert.ok(!command.includes('--session-id'));
});

test('live sessions return existing runtime without launching', async (t) => {
  const { launches, calls } = setup(t, { connected: true });
  assert.equal((await launches.start('test', id)).connection, 'connected');
  assert.deepEqual(calls, []);
});

for (const [name, options, pattern] of [
  ['reserved file after relay restart', { existing: true }, /still be running/],
  ['unregistered runtime', { existing: true, unbound: true }, /not registered/],
  ['unconfirmed external writer', {}, /Confirm/],
  ['failed tmux inspection', { inspectError: true }, /Cannot inspect/],
]) {
  test(`resume refuses ${name}`, async (t) => {
    const { launches, calls } = setup(t, options);
    await assert.rejects(launches.start('test', id, false), pattern);
    assert.ok(!calls.some((args) => args[0] === 'new-session'));
  });
}

for (const options of [{ spawnError: true }, { noAttach: true }, { wrongIdentity: true }]) {
  test('uncertain startup is never replayed or terminated', async (t) => {
    const { launches, calls } = setup(t, options);
    await assert.rejects(launches.start('test'), (error) => error.outcome === 'unknown');
    assert.equal(calls.filter((args) => args[0] === 'new-session').length, 1);
    assert.ok(!calls.some((args) => args[0].startsWith('kill')));
  });
}

test('process exit before registration is a failed startup', async (t) => {
  const { launches } = setup(t, { noAttach: true, exited: true });
  await assert.rejects(
    launches.start('test'),
    (error) => error.outcome === 'rejected' && /exited/.test(error.message),
  );
});

test('resume revalidates saved identity and rejects incomplete history before dispatch', async (t) => {
  const { root, config, defer } = fixture(t);
  const file = join(root, 'saved.jsonl');
  const header = {
    type: 'session',
    version: 3,
    id: 'saved-pi-id',
    cwd: config.projects[0].directory,
    timestamp: '2026-01-01T00:00:00Z',
  };
  const message = {
    type: 'message',
    id: 'message-1',
    parentId: null,
    timestamp: header.timestamp,
    message: { role: 'user', content: 'Saved prompt', timestamp: 1 },
  };
  const content = `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`;
  writeFileSync(file, content);
  const discovery = new SessionDiscovery([root], config.projects);
  const events = new Events();
  const bridges = new NativeBridges(config, events);
  defer(() => bridges.close());
  const sessions = new Sessions(discovery, bridges, events, new SessionReadStore(':memory:'));
  defer(() => sessions.close());
  const savedId = sessions.list()[0].id;
  sessions.validateResume(savedId);
  const calls = [];
  const launches = new Launches(config, sessions, bridges, async (args) => {
    calls.push(args);
    return '';
  });
  appendFileSync(file, '{"type":');
  await assert.rejects(launches.start('test', savedId, true), /incomplete/);
  writeFileSync(file, content.replace('saved-pi-id', 'different-id'));
  await assert.rejects(launches.start('test', savedId, true), /identity changed/);
  assert.ok(!calls.some((args) => args[0] === 'new-session'));
});

test('concurrent launches are serialized and unknown projects are rejected', async (t) => {
  const { launches } = setup(t);
  await assert.rejects(launches.start('missing'), /Project not found/);
  const first = launches.start('test');
  await assert.rejects(launches.start('test'), /Another launch/);
  await first;
});
