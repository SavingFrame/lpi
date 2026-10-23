# Development

For installation and running Pim, see the [README](../README.md). Development rules and
runtime-safety constraints live in [AGENTS.md](../AGENTS.md).

## Repository map

- `src/main.ts`: relay server entry point.
- `src/api/`: Fastify HTTP/WebSocket routes, security checks, and frontend serving.
- `extensions/pim/index.ts`: native Pi bridge entry point.
- `extensions/session-name/index.ts`: independent session-naming extension.
- `src/shared/`: browser-safe contracts and validators.
- `src/client/`: shared browser/mobile transport, synchronization, and controllers.
- `src/extension-support/`: extension contracts and native/browser adapters.
- `frontend/src/`: browser UI and platform adapters.
- `mobile/src/`: Expo app, native UI, and platform adapters.
- `desktop/`: Electron shell bundling the existing frontend.
- `tests/`, `frontend/tests/`, `mobile/tests/`, `desktop/tests/`: isolated tests.

## Build and run

`npm run build` builds the relay and browser UI. `npm run build:server` also type-checks
and compiles the Pi extensions and their shared support into `dist/src/` and
`dist/extensions/` for tests. `npm start` runs `dist/src/main.js`.
Native Pi loads extension source, not build output.

For browser development, run the relay separately, then `npm run dev` and open
`http://127.0.0.1:5173`. Vite proxies API/WebSocket traffic to the relay;
`PIM_DEV_SERVER` overrides its target. Allow the exact development origin in the relay config.

## Reference

- [Relay configuration and API](server.md)
- [Native Pi bridge, troubleshooting, and runtime safety](bridge.md)
- [Browser implementation and behavior](frontend.md)
- [Shared client behavior](../src/client/README.md)
- [Desktop setup and development](../desktop/README.md)
- [Mobile setup and development](../mobile/README.md)

## Validation

Use `npm run check` for lint, formatting, and import organization, and
`npm run typecheck` for TypeScript checks. Neither runs tests.
Use the focused test commands in [AGENTS.md](../AGENTS.md) for the affected surface;
native-Pi integration is opt-in.

Pim reads Pi history without opening another runtime. Its SQLite database stores relay
metadata, never conversations. Disconnects never authorize a second writer, and reconnects
never replay mutations automatically. Managed resume checks tmux reservations, but cannot
reliably detect external writers. Full native TUI/relay integration remains unverified.
