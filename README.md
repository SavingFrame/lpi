# Pim

A web interface for your native Pi coding sessions. Follow agents, send messages, and manage conversations across projects from your browser.

Pi runs the agent and keeps its normal session files. Pim connects to that same runtime, so you can move between the terminal and browser without starting a second agent.

## Features

- Browse live and saved sessions, grouped by project.
- Archive sessions and restore them from the Archived view across browser and mobile.
- Follow streaming responses, tool activity, and code diffs.
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
- **Clients:** the web frontend and iOS app connect to the same server. You can follow the same sessions from multiple devices. The iOS app supports core message controls and fresh-session creation.

```text
Pi + extension ─┐                  ┌─ Web browser
Pi + extension ─┼─ Pim server ─────┼─ Web browser
Pi + extension ─┘                  └─ iOS app
```

The agent always runs in Pi, not in the server or clients. Closing a client or the server does not stop your agents.

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
The bridge forwards native name changes to connected clients immediately.
Focused fake-native tests pass; no paid model calls or real-Pi naming integration have been run.

## Self-hosted

Designed for a trusted LAN or Tailscale network. There is no application authentication. Anyone who can reach the server can control connected agents, so do not expose it publicly.
