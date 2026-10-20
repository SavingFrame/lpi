# Native Pi relay plan

## Goal

Use the same native Pi runtime from its terminal, a browser, and eventually iOS.
Pi executes the agent and writes normal JSONL. Pim is a single server that discovers saved sessions and relays data between connected extensions and clients.

```text
Browser / iOS
      ↕
Single Pim server
      ↕
Pi extension    Pi extension    Pi extension
      |               |               |
Native Pi       Native Pi       Native Pi
(normal terminal or tmux)
```

There is no RPC runtime, writable managed catalog, ownership coordinator, parking session, or runtime handoff. Each extension makes an outbound connection to the same server. Extensions do not host individual web servers.

## Implemented

- Configured project discovery and read-only saved-session inventory.
- Bounded JSONL inspection through Pi's pure parsing/context helpers, without opening a runtime.
- Opt-in native extension with token-free WebSocket transport on a trusted LAN/Tailscale network.
- Current-branch snapshots, assistant partials, tool activity, model/thinking/context metadata, and queued-message presence.
- Searchable browser model picker with Pi scoped-model grouping and a colored, supported-level thinking slider through public Pi APIs, gated on idle state with no queued messages or dialogs. Model availability comes from the native registry; thinking options come from `pi-ai` model capabilities, including model-specific mappings and `max`. Pi applies and clamps changes.
- Browser prompt, steering, follow-up, and abort routed into the connected native Pi runtime, including image attachments from file selection, paste, or drag-and-drop.
- One React/Vite browser client with snapshot/event reconnect synchronization.
- Connection generations, request correlation, bounded delivery, and unknown mutation outcomes without automatic replay.
- Deterministic tests using temporary files, fake public Pi contexts, local transports, and mocked browser transport. No model calls.

Real native Pi with the installed extension set remains unverified.

## Core constraints

- Native Pi is the only agent runtime and session-file writer. Pim reads history, never writes conversations.
- Saved files and live connections are different things. A disconnected instance may still be executing.
- Server or browser disconnects do not stop Pi.
- Connection generations reject stale commands; they are not runtime ownership claims or filesystem locks.
- Reject simultaneous bridge registrations for the same canonical session path. This detects connected duplicates, not arbitrary Pi processes outside the bridge.
- Do not automatically reopen an existing file after a connection loss.
- JSONL preserves history, not checkpointed recovery of unfinished tools.
- Remote commands use public extension APIs. No unrestricted shell or terminal-input proxy is planned.
- LAN/Tailscale clients are trusted. No application authentication or bridge token. Network access control belongs to deployment; Host/Origin checks remain enforced.

## Native Pi launching in tmux

Implemented, with real-Pi integration still unverified:

- Browser project selection and fresh session creation through native Pi.
- Saved-session Resume uses the existing JSONL file after identity/history validation.
- A dedicated `tmux -L pim` server with one detached session per runtime.
- The pinned native Pi CLI loads the bridge through existing global Pi extension configuration and registers with a correlated launch ID. The launcher does not pass `--extension`.
- Launches wait for registration and report failed or uncertain startup without automatic replay.
- Managed extensions reserve canonical file IDs in tmux before registration. Reservations survive relay restarts and accumulate across TUI session switches until the tmux session exits.
- Resume checks all managed reservations and blocks while any runtime is unregistered. External Pi writers cannot be detected reliably, so resume requires explicit offline confirmation.
- Attaching to tmux reveals the same native TUI and runtime the browser controls.
- Pi remains alive independently of browser and relay connections. Browser Stop runtime requests graceful shutdown for connected Pim-managed runtimes after confirmation, without deleting history. It aborts active work; acknowledgment is not proof of exit. Managed resume still checks tmux reservations.
- Launching stays separate from transport and read-only discovery.

## Later

- Refresh saved-session discovery without restarting the relay.
- Remote questions and approvals through explicit adapters while preserving native UI.
- Remote queue inspection/editing and additional supported commands.
- A separate iOS client over the trusted network.
- Real-Pi integration coverage for lifecycle, reload, branch navigation, compaction, pending dialogs, and reconnects.

Custom terminal UI does not automatically translate to a browser interface. Abort is not assumed to dismiss a pending dialog.

## Removed architecture

The former server-owned RPC runtimes, managed ownership catalog/locks, offline recovery, and native TUI parking/handoff prototype were removed. They are not part of the current product or future implementation plan.
