# Pim

A web interface for your native Pi coding sessions. Follow agents, send messages, and manage conversations across projects from your browser.

Pi runs the agent and keeps its normal session files. Pim connects to that same runtime, so you can move between the terminal and browser without starting a second agent.

## Features

- Browse live and saved sessions, grouped by project.
- Archive sessions and restore them from the Archived view across browser and mobile.
- Follow streaming responses, tool activity, and code diffs.
- View images and interactive HTML artifacts such as charts, diagrams, and calculators.
- Send prompts, steer running agents, and attach images.
- Inspect queued steering/follow-up text and clear the native session queue.
- Use `/compact`, `/new`, discovered extension commands, and `/skill:name` from the composer.
- Search project files recursively and complete `@path` references.
- Switch models and thinking levels.
- Explore conversation branches and continue from earlier messages.
- Create, resume, and stop Pim-managed sessions.
- Track running agents, input requests, and unread completions across browsers.

The browser sidebar is wider and resizable by dragging its right edge (or focusing the edge and
using Left/Right arrows; Home resets). Search session titles or project paths and filter by
**All**, **Live**, **Saved**, or **Archived**. Create sessions with each project's **+** button.

Live Pim-managed sessions show **Stop runtime** instead of Archive. Stopping requires confirmation
and interrupts active work, but never archives automatically. Stop externally managed Pi in its
terminal. Disconnected sessions can be archived immediately, without tmux inspection or offline
confirmation. A disconnected Pi may still be running; archiving only hides the session and never
stops a process or deletes history.

Use **Archive** beside a disconnected session in the browser or mobile drawer to hide it.
Switch to **Archived** to restore hidden sessions before resuming their runtimes. History, unread
completions, drafts, and already-open conversations are preserved. Archive state is shared across
clients and survives relay restarts in Pim's SQLite database, separate from Pi's JSONL files.

Type `/` for compact, single-line command suggestions (five visible rows). Arrow keys select and
scroll the menu, Enter or Tab completes, and Escape closes suggestions without aborting Pi.
Full descriptions and terminal-interaction warnings are available in row tooltips. Send with
Alt+Enter or the Send button. `/compact` accepts optional summary instructions and requires idle Pi
with no queued messages or dialogs. `/new` creates a fresh native session in the current project
using the existing guarded launcher.

Type `@composer` to search across the project, without navigating folders first. Like Pi's `@`
completion, results rank exact filenames, filename prefixes, filename substrings, then path
substrings, with directory bonuses and shallower/shorter paths breaking ties. An existing directory
prefix scopes the recursive search, for example `@frontend/composer`. The menu shows the best 20
results with filenames and full paths. Requests are debounced and cancelled when superseded.
Git supplies tracked and non-ignored untracked paths, honoring nested rules and global excludes.
`.git`, symlinks, and stale index entries are omitted. Git must be available on the server; folders
outside a repository use a bounded recursive walk without Git ignore filtering. Search reads names
only, with no file-preview endpoint, and inserts textual references rather than contents or attachments.
Scans are capped at 100,000 entries, Git output at 8 MiB, and Git execution at five seconds.

Extension commands and skills come from the connected runtime's public command catalog. Internal
Pim commands and prompt templates are excluded. Dispatch requires idle Pi and confirms submission,
not command completion. Terminal-only dialogs still require the terminal. Compaction progress and
failures appear in the browser. Reload the Pi extension to enable the new native actions and catalog.
Focused fake-native, HTTP, and isolated Chromium checks pass; real-Pi integration remains unverified.

The browser renders saved edit patches for standalone tools and successful edits inside codemode.
The bridge captures nested patches through public Pi events and saves them in the parent result's
`details`, outside model-facing output. Nested diffs become available when the script finishes,
even if it fails after an edit succeeded. Capture requires the updated extension to be loaded;
older sessions keep argument previews. Each script retains at most 256 patches and 1 MiB of patch
text, with a notice when patches are omitted. Full nested tool results are not saved.
Fake-native capture and isolated Chromium rendering are tested; real-Pi integration is unverified.

Queue access uses an unsupported, isolated `AgentSession` prototype hook, verified with Pi 1.4.0.
It does not replace the TUI editor or start another runtime. Access initializes on native prompting
or queue rendering; unavailable access disables clearing. Clear removes all session-queued
messages, including attachments and queued extension messages, but never messages already
delivered. Copy text to the draft before clearing to revise and explicitly send again. Images
are not copied. Pi's separate TUI compaction-input queue is not exposed. Pi loads the extension
and its dependencies directly from TypeScript, so the hook imports the host Pi class rather than
a separate compiled SDK class. Bundled and unbundled Pi 1.4.0 source loading and queue access are
verified in isolated JSON-mode tests, including the separate global installation. No dependency
patch or fork is installed. Pim pins Pi dependencies to 1.4.0; the global `pi` used for launching
is installed separately. Full native TUI navigation and dialog integration remain unverified.

An iOS-first mobile app is also in development, with live/saved conversations, message and
image sending, abort, session creation/resume, model/thinking selection, and Ask User Question controls. See [mobile status](mobile/README.md) for
validation limits and remaining features.

## How it works

Pim has three parts:

- **Server:** runs on your machine and connects your Pi sessions to your clients.
- **Pi extension:** runs inside each native Pi session, sends updates to the server, and receives commands from it.
- **Clients:** the web frontend, Electron development shell, and iOS app connect to the same server. You can follow the same sessions from multiple devices. The iOS app supports core message controls and fresh-session creation.

```text
Pi + extension ─┐                  ┌─ Web browser
Pi + extension ─┼─ Pim server ─────┼─ Web browser
Pi + extension ─┘                  └─ iOS app
```

The agent always runs in Pi, not in the server or clients. Closing a client or the server does not stop your agents.

## Repository map

- `src/main.ts`: relay server entry point.
- `src/api/`: Fastify HTTP/WebSocket routes, shared security checks, and frontend serving.
- `extensions/pim/index.ts`: native Pi bridge entry point.
- `extensions/session-name/index.ts`: independent session-naming extension.
- `src/shared/`: browser-safe contracts and validators.
- `src/client/`: shared browser/mobile transport, synchronization, and controllers.
- `src/extension-support/`: explicit extension contracts and native/browser adapters.
- `frontend/src/`: browser UI and platform adapters.
- `mobile/src/`: Expo app, native UI, and platform adapters. See [mobile setup](mobile/README.md).
- `desktop/`: Electron app bundling the existing frontend. See [desktop setup](desktop/README.md).
- `tests/`, `frontend/tests/`, `mobile/tests/`: isolated tests for each surface.
- `AGENTS.md`: development rules and runtime-safety constraints.

Pim reads Pi history without opening another runtime. Its separate SQLite database stores
completion/read and archive metadata, not conversations. Disconnects never authorize a
second writer, and reconnects never replay mutations automatically. Managed resume checks
tmux reservations; external writers cannot be reliably detected and require explicit
offline confirmation. Real native-Pi integration remains unverified.

## Desktop development

Start the relay separately, then run `npm run desktop:start` to build and open the bundled
frontend in Electron. The UI loads locally at `pim-app://app/`; only API/WebSocket traffic goes to
the relay at `http://127.0.0.1:3141` (override with `PIM_DESKTOP_SERVER`). Add `pim-app://app` to
existing relay configurations' allowed origins. `npm run desktop:dev` uses Vite HMR instead.
Neither command starts Pi or owns agent lifetime. See [desktop setup and security limits](desktop/README.md).
Desktop **Settings > Appearance > UI scale** adjusts the whole UI and remembers the scale across
restarts. Keyboard and View-menu zoom controls use the same preference.
Tabs, native notifications, and production packaging are not implemented yet.

## Pi extensions

Both independently loadable extensions live under `extensions/`:

```text
extensions/
  pim/            Relay connection and native Pi controls
  session-name/   Automatic native session naming
```

With Pim's dependencies installed, symlink the bridge source folder into Pi's extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s /absolute/path/to/pim/extensions/pim ~/.pi/agent/extensions/pim
```

Pi discovers `extensions/pim/index.ts` and loads TypeScript through Jiti. No extension build or
separate loader shim is required. The relay server and frontend still use their normal builds.
Use only one Pim entry; replace older `pim.js` or `pim.ts` entries instead of keeping both.
If an existing `pim` symlink points to the old source location, retarget it:

```sh
ln -sfn /absolute/path/to/pim/extensions/pim ~/.pi/agent/extensions/pim
```

Reload or restart Pi after changing the entry; restarting the Pim server alone does not reload
extensions inside Pi. For copying later, preserve the source tree and installed dependencies:
`extensions/pim` imports shared and extension-support modules under `src/`.
`npm run build:server` type-checks and compiles both trees for tests, emitting `dist/src/` and
`dist/extensions/`. `npm start` runs `dist/src/main.js`. Native Pi still loads source, not build output.

## Automatic session names

The independent `extensions/session-name/index.ts` extension generates native Pi session names from the
first user message. It does not depend on Pim or tmux. Load it separately:

```sh
pi --extension /absolute/path/to/pim/extensions/session-name/index.ts
```

For persistent loading, symlink `extensions/session-name` into `~/.pi/agent/extensions/session-name`
and reload Pi. Keep the source tree and installed dependencies available, as with the bridge.
The existing terminal-title extension can remain installed; it serves a separate purpose.

`TITLE_MODEL` and `TITLE_THINKING` at the top select `openai-codex/gpt-6-luna` with thinking off.
The host Pi model registry must include that model and have working credentials. Naming runs
in the background with a 30-second timeout, at most 4,000 input characters and 128 output tokens.
Manual names are preserved, including names assigned during generation. Unnamed resumed sessions
use their original first user message on the next user run. Image-only messages wait for text.
A durable attempt marker prevents repeated calls after reload/resume, even if generation fails.
Missing models, failed requests, and invalid titles leave the normal fallback unchanged.
Timestamped text diagnostics are appended to `~/.pi/agent/auto-title.log` (or the agent directory
selected by `PI_CODING_AGENT_DIR`). Logs include session IDs, model, elapsed time, failures,
cancellation and skip reasons, but not prompts or generated titles. Provider error messages are
included for troubleshooting. Logging failures never interrupt the session.
The bridge forwards native name changes to connected clients immediately.
Focused fake-native tests pass; no paid model calls or real-Pi naming integration have been run.

## Home Assistant notifications

Optional iPhone alerts use your existing Home Assistant Companion app, not Pim's own APNs
credentials. Add this block to `pim.config.json` (omit it to disable notifications):

```json
"homeAssistant": {
  "url": "https://your-home-assistant-host",
  "service": "mobile_app_your_iphone"
}
```

Use the action name from HA Developer Tools without its `notify.` prefix. Create a long-lived
HA access token for a dedicated user, and provide it to the **relay process** as `PIM_HA_TOKEN`
through your local environment/service secret settings. Alternatively, set `PIM_HA_CREDENTIALS_FILE`
to an absolute path to a private JSON file containing `{"token":"..."}`. The environment token takes
precedence. Keep that file outside the repository with mode 600. Never put tokens in mobile settings,
source, or a browser bundle. Restart the relay after configuration changes. Prefer HTTPS; HTTP is
supported only for trusted private networks.

After a live `agent_settled` event, the relay waits ten seconds and sends an alert only if that
completion is still unread. Reading it in either browser or mobile suppresses the alert. Starting
another run cancels the previous pending alert; a newer completion gets a fresh ten-second delay.
Stopped/failed runs also count as completions. Reconnects and saved history do not send alerts.
Pending alerts are memory-only and discarded on relay restart. Failures are logged without credentials
or response bodies and are not retried. Requests time out after ten seconds; at most 32 alerts wait
and eight requests are in flight, with excess alerts skipped. Delivery is not guaranteed. The session
name is the notification title, with up to 200 characters of the final answer as the body (common
Markdown formatting stripped). Thinking and tool output are excluded; runs without answer text use
a generic completion message. Session titles and answer previews are sent to HA and may appear on
the lock screen. A robot icon uses Pim's purple accent background on supported iOS Companion app
versions; iOS controls the banner appearance. Notification tags replace earlier alerts for the same
session where HA supports it.

Tap links use `pim:///?session=<inventory-session-id>` and select that session on the mobile
app's **currently configured relay**. They never start/resume Pi or change the server address.
Install a native Pim build to register `pim://`; Expo Go does not register Pim's custom scheme.
See [mobile notification testing](mobile/README.md#notification-session-links) for the manual
HA test and Expo Go link alternative. iOS opens Home Assistant first, then redirects to Pim;
the first handoff may require confirmation. The action button uses the same handoff.

## Self-hosted

Designed for a trusted LAN or Tailscale network. There is no application authentication. Anyone who can reach the server can control connected agents, so do not expose it publicly.
