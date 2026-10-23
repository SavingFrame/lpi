# Development

For installation and running lpi, see the [README](../README.md). Development rules and
runtime-safety constraints live in [AGENTS.md](../AGENTS.md).

## Repository map

- `src/main.ts`: relay server entry point.
- `src/api/`: Fastify HTTP/WebSocket routes, security checks, and frontend serving.
- `extensions/lpi/index.ts`: native Pi bridge entry point.
- `extensions/session-name/index.ts`: independent session-naming extension.
- `src/shared/`: browser-safe contracts and validators.
- `src/client/`: shared browser/mobile transport, synchronization, and controllers.
- `src/extension-support/`: extension contracts and native/browser adapters.
- `frontend/src/`: browser UI and platform adapters.
- `mobile/src/`: Expo app, native UI, and platform adapters.
- `desktop/`: Electron shell bundling the existing frontend.
- `assets/brand/`: shared icon masters and platform exports.
- `tests/`, `frontend/tests/`, `mobile/tests/`, `desktop/tests/`: isolated tests.

## Shared contract boundaries

`src/shared/` contains browser-safe types, validators, and pure projections. Import contracts
from there directly, not through server implementations or frontend HTTP helpers. Keep
filesystem, socket, database, Pi runtime, and UI dependencies out; Pi content/model imports
must be type-only. Browser-safe extension contracts may live in `src/extension-support/`.

Validate at every network boundary using shared parsers, without sharing mutable runtime
state. Keep cursor, generation, buffering, and reconnect decisions in transport code.
`tests/shared-contracts.test.mjs` covers contracts and dependency boundaries after a server build.

## Build and run

`npm run build` builds the relay and browser UI. `npm run build:server` also type-checks
and compiles the Pi extensions and their shared support into `dist/src/` and
`dist/extensions/` for tests. `npm start` runs `dist/src/main.js`.
Native Pi loads extension source, not build output.

For browser development, run the relay separately, then `npm run dev` and open
`http://127.0.0.1:5173`. Vite proxies API/WebSocket traffic to the relay;
`LPI_DEV_SERVER` overrides its target. Allow the exact development origin in the relay config.

## Reference

- [Relay configuration and API](server.md)
- [Native Pi bridge, troubleshooting, and runtime safety](bridge.md)
- [Browser implementation and behavior](frontend.md)
- [Shared client behavior](../src/client/README.md)
- [Desktop setup](../desktop/README.md) and [development](desktop-development.md)
- [Mobile setup](../mobile/README.md) and [development](mobile-development.md)

## Validation

Use `npm run check` for lint, formatting, and import organization, and
`npm run typecheck` for TypeScript checks. Neither runs tests.
Use the [test guide](../tests/README.md) to select suites and follow
[AGENTS.md](../AGENTS.md) for the affected surface;
native-Pi integration is opt-in.

lpi reads Pi history without opening another runtime. Its SQLite database stores relay
metadata, never conversations. Disconnects never authorize a second writer, and reconnects
never replay mutations automatically. Managed resume checks tmux reservations, but cannot
reliably detect external writers. Full native TUI/relay integration remains unverified.
