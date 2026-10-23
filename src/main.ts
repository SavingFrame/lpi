import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api/http.js';
import { NativeBridges } from './bridge/server.js';
import { loadConfig } from './config.js';
import { Events } from './events.js';
import { HomeAssistantNotifications } from './home-assistant.js';
import { Sessions } from './sessions.js';
import { object, text } from './shared/errors.js';
import { SessionDiscovery } from './storage/discovery.js';
import { SessionReadStore } from './storage/read-state.js';

const config = loadConfig(process.argv[2] ?? 'lpi.config.json');
const events = new Events();
const discovery = new SessionDiscovery(config.piSessionRoots, config.projects);
for (const warning of discovery.warnings) {
  console.warn(warning);
}
const bridges = new NativeBridges(config, events);
const stateDirectory = process.env.LPI_STATE_DIR ?? join(homedir(), '.local', 'state', 'lpi');
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
const readStates = new SessionReadStore(join(stateDirectory, 'lpi.sqlite'));
const sessions = new Sessions(discovery, bridges, events, readStates);
let notificationToken = process.env.LPI_HA_TOKEN ?? '';
if (config.homeAssistant && !notificationToken && process.env.LPI_HA_CREDENTIALS_FILE) {
  try {
    const credentials = object(
      JSON.parse(readFileSync(process.env.LPI_HA_CREDENTIALS_FILE, 'utf8')),
    );
    notificationToken = text(credentials.token, 'Home Assistant token', 8192);
  } catch {
    throw new Error('Could not load Home Assistant token from LPI_HA_CREDENTIALS_FILE');
  }
}
const notifications = config.homeAssistant
  ? new HomeAssistantNotifications(
      config.homeAssistant,
      events,
      sessions,
      readStates,
      notificationToken,
    )
  : undefined;
const server = await createApi(config, sessions, bridges, events);

let closing = false;
function shutdown(): void {
  if (closing) {
    return;
  }
  closing = true;
  notifications?.close();
  void server.close().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  const address = await server.listen({ port: config.port, host: config.host });
  console.log(`lpi listening on ${address}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  shutdown();
}
