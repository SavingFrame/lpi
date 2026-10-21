# Pim

A web interface for your native Pi coding sessions. Follow agents, send messages, and manage conversations across projects from your browser.

Pi runs the agent and keeps its normal session files. Pim connects to that same runtime, so you can move between the terminal and browser without starting a second agent.

## Features

- Browse live and saved sessions, grouped by project.
- Follow streaming responses, tool activity, and code diffs.
- Send prompts, steer running agents, and attach images.
- Inspect queued steering/follow-up text and clear the native session queue.
- Switch models and thinking levels.
- Explore conversation branches and continue from earlier messages.
- Create, resume, and stop Pim-managed sessions.
- Track running agents, input requests, and unread completions across browsers.

The browser renders saved edit patches for standalone tools and successful edits inside codemode.
The bridge captures nested patches through public Pi events and saves them in the parent result's
`details`, outside model-facing output. Nested diffs become available when the script finishes,
even if it fails after an edit succeeded. Capture requires the updated extension to be loaded;
older sessions keep argument previews. Each script retains at most 256 patches and 1 MiB of patch
text, with a notice when patches are omitted. Full nested tool results are not saved.
Fake-native capture and isolated Chromium rendering are tested; real-Pi integration is unverified.

Queue access uses an unsupported, isolated `AgentSession` prototype hook, verified with Pi 1.3.0.
It does not replace the TUI editor or start another runtime. Access initializes on native prompting
or queue rendering; unavailable access disables clearing. Clear removes all session-queued
messages, including attachments and queued extension messages, but never messages already
delivered. Copy text to the draft before clearing to revise and explicitly send again. Images
are not copied. Pi's separate TUI compaction-input queue is not exposed. Pi loads the extension
and its dependencies directly from TypeScript, so the hook imports the host Pi class rather than
a separate compiled SDK class. Bundled and unbundled Pi 1.3.0 source loading and queue access are
verified in isolated JSON-mode tests. No dependency patch or fork is installed.

An iOS-first mobile app is also in development, currently with read-only session previews.

## How it works

Pim has three parts:

- **Server:** runs on your machine and connects your Pi sessions to your clients.
- **Pi extension:** runs inside each native Pi session, sends updates to the server, and receives commands from it.
- **Clients:** the web frontend and iOS app connect to the same server. You can follow the same sessions from multiple devices. The iOS app is currently read-only.

```text
Pi + extension ─┐                  ┌─ Web browser
Pi + extension ─┼─ Pim server ─────┼─ Web browser
Pi + extension ─┘                  └─ iOS app
```

The agent always runs in Pi, not in the server or clients. Closing a client or the server does not stop your agents.

## Pi extension entry

With Pim's dependencies installed, symlink the source folder into Pi's extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s /absolute/path/to/pim/src/bridge ~/.pi/agent/extensions/pim
```

Pi discovers `src/bridge/index.ts` and loads TypeScript through Jiti. No extension build or
separate loader shim is required. The relay server and frontend still use their normal builds.
Use only one Pim entry; replace older `pim.js` or `pim.ts` entries instead of keeping both.
Reload or restart Pi after changing the entry; restarting the Pim server alone does not reload
extensions inside Pi. For copying later, preserve the source tree and installed dependencies:
`src/bridge` also imports shared and extension-support modules from elsewhere under `src/`.

## Self-hosted

Designed for a trusted LAN or Tailscale network. There is no application authentication. Anyone who can reach the server can control connected agents, so do not expose it publicly.
