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
- Opt-in native extension with token-free WebSocket transport on a trusted LAN/Tailscale network. Pi loads `src/bridge/index.ts` from a symlinked source folder through Jiti, including the native adapter's host `AgentSession` import. No extension build, separate loader shim, or host-class injection is needed. The bridge wires separate native session-state, command-dispatch, transport, and image-entry rendering modules; session state survives transport disconnects.
- Full current-branch transcript snapshots, assistant partials, tool activity, model/thinking/context metadata, and queued-message presence. Live snapshots, saved sessions, and branch previews preserve original messages across compaction and context edits, with compaction summaries in chronological order rather than replacing history.
- Searchable browser model picker with Pi scoped-model grouping and a colored, supported-level thinking slider through public Pi APIs, gated on idle state with no queued messages or dialogs. Model availability comes from the native registry; thinking options come from `pi-ai` model capabilities, including model-specific mappings and `max`. Pi applies and clamps changes.
- Browser queue inspection and clear-all cancellation through an isolated, unsupported `AgentSession` hook. Queue snapshots carry revisions so stale clear requests reject; copied text appends to the existing draft and resending is explicit. Attachments are cleared but not copied; Pi's separate TUI compaction-input queue is excluded. Queue access can remain unavailable until native prompting/queue rendering captures the matching session. Isolated real-Pi JSON-mode queue behavior was verified with a fake provider for local bundled/unbundled launchers and a separate global installation, through a symlinked source folder with no compiled-extension imports; full TUI/bridge integration remains unverified.
- Browser messages automatically use prompt while Pi is idle and steer while running, with no mode selector. Messages and abort route into the connected native Pi runtime, including image attachments from file selection, paste, or drag-and-drop. The relay also supports explicit follow-up commands.
- One React/Vite browser client with snapshot/event reconnect synchronization. Live status metadata and lifecycle events update locally; HTTP snapshots remain for initial load, reconnects, generation changes, and explicit branch syncs. Tab-wide launch guards use a separate tested controller; composer acceptance and read eligibility have pure state helpers. Ordered feature styles retain the existing cascade, and one `react-markdown` wrapper enforces the transcript/extension Markdown policy.
- Project-grouped, collapsible sidebar with per-project session creation, stable folder colors, relative timestamps, project activity counts, and distinct running/input/completion accents. Selection is visually separate from activity. Live activity is running, blocked on a native dialog, idle, or unavailable when disconnected (shown as a saved/read-only session). Turn-ended notifications are separate from runtime activity and do not imply task success.
- Session-detail tree loading and a searchable right-side tree panel (conversation entries by default, optional tools/metadata, nested branch groups with equal sibling indentation and collapse controls, fully visible linear conversations, distinct user/assistant row colors, projected conversation-tip branch counts, wider-panel toggle, active-path navigation), with expandable sidebar branches derived passively from the same browser cache (no per-session sidebar tree requests), native labels/prompt previews, explicit active-position markers only for connected runtimes, and parent-session origin hints on separate fork/clone/derived session rows. Explicit tree/sidebar/per-message clicks switch the existing synchronized, idle native runtime directly, without a confirmation step, through public command-context navigation with generation/identity/expected-leaf checks and completion/cancellation acknowledgments. Busy/disconnected clicks and plain preview URLs stay read-only, without deferred switching or automatic replay. User-message navigation fills only an empty composer, preserving unsent drafts. Entry provenance survives compaction/context edits. Preview mode blocks sending and read acknowledgment; no file rollback, model-generated summary, browser fork creation, or parallel runtime launch is implied. Fake-native and read-only HTTP coverage passes; real native-Pi integration remains unverified.
- Browser edit-result viewers using `@pierre/diffs` and Pi's saved unified patches, with unified/split views, syntax/word highlighting, standalone edit calls expanded by default, and raw-output fallback. Ordinary tools remain grouped with lazy disclosure mounting. No file reads, reconstructed edits, or native runtime changes. Nested codemode calls retain preview-only metadata. Isolated Chromium coverage checks rendering and layout; real native-Pi integration remains unverified.
- Shared, durable session-level completion/read metadata in a separate SQLite database (`PIM_STATE_DIR` or `~/.local/state/pim/pim.sqlite`), using built-in `node:sqlite`. Observed settlement creates an opaque completion ID; conditional viewed acknowledgments cannot clear a newer completion. Read changes broadcast to all clients. Browser acknowledgment requires a loaded transcript, visible tab, and following the bottom. Restarts/reconnects preserve read status; historical/offline settlements are not inferred from saved JSONL.
- Explicit per-extension support modules with separate shared/native/browser registrations. Ask User Question (`@juicesharp/rpiv-ask-user-question`, public contract inspected at 2.13.9) supports browser selections, custom text, notes, previews, and cancellation through public events, preserving native UI. Pending questions survive transport reconnects; answers require authoritative verdicts and are never automatically replayed. Coverage uses fake native contexts and mocked browser transport; real native-Pi integration remains unverified.
- Browser-safe shared contracts and validators under `src/shared/`, with common native-event/status projection for relay and browser caches. Frontend types do not depend on server implementations; extension-specific contracts remain in support modules.
- Connection generations, request correlation, bounded delivery, and unknown mutation outcomes without automatic replay.
- Deterministic tests using temporary files, fake public Pi contexts, local transports, and mocked browser transport. Relay and browser suites are separated by behavior with shared fixtures. A separate opt-in Chromium check verifies scroll-controller behavior with real layout in an isolated page, not the complete React application or native Pi. No model calls.

Real native Pi with the installed extension set remains unverified.

## Core constraints

- Native Pi is the only agent runtime and session-file writer. Pim reads history, never writes conversations. Its SQLite database stores relay-owned data, currently completion/read metadata, not Pi conversation history.
- Saved files and live connections are different things. A disconnected instance may still be executing.
- Server or browser disconnects do not stop Pi.
- Connection generations reject stale commands; they are not runtime ownership claims or filesystem locks.
- Reject simultaneous bridge registrations for the same canonical session path. This detects connected duplicates, not arbitrary Pi processes outside the bridge.
- Do not automatically reopen an existing file after a connection loss.
- JSONL preserves history, not checkpointed recovery of unfinished tools.
- Remote commands use public extension APIs except the explicitly accepted queue adapter: it captures the existing `AgentSession` through prototype hooks to read/clear its actual queue. This unsupported exception was tested against Pi 1.3.0 in isolated JSON mode with a fake provider. It needs upgrade regression coverage; no runtime creation, dependency patch, TUI replacement, unrestricted shell, or terminal-input proxy is introduced.
- LAN/Tailscale clients are trusted. No application authentication or bridge token. Network access control belongs to deployment; Host/Origin checks remain enforced.

## Native Pi launching in tmux

Implemented, with real-Pi integration still unverified:

- Browser project selection and fresh session creation through native Pi.
- Saved-session Resume uses the existing JSONL file after identity/history validation.
- A dedicated `tmux -L pim` server with one detached session per runtime.
- Global `pi` from the relay server's explicitly forwarded `PATH` loads the bridge through existing global Pi extension configuration and registers with a correlated launch ID. Pinned internal Pi dependencies are separate from the launched runtime. The launcher does not pass `--extension`.
- Launches wait for registration and report failed or uncertain startup without automatic replay.
- Managed extensions reserve canonical file IDs in tmux before registration. Reservations survive relay restarts and accumulate across TUI session switches until the tmux session exits.
- Resume checks all managed reservations and blocks while any runtime is unregistered. External Pi writers cannot be detected reliably, so resume requires explicit offline confirmation.
- Attaching to tmux reveals the same native TUI and runtime the browser controls.
- Pi remains alive independently of browser and relay connections. Browser Stop runtime requests graceful shutdown for connected Pim-managed runtimes after confirmation, without deleting history. It aborts active work; acknowledgment is not proof of exit. Managed resume still checks tmux reservations.
- Launching stays separate from transport and read-only discovery.

## Mobile client and shared-client refactor (in progress)

An iOS-first React Native + Expo + Tamagui client is being developed over the trusted
LAN/Tailscale network. Its detailed scope, navigation, shared-client architecture, delivery stages, and
validation requirements live in [mobile/PLAN.md](mobile/PLAN.md); see also the
[mobile overview](mobile/README.md). The mobile npm workspace now contains a read-only scaffold.

The work includes extracting shared browser/mobile behavior with platform adapters and
migrating browser consumers. Backend/API changes are allowed when they simplify both
clients, while preserving existing browser functionality and all runtime-safety constraints.
Validated HTTP transport, snapshot/event synchronization, and command/launch guards now
live in `src/client/`, consumed by browser adapters. Guards support async storage, wait for
hydration, persist before dispatch, and isolate markers by server. Async writes recheck
command generation/connectivity and launch eligibility before dispatch. Server-scoped
async draft persistence/settlement, inventory grouping/visibility, and read eligibility/
acknowledgment controllers are shared and consumed by the browser. Questionnaire draft
helpers are framework-independent under extension support. Native fetch/WebSocket and
AsyncStorage adapters now power connection setup, the project/session drawer, selection
restoration, foreground resynchronization, and plain-text conversation previews. Mobile
mutation controls, read acknowledgments, rich rendering, and explicit extension
registration remain pending. Typechecking, mocked transport/lifecycle tests, and iOS
JavaScript bundle export pass. Expo Go connection-screen startup is verified on an
iPhone 15 simulator (iOS 17, Xcode 27.1). No custom native build, device/network verification,
or real-Pi integration has been completed. Upstream toolchain audit issues and Metro export warnings
are recorded in the mobile README.

## Later

- Refresh saved-session discovery without restarting the relay.
- Additional extension support modules, including approvals where public APIs permit, while preserving native UI.
- Additional supported commands and upstream public extension queue access.
- Mobile capabilities beyond the [initial core scope](mobile/PLAN.md#product-and-navigation).
- Real-Pi integration coverage for lifecycle, reload, branch navigation, compaction, pending dialogs, and reconnects.

Custom terminal UI does not automatically translate to a browser interface. Abort is not assumed to dismiss a pending dialog.

## Removed architecture

The former server-owned RPC runtimes, managed ownership catalog/locks, offline recovery, and native TUI parking/handoff prototype were removed. They are not part of the current product or future implementation plan.
