import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApi } from './api/http.js';
import { attachWebSockets } from './api/websocket.js';
import { loadConfig } from './config.js';
import { Coordinator } from './coordinator.js';
import { Events } from './events.js';
import { Catalog } from './storage/catalog.js';
import { SessionDiscovery } from './storage/discovery.js';
import { acquireCoordinatorLock } from './storage/files.js';

const config = loadConfig(process.argv[2] ?? 'pim.config.json');
const version = await promisify(execFile)(config.pi, ['--version'], {
  timeout: 10_000,
  maxBuffer: 65_536,
});
if (version.stdout.trim() !== '1.0.4') {
  throw new Error('Only Pi 1.0.4 is supported');
}
const releaseLock = acquireCoordinatorLock(config.dataDirectory);
const catalog = new Catalog(config.dataDirectory, config.projects);
const events = new Events();
const discovery = new SessionDiscovery(
  config.piSessionRoots,
  config.projects,
  catalog.list().map((session) => session.file),
);
for (const warning of discovery.warnings) {
  console.warn(warning);
}
const coordinator = new Coordinator(config, catalog, events, process.env, discovery);
const server = createApi(config, coordinator);
const closeSockets = attachWebSockets(server, config, events);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  closeSockets();
  server.close();
  server.closeAllConnections();
  const released = await coordinator.shutdown();
  if (released) {
    releaseLock();
  } else {
    console.error('Ownership unresolved. Coordinator lock retained.');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  void shutdown();
});
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Pim listening on http://127.0.0.1:${config.port}`);
});
