import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Catalog } from '../dist/storage/catalog.js';

export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pim-backend-test-'));
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
    dataDirectory: join(root, 'data'),
    pi: resolve('tests/fixtures/pi.mjs'),
    port: 3141,
    origins: ['http://localhost:5173'],
    projectRoots: [root],
    piSessionRoots: [],
    projects: [{ id: 'test', name: 'test', directory }],
  };
  mkdirSync(config.dataDirectory);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    PI_CODING_AGENT_DIR: join(home, '.pi', 'agent'),
    PI_OFFLINE: '1',
  };
  const catalog = new Catalog(config.dataDirectory, config.projects);
  return { root, config, env, catalog, defer };
}
