# Browser client

The React/Vite client uses TanStack Query and Router. It inspects saved history and controls connected native Pi instances through one relay server. There is no browser-side agent or writable session authority.

## Run

```sh
npm run build
npm start -- pim.config.json
```

Open `http://127.0.0.1:3141`. The server serves `frontend/dist`; browser routes use `/app/projects/:projectId/sessions/:sessionId`.

For development, start the compiled server and run `npm run dev`. Open `http://127.0.0.1:5173`. Vite proxies `/projects`, `/sessions`, and `/events`. `PIM_DEV_SERVER` overrides the target. Configure exact allowed browser origins when changing ports.

Browser/API authentication is not enabled. Pim trusts reachable home LAN/Tailscale clients; network access control belongs to deployment. Add each browser URL to `origins` in the server configuration. Host/Origin checks, JSON content-type requirements, and production content security policy remain enforced. Do not expose Pim publicly.

## Behavior

Saved records show **Pi · read-only**. Connected records show **Pi · live TUI** and support prompt, steer, follow-up, and abort. Current model/thinking/context metadata is display-only. Queue editing and dialog answers remain terminal-only.

There are no browser create/start/stop controls. Server-side tmux launching is planned.

TanStack Query holds project/session queries. The `LiveSession` store handles the selected snapshot and events. Native partial messages replace content authoritatively; no RPC delta reconstruction is needed.

Reconnects subscribe first, buffer events, load a snapshot, discard events at or before its epoch/cursor boundary, and apply newer events. Global cursors are checked even for other sessions. Connection/status/branch changes and settlement refresh the snapshot. Gaps, epoch changes, or buffer overflow require reconnecting.

Mutations never retry automatically. Request IDs and connection generations reject duplicates and stale commands. Dispatch is not execution completion. Unknown outcomes preserve the draft and block further commands until the user inspects and acknowledges uncertainty. Tab-scoped storage preserves drafts and protects against reload during submission.

Markdown raw HTML is disabled and image URLs are not loaded. Closing the browser does not stop Pi.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm run test:frontend
```

Synchronization tests use mocked browser transport. Relay tests use fake public Pi contexts and isolated files/transports without model calls. Native-Pi integration and remote dialog adapters remain unverified.
