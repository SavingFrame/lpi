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

The [Electron app](../desktop/README.md) bundles this same frontend under a private local
protocol. `frontend/src/client/connection.ts` reads relay-address metadata supplied by the desktop
launcher, so HTTP/WebSocket requests and durable guards use the configured relay rather than
the local UI origin. Browser pages without that metadata retain relative same-origin behavior.
The relay must explicitly allow `pim-app://app` for bundled desktop clients.
`frontend/src/client/platform.ts` adapts the optional desktop capabilities typed in `src/shared/desktop.ts`
without importing Electron. Desktop and browser builds share `frontendConfig()` from
`frontend/vite.config.ts`; electron-vite supplies the desktop main/preload/renderer pipeline.
The desktop-only Settings link opens `/app/settings`; its appearance controls use this adapter
for device-local UI scale. Browser clients keep normal browser zoom.

## UI components

The interface uses Tailwind CSS v4 through its Vite plugin, locally owned shadcn/ui components (New York style), and Lucide icons. Shared components live in `frontend/src/components/ui`; `frontend/src/lib/utils.ts` merges utility classes. `frontend/src/style.css` is the stylesheet entry point. Ordered imports under `frontend/src/styles/` separate theme/base, shell/sidebar, session layout, transcript, composer, model/thinking controls, and responsive overrides. Component rules keep their existing cascade order.

The shadcn configuration is `frontend/components.json`. Run future shadcn CLI commands from `frontend/`; the `@/` alias resolves to `frontend/src` in both Vite and TypeScript. Review generated changes and pin any added dependencies to exact versions. The command-mode selector remains a native select to preserve its existing keyboard and form behavior.

## Source layout

- `src/shared/`: browser-safe session/project/command/snapshot contracts, HTTP payload parsers, and native-event/status projections. The frontend imports these directly, not through server implementations. Extension-specific contracts stay in `src/extension-support/`.
- `src/client/`: shared transport, synchronization, server-scoped mutation/draft persistence, inventory projections, and read-completion controllers. See [client behavior](../src/client/README.md).
- `frontend/src/main.tsx`: browser bootstrap and provider mounting. `style.css` is the stylesheet entry point; feature code lives in directories.
- `frontend/src/client/`: browser transport construction, socket event adaptation, platform capabilities, and tab-scoped storage. `controllers.ts` wires tab-wide query, command, draft, and launch controllers. Framework-independent behavior belongs in repository-root `src/client/`, not here.
- `frontend/src/app/`: router, application shell, welcome view, and desktop settings.
- `frontend/src/navigation/`: session search, project/sidebar presentation, launch/archive actions, and sidebar projections.
- `frontend/src/components/`: reusable presentation primitives, Markdown policy, deferred content, and windowing. Feature-specific components stay with their feature.
- `frontend/src/session/branches/tree.tsx`, `tree-graph.ts`, `tree-query.ts`: selected-session tree fetching, projected conversation-tip counting, nested branch groups, symmetric branch collapse controls, role-colored rows, and saved-entry browsing. Sidebar observers use the same query with fetching disabled.
- `frontend/src/session/branches/session-branches.tsx`, `branch-state.ts`: cached sidebar branches, full-tree ordering, linear-path collapse, active markers, and structured user-message draft restoration.
- `frontend/src/session/page.tsx`: selected-session layout and live subscription. `session/branches/use-branch-navigation.ts` binds preview queries, navigation intents, and draft restoration to the page lifecycle. `session/branches/branch-navigation.ts` holds single-use click intents and guarded direct navigation; preview URLs alone never dispatch commands.
- `frontend/src/session/composer/composer.tsx`: shared draft subscription, attachments, send modes, and shortcuts. `src/client/drafts.ts` hydrates/persists server-scoped drafts and settles acceptance without clearing newer edits or losing rejected/unknown submissions. A per-server registry in `frontend/src/client/controllers.ts` preserves current draft state across navigation; storage failures surface an explicit retry.
- `src/client/commands.ts`: framework-independent command controller. Composer submissions, settings, runtime controls, and extension answers share one pending/uncertain guard and typed command path. It waits for storage hydration and checks session/project connectivity and generation again after persisting uncertainty. Commands never retry automatically.
- `frontend/src/session/use-session-commands.ts`: React subscription and snapshot/inventory refresh wiring for that controller.
- `frontend/src/session/scroll/`: scroll-following controller and its React lifecycle binding.
- `frontend/src/session/transcript/`: transcript projection and message grouping, message actions, and recursive message/tool rendering. `tools/` owns tool-specific views and file previews; `display/` owns sandboxed display artifacts and their theme.
- `src/client/launches.ts`: framework-independent launch controller, instantiated tab-wide in `frontend/src/client/controllers.ts`. Fresh-session buttons share one pending/uncertain guard across projects; each resume ID has its own guard. The controller persists before dispatch, never retries automatically, and requires explicit review of uncertain outcomes. `frontend/src/navigation/launch-session.tsx` owns confirmation, selection, and navigation.
- `src/client/read-completion.ts`: eligibility selection from the loaded snapshot, requiring synchronization, visibility, and following the transcript bottom. Its controller tracks attempted IDs, isolates late verdicts, and offers explicit eligible retry after failure. `frontend/src/session/read-completion.tsx` supplies browser visibility and React lifecycle bindings.
- `frontend/src/components/safe-markdown.ts`: shared, fixed Markdown rendering policy for conversation text, Ask history, and pending questionnaire previews.

## Behavior

The sidebar groups sessions into collapsible projects, ordered by recent activity, with stable folder colors and per-project **+** creation buttons. Each group initially shows five recent sessions plus running, waiting, unviewed, and selected sessions; older sessions expand per project. Titles use the session name or first user text, with relative timestamps. Blue marks running work, amber marks input requests, and green marks unviewed turns. Idle and read-only activity are separate from unread notifications. Saved title discovery reads bounded file prefixes and tails, so missing metadata falls back to **Untitled session**.

Opening session details fetches only that session’s tree, even while the panel is closed. The pinned header’s **Tree** button opens a right-side panel with search and **Show all entries**. By default it shows user prompts and nonempty assistant replies; tools and metadata remain available through the checkbox. The outline shows shared messages once and nests every child of a split at the same indentation, inside separate branch containers. Each sibling has the same heading, message count, and collapse control. Branches start expanded and preserve saved sibling order; active/preview badges do not change their layout. Linear conversations have no redundant root heading or folding. User rows have blue labels, tinted backgrounds, and accent bars; assistant rows use purple. The button counts leaves of the default projected conversation tree, unaffected by rewinding, search, or Show all entries. Metadata-only side paths therefore do not inflate the count, but remain inspectable with Show all entries. Search ignores collapses and retains matching entries with their ancestors, without overwriting collapse choices. A header control widens or narrows the panel. Opening the panel scrolls its own list to the active position, or to its nearest visible ancestor marked **active path** when the exact entry is filtered out. Entry clicks switch idle native Pi directly; unavailable sessions fall back to read-only previews. Desktop layout reserves space for the panel; on narrow screens it overlays the conversation. Escape or the close button closes it and restores focus to the Tree button. Sidebar chevrons appear for cached sessions with multiple paths and expand saved branch tips inside each session row. The sidebar never initiates tree requests, including during live invalidation; unvisited sessions have unknown branch information. Reload clears the browser cache. Pi labels take precedence over prompt previews. Branches have no independent running/unread badges; connected native Pi supplies a single active position. Offline or disconnected clients show saved paths without claiming a live selection. Forks stay separate session rows with **From …** origin hints where Pi records `parentSession` (also used for clones and explicitly parented sessions).

Branch links use `?branch=<entryId>`. An ordinary tree/sidebar click, **Branch from here**, or **Edit and branch** also creates a single-use in-memory selection intent. The selected page consumes that intent once, checks synchronized idle state, loads the target, rechecks identity/generation/expected leaf, then switches through the shared command lane without confirmation. Selecting the current native leaf simply returns to live view. Busy, disconnected, or guarded sessions stay in read-only preview; becoming idle, reconnecting, refreshing, or opening a preview URL does not authorize a later switch. Modified/new-tab clicks are preview-only. Switching affects every client and the native terminal; it does not restore files or request a summary. Selecting a user message rewinds before it and fills an empty composer with its text/images; existing drafts and edits during navigation are preserved. Unsupported attachment sets require native navigation. Rapid selections and page navigation invalidate stale preparations/restorations. The composer stays mounted, but sending and settings are disabled during preview. Previewing does not mark the live completion viewed. Browser fork creation is not implemented.

Completion/read state lives in relay SQLite and is shared across clients. The browser acknowledges the completion ID from its loaded snapshot only when synchronized, the tab is visible, and it is following the transcript bottom. Scrolling up or hiding the tab prevents automatic acknowledgment. Failures offer an explicit retry without replaying agent commands. Read-state broadcasts update metadata without reloading history. Relay restarts and reconnects preserve unread state. Existing saved history is not marked unread, and settlements while disconnected are not inferred.

The sidebar and session have independent viewport-height scroll areas. Sessions open at the end of the conversation and follow new content while near the bottom. Scrolling up pauses following so incoming output does not pull you away from older messages.

Saved records show **read-only**. Connected records show **live** and support prompt, steer, follow-up, and abort. The model input searches available models by name, provider, and ID. Pi scoped models (`enabledModels` / `--models`, exposed by `ctx.scopedModels`) appear first in a separate group; this is not a separate favorites store. Thinking uses a colored, keyboard-accessible slider over only the current model’s supported levels. Drag to preview and release to apply; keyboard changes apply on key release. Model/thinking changes require idle Pi with no queued messages or dialogs. Context usage remains display-only. Queue editing and unsupported dialog answers remain terminal-only.

The Ask User Question support module renders pending questionnaires below the transcript. Choose single/multiple options, add custom text and per-question/global notes, inspect available previews, then submit every answer or cancel the whole questionnaire. Native terminal input remains available and the first answer wins. Open questions survive transport reconnects; browser drafts are local UI state and can be lost on navigation/reload or a new native bridge generation. All extension actions use the existing guarded mutation path. See [support modules](../src/extension-support/README.md) for adding another extension without changing core relay code.

Attach PNG, JPEG, GIF, or WebP images using **Attach images**, clipboard paste, or drag-and-drop onto the composer. Preview and remove images before sending; image-only messages work too. Prompt, steer, and follow-up deliver structured image content through Pi’s public `sendUserMessage` API. The selected model must support images. Limits are four images and 4 MiB total decoded data per message, with a 6 MiB JSON request limit. Unsent images stay in memory across session navigation within the tab, but are not persisted across reload. Rejected/unknown submissions retain draft text and images; unknown outcomes still block resending until reviewed.

With the message box focused, **Alt+Enter** sends using the selected mode and **Esc** aborts. Plain Enter inserts a newline. Shortcuts obey the same availability checks as the buttons and are ignored during IME composition or key repeat. Abort does not clear queued messages.

The sidebar project selector and **New session**, or the **+** beside a project, launch native Pi in a dedicated tmux session. Saved sessions offer **Resume session**, with explicit confirmation that no external Pi writer remains. Managed tmux reservations are checked server-side before resume. Both operations wait for bridge registration before opening the session. Unknown outcomes block another launch until the user inspects the runtimes; tab-scoped storage preserves that guard across reloads. Connected Pim-managed runtimes offer **Stop runtime** without confirmation; acceptance is not proof of exit. Startup dialogs remain terminal-only; inspect with `tmux -L pim list-sessions` and attach with `tmux -L pim attach -t <name>`.

TanStack Query holds project/session queries. The shell subscribes only to connection status, so transcript events do not regroup or rerender the sidebar. Session events invalidate the inventory without refetching the static project list. The transcript skips metadata-only updates, and unchanged Markdown and tool payloads are memoized. Tool disclosures mount their bodies on first expansion and retain them afterward, preserving native toggling and nested disclosure state. The `LiveSession` store handles the selected snapshot and events. Native partial messages replace content authoritatively; no RPC delta reconstruction is needed.

Reconnects subscribe first, buffer events, load a snapshot, discard events at or before its epoch/cursor boundary, and apply newer events. Global cursors are checked even for other sessions. Connection/status/branch changes and settlement refresh the snapshot. Gaps, epoch changes, or buffer overflow require reconnecting.

Mutations never retry automatically. Request IDs and connection generations reject duplicates and stale commands. Dispatch is not execution completion. Unknown outcomes preserve the draft and block further commands until the user inspects and acknowledges uncertainty. Tab-scoped storage preserves drafts and protects against reload during submission.

Markdown uses the existing `react-markdown` library through `SafeMarkdown`, not a custom parser. The wrapper disables raw HTML, replaces Markdown images with `[image]` placeholders, and retains the library's default URL sanitizer. Callers cannot override this policy with plugins or component props. Structured raster image attachments render separately as validated inline data previews; SVG attachments are rejected. Closing the browser does not stop Pi.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm run test:frontend
```

For focused work, run only the affected files, for example:

```sh
node --experimental-strip-types --test --test-reporter=spec frontend/tests/live-status.test.mjs
```

`live.test.mjs` covers snapshot/reconnect boundaries; `live-status.test.mjs` covers metadata/lifecycle updates; `live-ask.test.mjs` covers questionnaire synchronization. HTTP behavior, shared validation, and transcript projection have separate `api`, `shared-contracts`, and `transcript-state` suites. They share `live-fixture.mjs` rather than duplicating transport setup.

Synchronization tests use mocked browser transport. Command-controller and launch-controller tests inject storage and dispatch to cover pending submissions, shared-button guards, reload protection, known rejections, unknown outcomes, and explicit review without a DOM or model calls. `client-mutations.test.mjs` adds async hydration/persistence, remount ordering, pre-dispatch lifecycle/generation changes, cleanup failures, and server isolation. These do not establish native storage or device behavior. Composer settlement tests cover draft/image retention and edits during submission. `draft-storage.test.mjs` checks async hydration/writes, remount settlement, storage failures, server isolation, and attachment persistence policy. Read-controller tests check one-attempt behavior, explicit retry, lifecycle eligibility, and out-of-order verdicts. Read eligibility tests cover synchronization, visibility, bottom-following, and loaded completion IDs. Markdown tests render the real wrapper with React's static renderer to check formatting, raw-HTML suppression, image placeholders, and unsafe links. These are focused state/markup tests, not browser DOM interaction coverage. The mocked scroll tests check controller decisions only.

For actual Chromium layout, run the separate opt-in check:

```sh
npm run test:browser
# Override the system Chromium executable when necessary:
CHROMIUM_BIN=/path/to/chromium npm run test:browser
```

This check runs the real scroll controller with native scrolling, ResizeObserver, and details toggles in an isolated page and temporary browser profile. It checks following content/viewport growth, preserving reader position, disclosure behavior, and cleanup. It requires an installed Chromium executable and a POSIX environment; it disables Chromium's sandbox for this local fixture only. It does not exercise the complete React application, real input devices, or native Pi. It is not included in `npm test`.

Relay tests use fake public Pi contexts and isolated files/transports without model calls. Ask module behavior is covered by fake-native bridge and mocked browser synchronization/draft tests. Real native-Pi integration remains unverified.
