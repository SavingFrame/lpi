import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pim-relay-test-'));
  const directory = join(root, 'project');
  mkdirSync(directory);
  const home = join(root, 'home');
  mkdirSync(home);
  const cleanups = [];
  const defer = (cleanup) => cleanups.push(cleanup);
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) {
        await cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const config = {
    host: '127.0.0.1',
    port: 3141,
    origins: ['http://localhost:5173'],
    projectRoots: [root],
    piSessionRoots: [],
    projects: [{ id: 'test', name: 'test', directory }],
  };
  return { root, home, config, defer };
}
