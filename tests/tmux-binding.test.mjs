import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { piInventoryId } from '../dist/src/storage/session-id.js';
import { fixture } from './helpers.mjs';

const binding = new URL('../dist/src/tmux-binding.js', import.meta.url).href;

test('managed file reservations target the exact tmux session and accumulate', (t) => {
  const available = spawnSync('tmux', ['-V']);
  if (available.error?.code === 'ENOENT') {
    t.skip('tmux is not installed');
    return;
  }
  assert.equal(available.status, 0);
  const { root, home, defer } = fixture(t);
  const name = 'lpi-11111111-1111-1111-1111-111111111111';
  const env = {
    ...process.env,
    HOME: home,
    PI_CODING_AGENT_DIR: join(home, 'agent'),
    TMUX: '',
    TMUX_PANE: '',
    TMUX_TMPDIR: root,
    LPI_TMUX_SESSION: name,
  };
  const run = (args) =>
    execFileSync('tmux', ['-L', 'lpi', '-f', '/dev/null', ...args], {
      env,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  run(['new-session', '-d', '-s', name, 'sleep 60']);
  defer(() => run(['kill-server']));
  t.diagnostic(`Monitor: TMUX_TMPDIR=${root} tmux -L lpi attach -t ${name}`);
  run(['new-session', '-d', '-s', `${name}-other`, 'sleep 60']);

  const existing = join(root, 'existing.jsonl');
  const alias = join(root, 'alias.jsonl');
  const fresh = join(root, 'fresh.jsonl');
  writeFileSync(existing, '');
  symlinkSync(existing, alias);
  for (const file of [alias, fresh]) {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { reserveManagedFile } from ${JSON.stringify(binding)}; reserveManagedFile(process.argv[1]);`,
        file,
      ],
      { env, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }

  // Option commands accept pane targets, so exact session names need a trailing colon.
  const options = run(['show-options', '-t', `=${name}:`]);
  assert.ok(options.includes(`@lpi_file_${piInventoryId(existing)} 1`));
  assert.ok(options.includes(`@lpi_file_${piInventoryId(fresh)} 1`));
  assert.equal(run(['show-options', '-t', `=${name}-other:`]), '');
});
