import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RpcProcess } from './rpc.mjs';

async function withChild(source, callback, timeout = 1_000) {
  const root = mkdtempSync(join(tmpdir(), 'pim-rpc-unit-'));
  const rpc = new RpcProcess(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root,
    env: {},
    logPrefix: join(root, 'test'),
    timeout,
  });
  try {
    await callback(rpc);
  } finally {
    await rpc.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}

test('correlates out-of-order responses and preserves Unicode line separators', async () => {
  await withChild(
    `
    let buffer = '', commands = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      buffer += chunk;
      let n;
      while ((n = buffer.indexOf('\\n')) >= 0) {
        commands.push(JSON.parse(buffer.slice(0, n))); buffer = buffer.slice(n + 1);
      }
      if (commands.length === 2) {
        for (const command of commands.reverse()) {
          const text = JSON.stringify({type:'response', id:command.id, success:true, data:command.message}) + '\\n';
          process.stdout.write(text.slice(0, 5)); process.stdout.write(text.slice(5));
        }
        commands = [];
      }
    });
  `,
    async (rpc) => {
      const first = rpc.request('prompt', { message: 'a\u2028b\u2029c' });
      const second = rpc.request('prompt', { message: 'second' });
      assert.equal(await first, 'a\u2028b\u2029c');
      assert.equal(await second, 'second');
      assert.equal((await rpc.stop()).code, 0);
    },
  );
});

test('process exit rejects pending requests without waiting for deadline', async () => {
  await withChild('process.stdin.once("data", () => process.exit(7));', async (rpc) => {
    await assert.rejects(rpc.request('get_state'), /RPC exited/);
    assert.equal((await rpc.exited).code, 7);
    await assert.rejects(rpc.request('get_state'), /RPC exited/);
  });
});

test('a command timeout is uncertain and is not automatically retried', async () => {
  await withChild(
    'process.stdin.resume();',
    async (rpc) => {
      await assert.rejects(rpc.request('prompt'), /outcome unknown/);
      assert.equal(rpc.sequence, 1);
    },
    100,
  );
});

test('malformed stdout fails pending requests', async () => {
  await withChild(
    'process.stdin.once("data", () => process.stdout.write("not json\\n"));',
    async (rpc) => {
      await assert.rejects(rpc.request('get_state'), /Invalid RPC record/);
    },
  );
});
