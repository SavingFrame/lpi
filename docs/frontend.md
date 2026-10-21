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

## Source layout

- `src/shared/`: browser-safe session/project/command/snapshot contracts, HTTP payload parsers, and native-event/status projections. The frontend imports these directly, not through server implementations. Extension-specific contracts stay in `src/extension-support/`.
- `frontend/src/api.ts`: HTTP transport, response correlation, and endpoint helpers using shared parsers.
- `frontend/src/app.tsx`: application shell and welcome view.
- `frontend/src/session/page.tsx`: selected-session layout and live subscription.
- `frontend/src/session/composer.tsx`: draft persistence, attachments, send modes, and shortcuts.
- `frontend/src/session/commands.ts`: framework-independent command controller. Composer submissions, settings, runtime controls, and extension answers share one pending/uncertain guard and typed command path. It checks current session/project connectivity before dispatch and persists uncertainty before sending. Commands never retry automatically.
- `frontend/src/session/use-session-commands.ts`: React subscription and snapshot/inventory refresh wiring for that controller.
- `frontend/src/session/use-chat-scroll.ts`: React lifecycle binding for the existing scroll controller.

## Behavior

The sidebar groups sessions into collapsible projects, ordered by recent activity, with stable folder colors and per-project **+** creation buttons. Each group initially shows five recent sessions plus running, waiting, unviewed, and selected sessions; older sessions expand per project. Titles use the session name or first user text, with relative timestamps. Blue marks running work, amber marks input requests, and green marks unviewed turns. Idle and read-only activity are separate from unread notifications. Saved title discovery reads bounded file prefixes and tails, so missing metadata falls back to **Untitled session**.

Completion/read state lives in relay SQLite and is shared across clients. The browser acknowledges the completion ID from its loaded snapshot only when synchronized, the tab is visible, and it is following the transcript bottom. Scrolling up or hiding the tab prevents automatic acknowledgment. Failures offer an explicit retry without replaying agent commands. Read-state broadcasts update metadata without reloading history. Relay restarts and reconnects preserve unread state. Existing saved history is not marked unread, and settlements while disconnected are not inferred.

The sidebar and session have independent viewport-height scroll areas. Sessions open at the end of the conversation and follow new content while near the bottom. Scrolling up pauses following so incoming output does not pull you away from older messages.

Saved records show **read-only**. Connected records show **live** and support prompt, steer, follow-up, and abort. The model input searches available models by name, provider, and ID. Pi scoped models (`enabledModels` / `--models`, exposed by `ctx.scopedModels`) appear first in a separate group; this is not a separate favorites store. Thinking uses a colored, keyboard-accessible slider over only the current model’s supported levels. Drag to preview and release to apply; keyboard changes apply on key release. Model/thinking changes require idle Pi with no queued messages or dialogs. Context usage remains display-only. Queue editing and unsupported dialog answers remain terminal-only.

The Ask User Question support module renders pending questionnaires below the transcript. Choose single/multiple options, add custom text and per-question/global notes, inspect available previews, then submit every answer or cancel the whole questionnaire. Native terminal input remains available and the first answer wins. Open questions survive transport reconnects; browser drafts are local UI state and can be lost on navigation/reload or a new native bridge generation. All extension actions use the existing guarded mutation path. See [support modules](../src/extension-support/README.md) for adding another extension without changing core relay code.

Attach PNG, JPEG, GIF, or WebP images using **Attach images**, clipboard paste, or drag-and-drop onto the composer. Preview and remove images before sending; image-only messages work too. Prompt, steer, and follow-up deliver structured image content through Pi’s public `sendUserMessage` API. The selected model must support images. Limits are four images and 4 MiB total decoded data per message, with a 6 MiB JSON request limit. Unsent images stay in memory and are lost on session navigation or reload. Rejected/unknown submissions retain images while the composer remains mounted; unknown outcomes still block resending until reviewed.

With the message box focused, **Alt+Enter** sends using the selected mode and **Esc** aborts. Plain Enter inserts a newline. Shortcuts obey the same availability checks as the buttons and are ignored during IME composition or key repeat. Abort does not clear queued messages.

The sidebar project selector and **New session**, or the **+** beside a project, launch native Pi in a dedicated tmux session. Saved sessions offer **Resume session**, with explicit confirmation that no external Pi writer remains. Managed tmux reservations are checked server-side before resume. Both operations wait for bridge registration before opening the session. Unknown outcomes block another launch until the user inspects the runtimes; tab-scoped storage preserves that guard across reloads. Connected Pim-managed runtimes offer **Stop runtime** with confirmation; acceptance is not proof of exit. Startup dialogs remain terminal-only; inspect with `tmux -L pim list-sessions` and attach with `tmux -L pim attach -t <name>`.

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

Synchronization tests use mocked browser transport. Command-controller tests inject connection state, storage, and dispatch to cover pending submissions, reload guards, known rejections, unknown outcomes, and explicit review without a DOM or model calls. Relay tests use fake public Pi contexts and isolated files/transports without model calls. Ask module behavior is covered by fake-native bridge and mocked browser synchronization/draft tests. Real native-Pi integration remains unverified.
