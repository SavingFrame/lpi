# Pi server and shared-session plan

## Goal

Run a personal agent server on the PC and use the same normal Pi sessions from the native Pi TUI, a browser, and an iOS app. Sessions can start on any of these interfaces.

Use normal Pi's long-lived RPC mode for server-owned runtimes, not Pi Durable or Pi's experimental server/client packages. Keep normal JSONL persistence and reuse extensions. SDK access remains an option for a specific capability missing from RPC, not the default backend.

Native TUI continuity is a core requirement. Validate bidirectional handoff before investing in the browser. This is a single-user system across multiple devices, not a multi-user service.

## Verified baseline

An isolated spike against Pi 1.0.4 and `openai-codex/gpt-6.1-sol` verified:

- The installed `rpiv-ask-user-question` extension works over RPC. Single-select, numeric-input multi-select, cancellation, and model continuation passed.
- A persisted session can move sequentially from RPC to native TUI and back, with history and a TUI-added message preserved. Each previous owner exited before the next opened the session.
- A public extension command can replace a session and use the fresh `withSession` context (tested in RPC).
- Blocking `input` does not block extension slash commands or model metadata writes. Input suppression is not read-only enforcement.
- RPC configuration commands can change global settings. Temporary session storage does not isolate configuration. The spike's unintended retry override was restored.

The original spike did not prove live handoff. The checked-in prototype subsequently verified public-API parking and reclaim in the same native TUI process, with RPC owning the released session in between. It also rejected cancelled/stale release requests and verified that a parked TUI write left the managed file unchanged. These lifecycle tests use deterministic fixtures and no model calls.

Neither test proves production locking, full installed extension compatibility, crash recovery, or remote interaction with native TUI custom dialogs.

Phase 1 is complete as a feasibility gate: the bounded native-TUI handoff prototype under `prototypes/handoff/` passes against Pi 1.0.4 in both fullscreen and regular TUI modes. Its eight unit tests also pass. See its README for reproduction and limitations.

Current development: the Phase 2 server-owned backend is implemented under `src/`, with separate API, RPC transport, catalog, ownership, and runtime orchestration modules. It uses Node HTTP plus WebSocket events, existing Pi configuration, a single exclusive coordinator lock, generation-checked claims, supervised shutdown, and explicit offline recovery. Deterministic backend tests use fake RPC children with isolated HOME/configuration and no model calls. `docs/server.md`, `docs/ownership.md`, and `docs/configuration-audit.md` describe the current contract and limitations. Managed CLI access is intentionally blocked; its launcher/bridge contract is defined for Phase 3. Real-Pi integration and broader installed-extension/configuration audits remain unverified. A React/Vite browser client now exists under `frontend/`, using TanStack Query and Router. It supports server-owned sessions and snapshot/event reconnect synchronization. Dialog answers remain deferred, and iOS will be a separate project. Existing Pi session discovery now reads original JSONL files from configured `piSessionRoots` and displays persisted history in the browser. These files remain read-only, outside the ownership catalog, with unknown ownership. The selected Phase 3 direction is original-file integration through a full managed native TUI launcher/bridge; discovery is only its first slice, not coordinated adoption or handoff.

## Core constraints

- One owning runtime per managed session. Merely being idle does not release ownership.
- Opening the same JSONL file in two runtimes does not synchronize messages, branches, queues, or agents.
- Confirmed unowned and ownership unknown/unavailable are different states. Unknown ownership must not authorize a second writer.
- Claims must be coordinated atomically. A lost connection is not proof that an old writer stopped.
- Ownership records and generations coordinate participating processes; they do not fence a process that writes files directly. This is cooperative protection, not a sandbox against arbitrary extensions or a CLI launched without the bridge.
- The unmodified native TUI cannot attach to an RPC agent as its native runtime.
- JSONL preserves conversation history, not checkpointed recovery of unfinished work. No Durable-style execution recovery is planned.

## Architecture

```text
Browser / iOS
      |
      v
PC TypeScript server
      |
      +-- Session catalog, ownership coordination, client API
      |
      +-- pi --mode rpc subprocess per server-owned active session
      |
      +-- Bridge to an extension in a TUI-owned native Pi process

Native Pi TUI + bridge extension
      |
      +-- Local runtime when TUI owns the session
      |
      +-- Detached parking session when server owns the session
           Optional extension-managed remote view later
```

The server owns RPC child lifetime independently of browser/phone connections. RPC uses JSONL over stdin/stdout; it is not itself a network server. Keep a small application API around it rather than exposing unrestricted RPC directly.

### Server-owned

- Browser/iOS prompts execute in the server-managed RPC process.
- Supported extension UI requests are forwarded to clients and responses correlated by ID.
- Closing the terminal does not stop the server-owned agent.
- The native TUI must release its runtime for the managed file before RPC opens it. Prototype switching to a separate parking session instead of retaining a stale runtime with a disabled editor.
- Remote output need not appear in Pi's native transcript while parked. Reopening the session restores the native transcript after reclaim.

### TUI-owned

- Native Pi runs the local agent and persists the session.
- The bridge registers ownership, forwards events/state, and accepts remote prompts/controls.
- Closing Pi ends that runtime. Uninterrupted background work requires explicit handoff before exit.
- Reopening after a confirmed process exit can continue the conversation, but not transparently resume unfinished tools.

## Safe handoff

1. Serialize the transfer and reject new mutating requests for the outgoing owner.
2. Resolve pending dialogs and queued work explicitly. For the first prototype, require idle state and empty queues instead of migrating active work.
3. Use supported settled/idle APIs, not `agent_end` alone. Retries, compaction, and follow-ups may continue after `agent_end`.
4. Release the outgoing runtime. For TUI-to-server, confirm replacement with a separate parking session and teardown of the old session. For server-to-TUI, stop the RPC child and await its exit.
5. Only then let the incoming runtime reopen the persisted session.
6. Publish the new owner/generation and refresh client state from that owner.

A failed or ambiguous transfer must not silently grant ownership. Session replacement can fail after tearing down the old runtime; distinguish rejection, completed release, and unknown outcomes.

Validate what survives: active branch (including navigation without a subsequent message), model/thinking, active tools, extension state, queues, pending dialogs, and editor drafts. Persisted history is not the entire runtime. Initial handoff may reject unsupported state rather than silently lose it.

## Development phases

### 1. Native TUI handoff feasibility gate

Build a small isolated prototype, not a production server:

- Keep one native TUI process alive throughout TUI-to-RPC-to-TUI transfer.
- Use public extension command/session replacement APIs to park and reclaim.
- Require confirmed release before starting RPC, and confirmed RPC exit before reclaim.
- Verify that commands issued in the parked TUI affect only its parking session, not the server-owned session.
- Verify history after reclaim and reject stale/cancelled transfer attempts.
- Isolate the entire Pi agent directory, configuration, session files, and extensions. Use deterministic markers with no model calls for lifecycle tests.
- Document cooperative limitations, startup writes, failure handling, and unsupported extension background work.

If public APIs cannot reliably release/reopen the runtime, revisit terminal integration before promising native TUI continuity.

### 2. Minimal server-owned RPC backend and ownership coordinator

- Persistent TypeScript server, configured project roots with immediate-child discovery, and session catalog.
- Discovery accepts non-Git folders, expands home-relative roots, deduplicates canonical paths, and derives stable project IDs from those paths. Configured roots are containers; discovery refreshes on server restart.
- One long-lived RPC subprocess per active server-owned session.
- Bounded continuous stdout/stderr consumption, request correlation, startup failure and exit handling.
- Prompts, steering, follow-ups, abort, session inspection, and normal JSONL persistence.
- Define the managed-session launcher/bridge contract before allowing coordinated CLI access.
- Define blocked/unknown ownership states and conservative recovery after process failure.
- Audit global/project configuration writes and CLI discovery of credentials, skills, templates, extensions, MCP, and codemode.

Implemented: server-owned lifecycle and conservative catalog/ownership coordination, local REST commands and bounded WebSocket delivery, request correlation, prompt/queue/abort/inspection operations, and normal JSONL persistence. Native CLI access remains blocked by decision, with a documented pre-open launcher/bridge contract. Configuration discovery and API write paths have a bounded static audit; full installed-resource integration is still required before unattended deployment. No production live handoff or dialog answers are claimed.

### 3. Bridge integration and remote interactions

First slice implemented: bounded startup discovery of existing Pi files for configured projects, stable path-derived inventory IDs, original-file read-only transcript inspection, and browser labeling. Deterministic discovery/API tests verify that files remain unchanged and cannot be claimed or recovered through Pim. Full pre-open native launcher, bridge registration, original-file adoption, remote TUI controls, and bidirectional production handoff remain unimplemented.

- Register TUI ownership and forward events, state, prompts, and controls.
- Productionize explicit handoff in both directions with ownership status and lifecycle cleanup.
- Support RPC select/confirm/input/editor dialogs, cancellation, and reconnecting to pending questions.
- Define first-answer handling, stale-answer rejection, and behavior when no client is connected.
- Test abort during pending approval; do not assume abort dismisses a dialog automatically.
- Add an explicit integration for answering questions remotely while TUI-owned. RPC support alone does not expose TUI-owned `ctx.ui.custom()` interactions.
- Preserve native question UI locally; richer web/iOS questionnaires may need an ask-extension adapter beyond its lower-fidelity RPC fallback.
- Audit the actual installed extensions. Terminal-only management/visualization features may remain terminal-only initially.

### 4. Browser client

Implemented for server-owned sessions: React/Vite, TanStack Query/Router, project/session selection, creation and runtime controls, current-context transcript, delta reconstruction, tool progress, queues, prompt/steer/follow-up/abort controls, model/thinking selection during runs, and current context usage. Reconnects subscribe first, obtain a session snapshot with a server epoch and cursor, discard buffered events at or before that cursor, and apply newer events. Snapshot reads retry if observed session events or ownership change; sustained churn returns a retryable inspection error instead of mixed state. Unknown mutation outcomes require inspection and explicit acknowledgment. Dialog answers and production TUI handoff are not included.

Remaining acceptance criteria and future scope:

- Project/session selection, transcript, partial response, tool progress, running state, queues, and pending dialogs.
- Prompt, steer, follow-up, and abort controls.
- Fresh authoritative snapshot on reconnect, with a consistent event cursor to avoid snapshot/subscription gaps.
- Request IDs and explicit accepted/queued/completed/unknown outcomes. Do not automatically replay uncertain mutations.
- These are client synchronization guarantees, not durable or exactly-once tool execution.

### 5. iOS client

Deferred to a separate project. It may reuse the browser/server contract. No phone-side agent runtime or competing session storage authority is planned here.

## Security and reliability

- Start local-only, then use authenticated secure remote access, potentially a private VPN.
- Agent access grants PC file and shell access. Allowed project paths are not a filesystem sandbox.
- Authenticate browser, phone, and bridge connections; validate browser origins.
- Pin/test the supported Pi version. Public APIs and extension behavior can evolve.
- Bound event buffers and handle slow clients without stalling the agent's stdout.
- On crashes, preserve history and report interrupted or uncertain work rather than promise transparent recovery.
- Test simultaneous claims, stale commands, failed replacement, disconnect without process exit, pending approval, retry/compaction, and restart while a TUI still owns a session.

## Open decisions

- Phase 2 uses one exclusive local-filesystem coordinator lock and durable generation-checked catalog transitions. The future managed launcher must obtain a pre-open claim; production TUI registration and handoff still need implementation.
- Phase 2 uses loopback-only Node HTTP REST commands and WebSocket events. Authentication is disabled for local development; Host and Origin checks remain enforced. Browser reconnect synchronization now uses epoch/cursor snapshots with bounded event buffering and gap detection. Dialog answers and iOS work are deferred. Authentication and secure remote deployment remain open.
- Whether the TUI can offer a useful remote view while parked.
- Remote adaptation of TUI-owned questions and other custom extension UI.
- Handoff portability of branch selection, active tools, drafts, and extension background work.
- Uncertain ownership is blocked. Phase 2 recovery requires explicit offline operator confirmation; automated reconciliation and uncertain TUI transfer recovery remain open.

## References

- RPC: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
- RPC extension UI: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md
- Extensions: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- SDK: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- Sessions: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md
- Session format: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md

Pi's experimental Durable/server-client integration is worth monitoring, but is not a dependency.
