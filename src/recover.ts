import { loadConfig } from './config.js';
import { Catalog } from './storage/catalog.js';
import { acquireCoordinatorLock } from './storage/files.js';

// This is an operator assertion, not PID-based automatic recovery.
const [path, id, expected, assertion] = process.argv.slice(2);
if (!path || !id || !expected || assertion !== '--confirmed-no-writer') {
  throw new Error('Usage: recover CONFIG SESSION_ID GENERATION --confirmed-no-writer');
}
const config = loadConfig(path);
const release = acquireCoordinatorLock(config.dataDirectory);
try {
  const catalog = new Catalog(config.dataDirectory, config.projects);
  const session = catalog.get(id);
  if (session.ownership.generation !== Number(expected)) {
    throw new Error(`Stale generation. Current generation: ${session.ownership.generation}`);
  }
  catalog.change(id, 'confirm-release', Number(expected));
  console.log('Confirmed release recorded. Interrupted work will not be replayed.');
} finally {
  release();
}
