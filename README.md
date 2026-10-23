# lpi (local pi)

<img src="assets/brand/lpi-icon.svg" alt="lpi" width="64" height="64" />

Desktop, browser, and mobile access to your native Pi coding sessions. Follow agents, send
messages, and manage conversations across projects.

Pi runs the agent and keeps its normal session files. lpi connects to that same runtime, so
you can move between the terminal and browser without starting a second agent.

## Features

- Browse live and saved sessions, grouped by project. Archive and restore conversations.
- Follow streaming responses, tool activity, code diffs, images, and interactive HTML artifacts.
- Send prompts and images, steer running agents, and inspect or clear queued messages.
- Use `/compact`, `/new`, extension commands, skills, and `@path` file completion.
- Switch models and thinking levels. Explore branches and continue from earlier messages.
- Create, resume, and stop lpi-managed sessions.
- Track running agents, input requests, and unread completions across devices.
- Optionally receive iPhone completion alerts through Home Assistant.

Client capabilities vary. See the [desktop](desktop/README.md) and [mobile](mobile/README.md)
guides for their supported controls and limitations.

## Install and run

lpi currently runs from source. You need:

- Node.js **22.19 or newer** and npm.
- Native **Pi 1.4.0**, configured with your model provider credentials.
- **tmux** on the relay host for creating and resuming sessions from clients.
- **Git** for project file completion that respects ignore rules.

The relay and Pi run on the same machine. Install Pi separately and ensure `pi` and `tmux`
are on the relay process's `PATH`; installing lpi's dependencies does not install a global Pi CLI.

### 1. Install dependencies

From your checkout of this repository:

```sh
npm ci --ignore-scripts
cp lpi.config.example.json lpi.config.json
```

### 2. Configure your projects

Edit `lpi.config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 3141,
  "origins": ["http://127.0.0.1:3141"],
  "projectRoots": ["~/Projects"],
  "piSessionRoots": ["~/.pi/agent/sessions"]
}
```

`projectRoots` contains existing parent directories, not individual projects. For example,
`~/Projects/my-app` becomes a project when `~/Projects` is a root. Restart lpi to discover new
project directories. Set `piSessionRoots` to your Pi session storage if you use a custom location.

This example is local-only. The supplied example file binds to all IPv4 interfaces. For access
from another device, choose an appropriate bind address and add the exact URL you use, including
the port, to `origins`. See [configuration](docs/server.md#configuration).

**lpi has no application authentication. Anyone who can reach it can control connected agents.
Use a trusted LAN, Tailscale policy, or tunnel. Do not expose it publicly.**

### 3. Install the Pi extension

With lpi's dependencies installed, link the bridge into Pi's extension directory. Replace the
path below with your checkout's absolute path:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s /absolute/path/to/lpi/extensions/lpi ~/.pi/agent/extensions/lpi
```

Keep the checkout and its dependencies available. Pi loads the TypeScript source directly;
no extension build is needed. Load only one lpi entry, replacing older `lpi.js`, `lpi.ts`, or
outdated symlinks rather than keeping duplicates. Reload or restart Pi after installation.
Restarting the relay alone does not reload Pi extensions.

Loading the extension enables automatic connection and remote controls for native TUI sessions.
Run Pi from a configured project directory. The default endpoint is
`ws://127.0.0.1:3141/bridge`; set `LPI_BRIDGE_URL` in Pi's environment if you change it.
Use `/lpi-disconnect` to disconnect without stopping the agent, or `/lpi-connect` to reconnect.

For one-off loading instead of global installation:

```sh
pi --extension /absolute/path/to/lpi/extensions/lpi
```

Client create/resume requires the global installation. See the [bridge guide](docs/bridge.md)
for connection options and troubleshooting.

### 4. Start lpi

```sh
npm run build
npm start -- lpi.config.json
```

Open **http://127.0.0.1:3141**. Start Pi in a configured project, or use the project's **+**
button to create a lpi-managed session.

## Other clients and optional extensions

- **Desktop:** run `npm run desktop:start` with the relay already running. The Electron shell
  bundles the web UI; installers are not available yet. See [desktop setup](desktop/README.md).
- **iOS:** run the Expo app or build it locally. See [mobile setup](mobile/README.md).
- **Automatic session names:** independently load `extensions/session-name` to name sessions
  from the first user message. It uses a separate model request and requires that model's
  credentials. See [installation and model configuration](extensions/session-name/README.md).
- **iPhone alerts:** use your existing Home Assistant Companion app to receive unread-completion
  notifications. See [notification setup](docs/notifications.md).

## Architecture

lpi has one relay server, a Pi extension in each connected session, and clients that share
those sessions:

```text
Pi + extension ─┐                  ┌─ Web browser
Pi + extension ─┼─ lpi server ─────┼─ Desktop app
Pi + extension ─┘                  └─ iOS app
```

Pi is the only agent runtime and conversation-file writer. lpi reads saved history and stores
read/archive metadata separately in SQLite. Closing a client or the relay does not stop agents.

Client create/resume launches native Pi through a dedicated `tmux -L lpi` server. A disconnected
session may still be running. Before resuming saved history, confirm no other Pi process is using
it; lpi cannot reliably detect external writers. Reconnection never automatically replays commands.
Full native TUI/relay integration remains unverified.

## Documentation

- [Relay configuration and API](docs/server.md)
- [Pi bridge and troubleshooting](docs/bridge.md)
- [Home Assistant notifications](docs/notifications.md)
- [Development and repository layout](docs/development.md)
