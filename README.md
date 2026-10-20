# Pim

A single relay server and browser client for native Pi sessions. Pi runs the agent and writes its normal JSONL. Extensions connect to Pim to stream state and receive remote commands. Pim never opens another agent runtime.

## Run

Requires Node.js 22.19+ and tmux 3.2+ for browser create/resume. The extension is typechecked against pinned **Pi 1.0.4**, with `pi-ai` pinned to the same version for model capabilities and shared types.

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

The browser receives current-branch history, assistant partials, tool activity, runtime metadata, and queued-message presence. Prompt, steer, follow-up, and abort run in that same native Pi process. Attach photos/screenshots using the image picker, clipboard paste, or drag-and-drop (PNG, JPEG, GIF, WebP; up to 4 images and 4 MiB total). Image-only messages are supported; the selected model must support images. Model and thinking selectors control connected native Pi when idle with no queued messages or dialogs. Available models come from Pi's authenticated registry. Thinking options come from `pi-ai` model capabilities, including `max` where supported. Pi remains responsible for applying and clamping changes. Queue editing and dialog answers remain terminal-only.

`/pim-disconnect` stops the relay connection without stopping Pi. Closing the browser or Pim does not stop the agent. Closing Pi does.

## Create or resume from the browser

Choose a project in the sidebar and click **New session**. For saved history, open the session and click **Resume session**. Pim starts the pinned native Pi CLI in a detached tmux session, then waits for its bridge to register. The bridge must already be enabled through Pi’s global extension configuration. Pim does not pass `--extension`, avoiding duplicate loading. The explicit command above is only for instances without the bridge globally configured. Project-trust prompts and other startup dialogs must be answered in the terminal.

All managed runtimes use the dedicated `pim` socket, separate from your regular tmux server:

```sh
tmux -L pim list-sessions
tmux -L pim attach -t pim-<launch-id>
```

Detach with Ctrl+b, then d. The terminal and browser control the same native runtime. Closing Pim leaves tmux and Pi running; bridges reconnect automatically when the relay returns.

Resume refuses files reserved by managed runtimes, even while their bridges are disconnected. Reservations survive relay restarts and conservatively retain every file opened in that tmux session. A runtime that has not registered a file blocks resume until inspected. For externally launched Pi, confirm it has stopped before resuming. This is not a general filesystem lock or ownership coordinator.

Startup timeouts and lost responses are uncertain outcomes. Inspect recent sessions and tmux before trying again. No automatic launch replay is provided. For connected Pim-managed runtimes, **Stop runtime** requests graceful Pi shutdown after confirmation, interrupting active work without deleting history. Pi exit normally removes its dedicated tmux session. Acceptance is not proof of exit; resume still checks tmux reservations. Externally launched runtimes must be stopped in their terminal. Real native-Pi integration remains unverified. See [the plan](PLAN.md).

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
