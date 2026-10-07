# Native TUI handoff prototype

A reproducible feasibility test, not a server or an extension to install globally.

It keeps **one native Pi TUI process alive** while its managed session moves to an RPC process and back. The TUI switches to a separate parking session rather than retaining a writable runtime for the managed file.

## Run

Requirements: Linux/macOS, Node.js 22+, tmux, and **Pi 1.0.4** on PATH. No npm dependencies, API keys, or model calls are needed.

```sh
npm test
npm run test:handoff
# Also exercise the regular (non-fullscreen) native TUI:
PIM_TUI_MODE=regular npm run test:handoff
```

If several Pi installations exist:

```sh
PIM_PI_BIN=/absolute/path/to/pi npm run test:handoff
```

The launcher excludes npm-injected ancestor `node_modules/.bin` paths when looking up Pi, since these can shadow the normal CLI. The version check deliberately fails on other versions until their lifecycle behavior is verified.

The integration test prints a temporary artifact directory and a tmux attach command. It closes its private tmux session and RPC child after completion. Use the saved terminal captures to inspect a completed run.

## Isolation

- Fresh temporary HOME, Pi agent directory, session directory, and ownership records.
- No inherited credential environment variables, copied credentials, global extensions, or project configuration.
- Only the explicitly loaded test bridge, with tools disabled and ordinary input consumed.
- Seeded JSONL fixtures and deterministic extension messages; no LLM is involved.
- No RPC configuration setters. Pi may create empty auth/model-store files inside the temporary agent directory.
- Artifacts remain under `/tmp/pim-handoff-*` for inspection. Delete individual run directories when no longer needed.

This is configuration/process isolation for the experiment, not an OS sandbox.

## Workflow and assertions

1. Open a seeded managed session in the native TUI.
2. Reject a deliberately cancelled release and a stale-generation release. Keep TUI ownership.
3. Authorize release. `/pim-release <generation>` switches the native runtime to the parking session using `ctx.switchSession()`.
4. Wait for a receipt written after session replacement, then start RPC on the managed file.
5. Append a marker in the parked TUI. Assert its marker belongs to the parking session and that the managed file's hash did not change.
6. Append a deterministic marker through RPC and verify its history.
7. Close RPC stdin and await confirmed process exit. Only then authorize reclaim.
8. `/pim-reclaim <generation>` reopens the managed session in the **same native TUI PID**. Assert it contains the RPC marker but not the parking marker.
9. Append another TUI marker and shut down the test TUI.

`authority.json` is written by exactly one harness. Requests/receipts carry generations; invalid transitions and mismatched receipts are rejected. Errors leave the recorded phase unknown instead of authorizing a new owner. These records are a test protocol, **not a multi-process locking implementation**.

## Files

- `run.mjs`: isolated launcher, tmux driver, and assertions.
- `bridge.ts`: explicitly loaded Pi extension with transfer and marker commands.
- `protocol.mjs`: small phase/receipt protocol shared by launcher and bridge.
- `rpc.mjs`: bounded-request test transport with continuous JSONL consumption and no retries.
- `tui.mjs`: native TUI child wrapper and exit recording.
- `*.test.mjs`: unit tests for transition validation and RPC transport behavior.

Per-run evidence includes `result.json`, `authority.json`, `lifecycle.jsonl`, transfer receipts, RPC stdin/stdout/stderr, `rpc-exit.json`, `tui-exit.json`, and terminal captures.

## What passing means

Against Pi 1.0.4, public extension APIs can detach a native TUI from one session and restore it later without restarting the TUI. A separately launched RPC runtime can work on the released file in between. Disabling input alone is not the mechanism: the managed runtime is replaced.

## What it does not prove

- Production ownership enforcement, atomic competing claims, or fencing a CLI launched outside coordination.
- Safety with arbitrary extensions, retained session-manager references, timers, subprocesses, or background writes after shutdown.
- Handoff of active generation, retries, compaction, queued prompts, pending dialogs, drafts, active tool changes, or branch navigation without subsequent persistence.
- Recovery after a crash or an ambiguous session replacement. Failed opening can leave the old runtime disposed.
- Remote prompts or question answering while the native TUI owns a session.
- Background continuation after closing the terminal. The test's RPC child is owned by the harness; a future persistent server must own it independently.
- Automatic transfer of the native transcript into a live remote view while parked.

The next slice should turn the tested release/reopen sequence into a local coordinator with pre-open ownership checks and explicit failure states, then add real bridge prompt/dialog routing.
