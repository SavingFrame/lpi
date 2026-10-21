import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fixture } from '../helpers.mjs';

for (const entry of [
  'cli.js',
  'bundle/cli.js',
  ...(process.env.PIM_TEST_PI_CLI ? [process.env.PIM_TEST_PI_CLI] : []),
]) {
  test(`real Pi ${entry} loads the source folder and clears/requeues its actual queue`, {
    timeout: 30000,
  }, async (t) => {
    const { root, home, config } = fixture(t);
    const resultFile = join(root, 'result.json');
    const agentDir = join(home, 'agent');
    const extensionDir = join(agentDir, 'extensions', 'pim');
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    symlinkSync(fileURLToPath(new URL('../../src/bridge', import.meta.url)), extensionDir);
    const execution = promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            entry,
            new URL('../../node_modules/@earendil-works/pi-coding-agent/dist/', import.meta.url),
          ),
        ),
        '--offline',
        '--mode',
        'json',
        '--no-tools',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '-e',
        fileURLToPath(new URL('./queue-probe.ts', import.meta.url)),
        '--provider',
        'pim-queue-probe',
        '--model',
        'fake',
        'initial prompt',
      ],
      {
        cwd: config.projects[0].directory,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: '1',
          PI_SKIP_VERSION_CHECK: '1',
          PIM_QUEUE_PROBE_RESULT: resultFile,
        },
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    execution.child.stdin.end();
    const { stderr } = await execution;
    assert.equal(stderr, '');
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.calls, 3);
  });
}
