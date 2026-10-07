# Server API

The application API is intentionally smaller than Pi RPC. Only Pi 1.0.4 is supported. `@earendil-works/pi-coding-agent` is pinned as a dependency; managed command shapes derive from its exported `RpcCommand`, and response correlation uses `RpcResponse` command types. RPC protocol imports are type-only. Stopped-session inspection uses Pi's pure `parseSessionEntries` and `buildSessionContext` functions. It never opens a SessionManager or agent runtime. Runtime validation remains mandatory, and unvalidated response payloads remain `unknown`.

## Configuration

Copy `pim.config.example.json`. Configure `projectRoots`, for example `["~/Projects", "~/Projects/work"]`. Roots must exist and be absolute paths or use `~`/`~/` for your home directory. Discovery runs once at startup and includes every immediate child directory, including hidden and non-Git folders. Files and dangling symlinks are ignored. Symlinked directories are canonicalized and may resolve outside the configured roots; roots are not a sandbox.

Duplicate roots and canonical directory aliases are deduplicated. Any configured root is treated as a container rather than a project, so adding `~/Projects/work` exposes its children instead of listing `work` itself. Empty roots are valid; scanning is not recursive beyond explicitly configured roots. Restart to discover newly added folders.

`GET /projects` returns `{ id, name, directory }` records. IDs are SHA-256 hashes of canonical paths, so root ordering, aliases, and unrelated additions do not change existing associations. Renaming or relocating a project changes its identity. Existing catalog projects cannot be removed or relocated underneath their sessions; startup rejects missing associations rather than silently rebinding them. The old explicit `projects` configuration is rejected, and existing manually assigned catalog IDs are not automatically migrated.

`piSessionRoots` defaults to `["~/.pi/agent/sessions"]`. It accepts absolute or home-relative directories, including missing directories (ignored until they exist at a subsequent restart). Set it to `[]` to disable existing-session discovery. Custom Pi agent directories, environment overrides, and `sessionDir` settings require explicit roots here. Discovery scans JSONL files directly inside each root and its immediate real subdirectories, ignores file/directory symlinks, deduplicates canonical file paths, and uses header `cwd` to match canonical project paths. It reads at most 64 KiB for each header, with limits of 10,000 candidate files and 10,000 subdirectories. Invalid or unreadable candidates produce startup warnings. Restart to discover newly created files.

`dataDirectory` resolves from the server working directory. `pi` selects an executable, not a shell command. Use an absolute executable path when PATH could resolve a different installation. `port` defaults to 3141. The host is not configurable.

Authentication is disabled for local development. No token or Authorization header is required. `origins` contains exact HTTP(S) origins; the default empty list denies browser-origin requests. Non-browser clients may omit Origin. Host validation prevents alternate Host names from reaching the application. Local processes can access the agent without credentials; do not expose the server through a public proxy.

The server inherits existing Pi credentials and resources. Registering a project does not automatically trust its local configuration.

## REST

All POST requests require `Content-Type: application/json` and a unique `requestId`. Start, stop, and commands also require the current ownership `generation`.

| Method | Path | Operation |
|---|---|---|
| GET | /projects | Discovered project IDs, folder names and canonical directories |
| GET | /sessions | Catalog and ownership states |
| GET | /sessions/:id | One catalog record |
| GET | /sessions/:id/snapshot | Session, runtime state, projected transcript/activity, epoch and event cursor |
| POST | /sessions | Create a persisted normal session, body includes projectId |
| POST | /sessions/:id/start | Claim ownership and await RPC startup |
| POST | /sessions/:id/stop | Stop RPC and await confirmed exit |
| POST | /sessions/:id/commands | Execute a validated command against the active generation |

Example command body:

```json
{
  "requestId": "unique-client-request-id",
  "generation": 3,
  "command": { "type": "prompt", "message": "Review this project" }
}
```

Supported commands:

- `prompt`, with optional `streamingBehavior: "steer" | "followUp"`.
- `steer`, `follow_up`, `abort`, `clear_queue`.
- `get_state`, `get_messages`, `get_entries`, `get_tree`, `get_session_stats`.
- `get_available_models`, `set_model` (provider and modelId).
- `get_available_thinking_levels`, `set_thinking_level` (level).

Model and thinking changes are allowed during runs. They affect the next model request, including tool continuations, without changing an already-streaming response. Model switches can reset/clamp thinking to the new model’s defaults/capabilities. These RPC setters persist session state, not global defaults.

Skills and prompt templates are accepted when Pi reports them through `get_commands`. Extension slash commands are rejected because they can replace sessions or mutate shared configuration. Configuration setters, session switching, fork/clone, and arbitrary RPC passthrough are not exposed. Image prompt input is not implemented yet.

A prompt response with `outcome: "acknowledged"` covers RPC command handling, not completion. Its `data.disposition` can be started, queued, or handled. Observe Pi's `agent_settled` event for completion of automatic work, not `agent_end` alone.

`outcome: "completed"` applies only to catalog creation, startup, or confirmed stop. Errors report rejected or unknown outcomes. Transport loss or a deadline can happen after a mutation executes: **never replay automatically**.

Used request IDs are rejected for the lifetime of the server, with a hard limit of 100,000. This is bounded duplicate detection, not a durable idempotency ledger or exactly-once execution. IDs are not remembered across restarts. A lost response must be reconciled by inspection, not by submitting a new ID.

Session creation only creates new managed files. Existing sessions are a separate read-only inventory, not imported into the ownership catalog. Their records include `source: "pi"`, the original `piSessionId`, and unknown ownership at generation zero. Their Pim IDs derive from canonical file paths so copies with identical header IDs remain distinct. Start, stop, and commands cannot open them, and offline catalog recovery cannot release them. No adoption endpoint exists before pre-open launcher/bridge coordination.

## Session snapshots

`GET /sessions/:id/snapshot` returns `{ epoch, cursor, session, state, controls, view }`. `controls` contains the current model and thinking level, available model summaries and thinking levels, and Pi’s `contextUsage` estimate (tokens, contextWindow, percent). Context usage is not cumulative session usage. It is null when unavailable; tokens and percent may be null after compaction until fresh assistant usage arrives. Stopped/unknown sessions expose empty controls. `view` contains current-context messages, a reconstructed partial assistant message, active tools, steering/follow-up queues, running/compacting flags, and an optional notice. This is not a full archive of abandoned branches or pre-compaction messages; existing `get_entries` and `get_tree` commands remain available for those.

For RPC ownership, the server reads `get_state`, `get_messages`, `get_available_models`, `get_available_thinking_levels`, and `get_session_stats`, checks that the session's observed event revision and ownership generation did not change during the reads, then captures the transient projection and cursor synchronously. A changing session is retried up to five times; sustained changes return 409 so clients can retry inspection. This is an observed RPC-event boundary, not a checkpoint of tool execution or a lock against extension state changes that emit no events.

Confirmed-unowned managed sessions are read and projected from JSONL without opening a writer. Unknown, starting, and stopping managed ownership expose catalog status, not a replacement runtime. Stopped-file reads are limited to 32 MiB.

Discovered Pi sessions expose a read-only persisted transcript even though ownership is unknown. Inspection validates header identity, reads a bounded 32 MiB maximum, rejects malformed/partial JSON, and checks file identity and metadata around the read. Missing or changed files require refresh or server restart. `state.readOnly` is true and `view.notice` explains that a native runtime may still own the file. This is a best-effort file snapshot, not an authoritative live-TUI snapshot. There are no bridge events, in-memory branch selection, queues, drafts, dialogs, or live deltas for these files; manual refresh reads subsequent persisted changes. Inspection uses only pure parsing/projection helpers and never a SessionManager.

## WebSocket

Connect to `/events` with the same Host and Origin rules. No authentication is required. REST remains the command channel. Sending client WebSocket messages closes the socket.

The first record is `{ "type": "connected", "replay": false, "epoch": "server-instance-uuid", "cursor": 0, "revision": 0 }`. Subsequent records contain:

```json
{
  "epoch": "server-instance-uuid",
  "cursor": 1,
  "sessionId": "managed-session-uuid",
  "generation": 1,
  "type": "ownership",
  "data": { "phase": "starting", "generation": 1, "interrupted": false }
}
```

Types include created, ownership, rpc, exit, settings-changed, and interaction-unavailable. Successful model/thinking setters publish settings-changed so all connected clients refresh authoritative controls. RPC records are forwarded intact; diagnostic tails appear in exit records. Events go to every connected client, appropriate for a single user on a trusted local machine.

Cursors are global and reset on server restart; the random epoch distinguishes server instances. There is no replay buffer. Subscribe first and buffer events while obtaining the selected session snapshot. Require the same epoch, discard events at or before its cursor, then apply newer events. Track all global cursors even when displaying only one session. A cursor gap or epoch mismatch requires reconnecting and a new snapshot, never guessing at missing state. Ownership-generation changes and compaction completion require refreshing the snapshot. Browser mutations are disabled while synchronization is incomplete.

Browser WebSockets can connect directly from an explicitly allowed origin. Authentication must be added before enabling remote access.

Browser/phone disconnects never stop the RPC child. Server shutdown explicitly closes stdin, then escalates to SIGTERM and SIGKILL with bounded waits. Stop can interrupt active work. Neither sending a signal nor a timeout releases ownership.

## Bounds and deferred interactions

- 16 active RPC runtimes; 64 pending requests per child.
- 8 MiB stdout record limit, strict LF framing and UTF-8 decoding.
- 64 KiB diagnostic tail; stderr is always drained.
- Bounded stdin buffering; overloaded callers are rejected rather than indefinitely queued.
- 32 WebSocket clients; 2 MiB per-client outbound allowance and heartbeat cleanup.
- 1 MiB HTTP body limit; 128 concurrent POST handlers; 256 HTTP connections.
- 10,000 catalog sessions.
- 16 simultaneous snapshots; five consistency attempts per snapshot.
- Browser synchronization buffer: 2 MiB or 4,096 selected-session events before reconnecting.

Oversized or malformed protocol records block the runtime without granting another writer. Slow WebSocket clients are disconnected, never allowed to block stdout.

Dialog records are visible, but answers and reconnecting to pending dialogs are Phase 3 work. A dialog may therefore remain pending until Pi's timeout or explicit runtime shutdown. Abort is not assumed to dismiss it. Do not deploy unattended workflows that require approvals yet.

Tests cover fake-process lifecycle and transport behavior. Real Pi with the installed resource set has not been integration-tested as part of this implementation.
