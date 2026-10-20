# Pim

A single relay server and browser client for native Pi sessions. Pi runs the agent and writes its normal JSONL. Extensions connect to Pim to stream state and receive remote commands. Pim never opens another agent runtime.

## Run

Requires Node.js 22.19+. The extension is typechecked against pinned **Pi 1.0.4**.

```sh
npm ci --ignore-scripts
npm run build
cp pim.config.example.json pim.config.json
# Edit projectRoots to list your project container folders.
npm start -- pim.config.json
```

Open **http://127.0.0.1:3141**.

Project roots are containers, for example `["~/Projects"]`. Pim discovers immediate child directories, including non-Git folders, and deduplicates canonical paths. Restart after adding folders.

Saved Pi sessions are discovered at startup from `piSessionRoots` (default `~/.pi/agent/sessions`). Only files matching configured project working directories appear. Inspection reads original JSONL without copying or rewriting it. Custom session storage requires explicit roots.

Pim trusts your home LAN and Tailscale network. There is no application authentication or bridge token. Anyone who can reach the server can control connected agents. Network access control is your deployment's responsibility; do not expose Pim publicly.

The server defaults to `host: "0.0.0.0"` for LAN access. Set `host` to `127.0.0.1` for loopback-only access. Add each LAN/Tailscale browser URL (for example `http://192.168.1.20:3141`) to `origins`. Host and Origin checks remain enforced; allowed Hosts are derived from those URLs, plus localhost/loopback.

## Connect native Pi

Start Pim, then load the compiled extension in normal interactive Pi:

```sh
pi --extension /absolute/path/to/pim/dist/bridge/extension.js --resume
```

Adapt the path to your checkout. Loading the extension connects automatically to `ws://127.0.0.1:3141/bridge`. Set `PIM_BRIDGE_URL` to use another endpoint. Connected sessions appear as **Pi · live TUI**; saved files without a connection appear as **Pi · read-only**.

The browser receives current-branch history, assistant partials, tool activity, runtime metadata, and queued-message presence. Prompt, steer, follow-up, and abort run in that same native Pi process. Attach photos/screenshots using the image picker, clipboard paste, or drag-and-drop (PNG, JPEG, GIF, WebP; up to 4 images and 4 MiB total). Image-only messages are supported; the selected model must support images. Model changes, queue editing, and dialog answers remain terminal-only.

`/pim-disconnect` stops the relay connection without stopping Pi. Closing the browser or Pim does not stop the agent. Closing Pi does. For now, launch Pi manually inside tmux if it should outlive your terminal connection.

**Server-side tmux launching and browser session creation are planned, not implemented.** There are no RPC runtimes, ownership locks, parking sessions, or handoffs. See [the plan](PLAN.md).

## Frontend development

The browser uses React, Vite, Tailwind CSS v4, and locally owned shadcn/ui components with a dark zinc theme and Lucide icons.

Run the compiled server, then `npm run dev`. Open **http://127.0.0.1:5173**. Vite proxies REST/events to port 3141. Set `PIM_DEV_SERVER` for another target and update configured allowed origins when changing ports.

## Layout

- `src/bridge/`: native extension, connection protocol, relay transport.
- `src/sessions.ts`: combined saved/live inventory and snapshots.
- `src/storage/`: read-only JSONL discovery and stable inventory IDs.
- `src/api/`: REST commands, bounded browser events, and static assets.
- `src/client-state.ts`: shared native-event projection.
- `frontend/`: React/Vite browser and synchronization tests.
- `tests/`: isolated relay, discovery, configuration, and API tests.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm test
```

Tests use temporary files, fake Pi contexts, and local/mocked transports without model calls. Real-Pi integration remains unverified.

See [server API](docs/server.md), [bridge setup](docs/bridge.md), and [frontend notes](docs/frontend.md).
