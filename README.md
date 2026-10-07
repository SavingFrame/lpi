# Pim

A local, single-user browser client and TypeScript server for normal Pi sessions. The server owns RPC runtimes and coordinates ownership conservatively. Native TUI handoff remains a separate, verified prototype.

## Run

Requires Node.js 22.19+. Dependencies include **Pi 1.0.4**, which provides the CLI on npm's PATH when using `npm start`. Pi runs as a subprocess, not an embedded agent SDK. Stopped transcripts use Pi's pure JSONL parsing/context helpers without opening another runtime.

```sh
npm ci --ignore-scripts
npm run build
cp pim.config.example.json pim.config.json
# Edit projectRoots to list your project container folders.
npm start -- pim.config.json
```

Set `"projectRoots": ["~/Projects", "~/Projects/work"]` in `pim.config.json` (use only folders that exist). The server discovers immediate child directories at startup, including non-Git folders. Configured roots are containers, not projects. Overlapping roots and symlink aliases are deduplicated; folder names are displayed with stable IDs derived from canonical paths. Restart the server after adding folders. Empty roots are allowed.

The server binds only to `127.0.0.1` and has no authentication. Allowed browser origins must be listed explicitly; Host and Origin checks remain enforced. Local processes can access the agent without credentials. Do not expose it through a public proxy.

RPC children reuse the server's environment and existing Pi agent configuration. Project trust follows normal Pi rules. New managed JSONL files and the ownership catalog live in the configured data directory.

Existing Pi sessions are discovered at startup from `piSessionRoots` (default `~/.pi/agent/sessions`). Pim reads the original files without copying, migrating on disk, or opening a runtime. Only sessions whose header working directory matches a configured project are listed. They appear as **Pi · read-only** and support transcript inspection and manual refresh. Discovery does not prove that an existing TUI released ownership, so prompts, runtime start, and recovery are blocked for these sessions until coordinated native access is implemented. Set `piSessionRoots` to `[]` to disable discovery, or list your custom session storage directories. Custom Pi agent/session-directory settings are not automatically resolved.

**Do not open managed files directly in native Pi.** Coordinated CLI access is intentionally blocked until the launcher/bridge contract is implemented.

Open **http://127.0.0.1:3141** after starting the server. Create a session, then start its runtime before sending prompts. The example configuration allows that browser origin and the Vite development origins. If you change ports, update the allowed origins too.

## Frontend development

Run the backend in one terminal, then run `npm run dev` in another. Open **http://127.0.0.1:5173**. Vite proxies REST and WebSocket traffic to port 3141. Set `PIM_DEV_SERVER` if the backend uses a different port.

`npm run build` builds both server and browser assets; `npm start` serves the production browser build. See [frontend notes](docs/frontend.md).

## Layout

- `frontend/`: React/Vite client, TanStack Query/Router, and focused synchronization tests.
- `src/client-state.ts`: shared streaming-message and runtime-state projection.
- `src/api/`: local REST commands, snapshots, bounded WebSocket delivery, and static assets.
- `src/rpc/`: constrained protocol and supervised JSONL transport.
- `src/storage/`: session catalog, read-only Pi discovery, durable writes, exclusive coordinator lock.
- `src/ownership.ts`: generation-checked ownership transitions.
- `src/coordinator.ts`: session/runtime orchestration.
- `prototypes/handoff/`: isolated native TUI feasibility experiment.
- `tests/`: deterministic backend tests with fake RPC children, temporary HOME/configuration, and no model calls.

## Validation

```sh
npm run check
npm run typecheck
npm run test:backend
npm run test:frontend
```

Backend tests do not launch your installed Pi or use credentials. `npm test` and `npm run test:handoff` remain the separate prototype commands.

## Scope

The browser supports project/session selection, creation, runtime start/stop, current-context transcripts, partial responses, tool activity, queues, prompts, steering, follow-ups, abort, model/thinking selection, and current context usage. Reconnects use an authoritative snapshot boundary plus buffered events; uncertain mutations are never replayed automatically.

Dialog answers, production live TUI ownership, event replay, and the separate iOS client are deferred. Real-Pi integration with the installed resource set remains unverified.

See [server API](docs/server.md), [ownership and recovery](docs/ownership.md), [configuration audit](docs/configuration-audit.md), and [the plan](PLAN.md).
