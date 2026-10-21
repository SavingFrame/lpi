import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { quote, selectDevice, syncArgs } from '../scripts/ios-mac.mjs';

const cli = fileURLToPath(new URL('../scripts/ios-mac.mjs', import.meta.url));

test('selects the current booted device, refuses ambiguity, and supports an explicit device', () => {
  const booted = { udid: 'new-device', isAvailable: true, state: 'Booted' };
  const shutdown = { udid: 'another-device', isAvailable: true, state: 'Shutdown' };
  const devices = { runtime: [booted, shutdown] };
  assert.equal(selectDevice(devices), booted);
  assert.equal(selectDevice(devices, shutdown.udid), shutdown);
  assert.throws(() => selectDevice(devices, 'deleted-device'), /Select exactly one/);
  assert.throws(() => selectDevice({ runtime: [shutdown] }), /Select exactly one/);
  assert.throws(
    () => selectDevice({ runtime: [booted, { ...shutdown, state: 'Booted' }] }),
    /Select exactly one/,
  );
});

test('quotes remote shell arguments without interpreting their contents', () => {
  const value = "a'b $HOME `whoami` $(exit 99); value";
  const result = spawnSync('bash', ['-c', `printf '%s' ${quote(value)}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, value);
});

test('sync copies workspace source, excludes generated/private files, and preserves destination files', async (t) => {
  if (spawnSync('rsync', ['--version']).status !== 0) {
    t.skip('rsync is not installed');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'pim-ios-sync-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  const files = [
    'package.json',
    'package-lock.json',
    'mobile/src/app.tsx',
    'src/client/live.ts',
    '.env',
    'pim.config.json',
    'unrelated/file.txt',
    'mobile/.env.local',
    'mobile/node_modules/private.txt',
    'mobile/.tools/private.txt',
    'mobile/.expo/state.json',
    'mobile/dist/bundle.js',
    'mobile/expo-env.d.ts',
  ];
  for (const file of files) {
    await mkdir(join(source, file, '..'), { recursive: true });
    await writeFile(join(source, file), file);
  }
  await mkdir(destination);
  await writeFile(join(destination, 'keep.txt'), 'preserved');
  const result = spawnSync('rsync', syncArgs(source, `${destination}/`), { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const file of files.slice(0, 4)) {
    assert.equal(await readFile(join(destination, file), 'utf8'), file);
  }
  for (const file of files.slice(4)) {
    await assert.rejects(readFile(join(destination, file)), { code: 'ENOENT' });
  }
  assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'preserved');
});

test('help and invalid arguments do not require SSH access', () => {
  const env = { ...process.env, PATH: '/nonexistent' };
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /sync\|start\|open\|run/);
  const invalid = spawnSync(process.execPath, [cli, 'erase'], { encoding: 'utf8', env });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid command/);
});
