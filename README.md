# Pim

A single relay server and browser client for native Pi sessions. Pi runs the agent and writes its normal JSONL. Extensions connect to Pim to stream state and receive remote commands. Pim never opens another agent runtime.

## Run

Requires Node.js 22.19+, tmux 3.2+, and a global `pi` executable on the relay server's `PATH` for browser create/resume. The extension is typechecked against pinned **Pi 1.3.0**, with `pi-ai` pinned to the same version for model capabilities and shared types. These internal dependencies do not select the launched Pi version.

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

Adapt the path to your checkout. Loading the extension connects automatically to `ws://127.0.0.1:3141/bridge`. Set `PIM_BRIDGE_URL` to use another endpoint. The sidebar shows current activity: **running**, **blocked** (Pi needs input), or **idle**. Turn-completion notifications are separate from activity and do not imply task success. Disconnected sessions use a muted lock and **Saved** label instead of a live activity badge. They remain read-only because Pi may still be running.

The sidebar groups sessions into collapsible projects, ordered by recent activity, with stable folder colors and a **+** button to create a session in each project. Project headers summarize needs-input, running, and unviewed turns. Blue accents mark running sessions, amber marks input requests, and bright green checkmarks mark unviewed turns. Viewed completions retain a muted green checkmark when idle. Selection has a separate outline. Older sessions expand per project; running, waiting, unviewed completions, and the selected session stay visible within expanded project groups.

The browser receives full current-branch history, assistant partials, tool activity, runtime metadata, and queued-message presence. Compaction summaries appear at their chronological positions without hiding earlier messages. Context edits affect model context only; the transcript preserves original message content. Saved sessions and branch previews use the same history rules. Send automatically uses prompt while Pi is idle and steer while it is running, with no mode selector. Messages and abort run in that same native Pi process. Attach photos/screenshots using the image picker, clipboard paste, or drag-and-drop (PNG, JPEG, GIF, WebP; up to 4 images and 4 MiB total). Image-only messages are supported; the selected model must support images. A searchable model input and colored thinking slider control connected native Pi when idle with no queued messages or dialogs. The model picker groups Pi scoped models (`enabledModels` / `--models`) first, while keeping all available models selectable. Available models come from Pi's authenticated registry. Thinking options come from `pi-ai` model capabilities, including `max` where supported. Pi remains responsible for applying and clamping changes. Queue editing and unsupported dialog answers remain terminal-only.

Completed `edit` calls show applied changes with `@pierre/diffs`, including unified/split views, line numbers, syntax highlighting, and word-level changes. Edit calls appear outside generic tool groups and start expanded, showing applied changes or failure output immediately. They can be collapsed; raw arguments and output remain available under the diff. The viewer uses Pi's saved unified patch, not reconstructed arguments or current file contents. Results without a usable patch keep the ordinary output display. Nested codemode calls do not expose individual patches and retain their existing previews.

`/pim-disconnect` stops the relay connection without stopping Pi. Closing the browser or Pim does not stop the agent. Closing Pi does.

## Branches and related sessions

Opening session details fetches that session's saved tree. Click **Tree** in the pinned header to open a searchable right-side panel. The button shows the saved conversation branch count, independent of native rewinds and display filters. A nested outline shows shared history once, then groups every child branch at equal indentation beneath its common parent. Both sides of a split have the same expand/collapse controls and start expanded. Active and preview badges do not reorder branches or change their hierarchy. Linear messages stay aligned, with no root heading or message folding. User rows use blue labels and tinted backgrounds; assistant rows use purple. The count uses the default conversation projection, so metadata-only side paths do not count as extra conversation branches. Search reveals matching entries and their ancestors regardless of collapse settings. The header's widen control gives previews more room. **Show all entries** includes tools and metadata. The panel scrolls to the active position when opened; if that entry is hidden, its nearest visible ancestor is marked **active path**. On narrow screens the panel overlays the conversation; close it with its close button or Escape. The sidebar never fetches trees: after visiting a session, it reuses the cached tree to show expandable branches. Unvisited sessions have unknown branch information. Reload clears this cache and fetches only the open session's tree. In the sidebar, linear stretches collapse into branch tips, using Pi labels or prompt previews. Only the session row has running/unread status; connected Pi's current position has an **active** marker. Disconnected records show saved paths without claiming an active position.

Click a tree/sidebar entry, **Branch from here** on an assistant message, or **Edit and branch** on a user message to switch directly when Pi is synchronized and idle, with no queued messages or dialogs. No confirmation is required. The switch affects the same native runtime, its terminal, and every attached client. Clicking the active entry simply returns to the live conversation. User-message selection resumes before that message and fills an empty composer with its text/images; existing unsent drafts are kept. Busy, disconnected, and uncertain sessions show read-only previews instead. These clicks are not replayed when Pi becomes idle or reconnects; select again to switch. Opening/reloading a preview URL alone never moves Pi. Preview mode disables sending and does not mark the current completion viewed. Files are not restored, and no model-generated branch summary is requested.

Forks remain separate session rows, showing **From …** when Pi's `parentSession` header is available. Pi also records this origin for clones and explicitly parented sessions, so Pim does not claim every derived session is a fork. Create forks in native Pi; browser fork creation and automatic parallel launching are not implemented. Branch previews read persisted JSONL under the existing 32 MiB bound, so unfinished or not-yet-persisted history may be unavailable. Rebuild/restart Pim and reload its bridge in native Pi while idle after updating. Real native-Pi integration remains unverified.

## Shared read status

Pim stores relay-owned data in SQLite at `~/.local/state/pim/pim.sqlite`. Currently this contains completion/read metadata. Set `PIM_STATE_DIR` to override the directory. This uses Node's built-in `node:sqlite` (experimental on Node 22), with no additional database dependency. Pi's conversation JSONL is never modified.

Each observed `agent_settled` event receives a durable opaque completion ID. The database tracks the latest completion and last-viewed completion per session, shared across browser and future mobile clients without accounts. The browser marks only the completion loaded in its transcript viewed, while the tab is visible and following the bottom. Read changes broadcast to connected clients. A stale acknowledgment cannot clear a newer completion.

Read status survives relay restarts and native reconnects. Existing saved history starts without unread notifications. Turns ending while Pim is disconnected are not reconstructed from JSONL. These are session-level turn-ended notifications, not task-success or branch-specific read receipts.

## Extension support

Browser support is explicit, with one module per extension under
[`src/extension-support/`](src/extension-support/README.md). Ordinary tools still run in
native Pi without an adapter; custom terminal UI does not automatically become a web UI.

The first module supports **`@juicesharp/rpiv-ask-user-question`** (`ask_user_question`),
using its public event contract inspected at version 2.13.9. Questions appear below the
transcript with single/multi-select, custom answers, notes, previews, and cancellation.
Answer in the browser or native terminal; the extension accepts only the first answer.
Pending questions survive bridge reconnects. Unknown answer outcomes are never replayed.
Install/load the Ask extension normally in Pi, then rebuild Pim, restart the relay, and
reload its bridge in native Pi while idle. Refresh the browser to load the new client.
Pim does not install extensions or replace their tools. Other extensions need their own
support module. Real native-Pi integration remains unverified.

## Create or resume from the browser

Click **+** beside a project, or choose a project in the sidebar and click **New session**. For saved history, open the session and click **Resume session**. Pim starts global `pi` using the relay server's `PATH` in a detached tmux session, then waits for its bridge to register. The relay explicitly passes its `PATH` with `node_modules/.bin` entries removed, so `npm start` cannot select Pim's local Pi and an existing tmux server does not retain an older executable search path. The bridge must already be enabled through Pi’s global extension configuration. Pim does not pass `--extension`, avoiding duplicate loading. The explicit command above is only for instances without the bridge globally configured. Project-trust prompts and other startup dialogs must be answered in the terminal.

All managed runtimes use the dedicated `pim` socket, separate from your regular tmux server:

```sh
tmux -L pim list-sessions
tmux -L pim attach -t pim-<launch-id>
```

Detach with Ctrl+b, then d. The terminal and browser control the same native runtime. Closing Pim leaves tmux and Pi running; bridges reconnect automatically when the relay returns.

Resume refuses files reserved by managed runtimes, even while their bridges are disconnected. Reservations survive relay restarts and conservatively retain every file opened in that tmux session. A runtime that has not registered a file blocks resume until inspected. For externally launched Pi, confirm it has stopped before resuming. This is not a general filesystem lock or ownership coordinator.

Startup timeouts and lost responses are uncertain outcomes. Inspect recent sessions and tmux before trying again. No automatic launch replay is provided. For connected Pim-managed runtimes, **Stop runtime** requests graceful Pi shutdown after confirmation, interrupting active work without deleting history. Pi exit normally removes its dedicated tmux session. Acceptance is not proof of exit; resume still checks tmux reservations. Externally launched runtimes must be stopped in their terminal. Real native-Pi integration remains unverified. See [the plan](PLAN.md).

The browser applies live message, lifecycle, and status metadata updates directly from WebSocket events. HTTP snapshots establish initial/reconnected state and reconcile explicit native branch syncs. Background snapshot refreshes keep the existing transcript visible.

## Frontend development

The browser uses React, Vite, Tailwind CSS v4, and locally owned shadcn/ui components with a dark zinc theme and Lucide icons. Markdown uses `react-markdown` through one shared safe-rendering component, with raw HTML disabled, image placeholders, and the library's default URL sanitizer.

Production CSP allows inline CSS for the diff viewer's shadow-DOM styles and syntax tokens. Inline scripts, eval, and external script/style sources remain blocked.

Run the compiled server, then `npm run dev`. Open **http://127.0.0.1:5173**. Vite proxies REST/events to port 3141. Set `PIM_DEV_SERVER` for another target and update configured allowed origins when changing ports.

## Mobile app (read-only scaffold)

The iOS-first Expo/Tamagui app in `mobile/` has connection setup, a grouped project/session
drawer, persistent server/selection settings, and plain-text conversation previews using
the shared transport. From the root, run `npm run start --workspace @pim/mobile` after
installing dependencies. See the [mobile overview](mobile/README.md) for network setup,
validation commands, dependency audit limitations, and features still pending.

Mobile typechecks, mocked lifecycle tests, and iOS JavaScript bundle export pass. Expo Go
connection-screen startup is verified on an iPhone 15 simulator. Custom native builds,
device layout/networking, and real-Pi integration remain unverified. Sending,
create/resume, read acknowledgments, and mobile extension rendering are not enabled yet.
The [implementation plan](mobile/PLAN.md) tracks the remaining stages.

## Layout

- `src/bridge/`: native extension entry point and server-side relay transport. Native state, commands, transport lifecycle, and image-entry rendering live in `src/bridge/native/`.
- `src/extension-support/`: per-extension native bindings, contracts, browser components, and tests.
- `src/sessions.ts`: combined saved/live inventory and snapshots.
- `src/storage/`: read-only JSONL discovery and stable inventory IDs.
- `src/api/`: REST commands, bounded browser events, and static assets.
- `src/client/`: framework-independent transport, synchronization, server-scoped mutation/draft storage, inventory projections, and read-completion controllers. See [client behavior](src/client/README.md).
- `src/shared/`: browser-safe project/session/command/snapshot contracts, wire validators, and pure event/status projections. See [shared contracts](src/shared/README.md).
- `frontend/`: React/Vite browser and focused tests. Session layout, composer bindings, branch navigation, and scroll lifecycle live in `frontend/src/session/`. Shared client behavior lives in `src/client/`; ordered styles live under `frontend/src/styles/`, imported by `style.css`.
- `mobile/`: Expo Router/Tamagui workspace, native platform adapters, read-only app shell, and isolated tests.
- `tests/`: isolated relay, discovery, configuration, and API tests.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm test
```

Tests use temporary files, fake Pi contexts, and local/mocked transports without model calls. Run only affected test files during development; see [test scope and suite selection](tests/README.md). The npm test scripts use concise output with detailed failures.

`npm run test:browser` separately checks scroll behavior with real Chromium layout in an isolated fixture. It requires installed Chromium (`CHROMIUM_BIN` overrides the executable), uses a temporary profile, and is not part of `npm test`. See [browser validation](docs/frontend.md#validation) for scope and requirements. Real-Pi integration remains unverified.

Run `node --experimental-strip-types --test frontend/tests/browser/edit-diff.mjs` for the isolated Chromium diff-viewer regression. It serves the fixture through Pim's production static-file handler and checks CSP, visible rows, view switching, escaping, and raw-output fallback.

See [server API](docs/server.md), [bridge setup](docs/bridge.md), and [frontend notes](docs/frontend.md).
