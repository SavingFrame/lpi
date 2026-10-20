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

## UI components

The interface uses Tailwind CSS v4 through its Vite plugin, locally owned shadcn/ui components (New York style), and Lucide icons. Shared components live in `frontend/src/components/ui`; `frontend/src/lib/utils.ts` merges utility classes. Dark zinc theme tokens and application layout styles live in `frontend/src/style.css`.

The shadcn configuration is `frontend/components.json`. Run future shadcn CLI commands from `frontend/`; the `@/` alias resolves to `frontend/src` in both Vite and TypeScript. Review generated changes and pin any added dependencies to exact versions. The command-mode selector remains a native select to preserve its existing keyboard and form behavior.

## Behavior

The sidebar shows the 15 most recent sessions across projects, sorted by saved-file modification time or native connection/activity time. Titles use the session name or first user text, with project, timestamp, and live/read-only status underneath. Older sessions are available through **Show older sessions**; an older selected session stays visible. Saved title discovery reads bounded file prefixes and tails, so missing metadata falls back to **Untitled session**.

The sidebar and session have independent viewport-height scroll areas. Sessions open at the end of the conversation and follow new content while near the bottom. Scrolling up pauses following so incoming output does not pull you away from older messages.

Saved records show **read-only**. Connected records show **live** and support prompt, steer, follow-up, and abort. The model input searches available models by name, provider, and ID. Pi scoped models (`enabledModels` / `--models`, exposed by `ctx.scopedModels`) appear first in a separate group; this is not a separate favorites store. Thinking uses a colored, keyboard-accessible slider over only the current model’s supported levels. Drag to preview and release to apply; keyboard changes apply on key release. Model/thinking changes require idle Pi with no queued messages or dialogs. Context usage remains display-only. Queue editing and dialog answers remain terminal-only.

Attach PNG, JPEG, GIF, or WebP images using **Attach images**, clipboard paste, or drag-and-drop onto the composer. Preview and remove images before sending; image-only messages work too. Prompt, steer, and follow-up deliver structured image content through Pi’s public `sendUserMessage` API. The selected model must support images. Limits are four images and 4 MiB total decoded data per message, with a 6 MiB JSON request limit. Unsent images stay in memory and are lost on session navigation or reload. Rejected/unknown submissions retain images while the composer remains mounted; unknown outcomes still block resending until reviewed.

With the message box focused, **Alt+Enter** sends using the selected mode and **Esc** aborts. Plain Enter inserts a newline. Shortcuts obey the same availability checks as the buttons and are ignored during IME composition or key repeat. Abort does not clear queued messages.

The sidebar project selector and **New session** launch native Pi in a dedicated tmux session. Saved sessions offer **Resume session**, with explicit confirmation that no external Pi writer remains. Managed tmux reservations are checked server-side before resume. Both operations wait for bridge registration before opening the session. Unknown outcomes block another launch until the user inspects the runtimes; tab-scoped storage preserves that guard across reloads. Connected Pim-managed runtimes offer **Stop runtime** with confirmation; acceptance is not proof of exit. Startup dialogs remain terminal-only; inspect with `tmux -L pim list-sessions` and attach with `tmux -L pim attach -t <name>`.

TanStack Query holds project/session queries. The `LiveSession` store handles the selected snapshot and events. Native partial messages replace content authoritatively; no RPC delta reconstruction is needed.

Reconnects subscribe first, buffer events, load a snapshot, discard events at or before its epoch/cursor boundary, and apply newer events. Global cursors are checked even for other sessions. Connection/status/branch changes and settlement refresh the snapshot. Gaps, epoch changes, or buffer overflow require reconnecting.

Mutations never retry automatically. Request IDs and connection generations reject duplicates and stale commands. Dispatch is not execution completion. Unknown outcomes preserve the draft and block further commands until the user inspects and acknowledges uncertainty. Tab-scoped storage preserves drafts and protects against reload during submission.

Markdown raw HTML is disabled and Markdown image URLs are not loaded. Structured raster image attachments render as inline data previews; SVG attachments are rejected. Closing the browser does not stop Pi.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm run test:frontend
```

Synchronization tests use mocked browser transport. Relay tests use fake public Pi contexts and isolated files/transports without model calls. Native-Pi integration and remote dialog adapters remain unverified.
