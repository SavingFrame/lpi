import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api/http.js';
import { attachWebSockets } from './api/websocket.js';
import { NativeBridges } from './bridge/server.js';
import { loadConfig } from './config.js';
import { Events } from './events.js';
import { Sessions } from './sessions.js';
import { SessionDiscovery } from './storage/discovery.js';
import { SessionReadStore } from './storage/read-state.js';

const config = loadConfig(process.argv[2] ?? 'pim.config.json');
const events = new Events();
const discovery = new SessionDiscovery(config.piSessionRoots, config.projects);
for (const warning of discovery.warnings) {
  console.warn(warning);
}
const bridges = new NativeBridges(config, events);
const stateDirectory = process.env.PIM_STATE_DIR ?? join(homedir(), '.local', 'state', 'pim');
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
const readStates = new SessionReadStore(join(stateDirectory, 'pim.sqlite'));
const sessions = new Sessions(discovery, bridges, events, readStates);
const server = createApi(config, sessions, bridges);
const closeSockets = attachWebSockets(server, config, events, bridges);

let closing = false;
function shutdown(): void {
  if (closing) {
    return;
  }
  closing = true;
  closeSockets();
  server.close();
  server.closeAllConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  shutdown();
});
server.listen(config.port, config.host, () => {
  const host = config.host.includes(':') ? `[${config.host}]` : config.host;
  console.log(`Pim listening on http://${host}:${config.port}`);
});
