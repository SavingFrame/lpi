# Relay server API

Pim discovers saved sessions and routes browser commands into connected native Pi extensions. It does not launch RPC, write conversation files, or transfer runtime ownership.

## Configuration

- `projectRoots`: existing absolute or home-relative container directories. Immediate child directories become projects; canonical aliases are deduplicated. IDs derive from canonical paths. Restart to discover new projects.
- `piSessionRoots`: saved JSONL roots, default `["~/.pi/agent/sessions"]`. Custom storage requires explicit roots. Missing directories are ignored. Set `[]` to disable saved-file discovery.
- `host`: IPv4 or IPv6 bind address, default `0.0.0.0` (all IPv4 interfaces). Use `127.0.0.1` for loopback-only access.
- `port`: defaults to 3141.
- `origins`: exact allowed HTTP(S) browser origins, including every LAN/Tailscale URL you use. Their authorities also form the Host allowlist, alongside localhost and IPv4/IPv6 loopback with the configured port. The default empty list denies Origin-bearing requests.

Roots are not a filesystem sandbox. Project trust and agent configuration belong to native Pi.

## REST

| Method | Path | Operation |
|---|---|---|
| GET | /projects | Project IDs, names, and canonical directories |
| GET | /sessions | Combined saved-file and live-connection inventory |
| GET | /sessions/:id | Session identity and connection metadata |
| GET | /sessions/:id/snapshot | History/activity, runtime metadata, epoch, and cursor |
| POST | /sessions/:id/commands | Forward a command to a connected native Pi instance |
| POST | /sessions | Launch a fresh native Pi in a configured project |
| POST | /sessions/:id/resume | Resume saved history in native Pi |

Create accepts `{ requestId, projectId }`. Resume accepts `{ requestId, confirmedOffline: true }`; the project comes from the saved record. Both return `{ requestId, outcome: "acknowledged", data: { session } }` after correlated bridge registration. They do not use connection generations. Launch checks are serialized, bounded to 32 managed tmux sessions, and wait up to 20 seconds for registration. Timeouts and lost subprocess results are unknown outcomes, never automatically replayed.

The dedicated `tmux -L pim` socket hosts one session per runtime, using the pinned Pi CLI and the bridge enabled through existing global Pi extension configuration. The launcher does not pass `--extension`. Managed extensions reserve file IDs in tmux before registration. Resume rejects reserved files and unregistered runtimes, and requires confirmation that external writers have stopped. Reservations survive relay restarts and conservatively accumulate across TUI session switches. No generic terminal-input proxy is exposed. Stop uses the existing generation-checked command endpoint, not a tmux kill endpoint.

Session records contain `id`, `projectId`, `directory`, `file`, `createdAt`, `piSessionId`, `connection`, and `generation`. Pim IDs derive from canonical file paths, so copied files with identical Pi IDs remain distinct. Connection is `connected` or `disconnected`, not a statement about process liveness or ownership.

POST bodies require JSON content type, a unique request ID, and the current connection generation:

```json
{
  "requestId": "unique-client-request-id",
  "generation": 3,
  "command": { "type": "prompt", "message": "Review this project" }
}
```

Supported commands: `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `set_thinking_level`, `stop_runtime`, and explicit `extension` actions. Model changes accept `{ type: "set_model", provider, modelId }`; thinking changes accept `{ type: "set_thinking_level", level }` with `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Both require idle Pi with no queued messages or dialogs. Pi validates model availability/authentication and clamps thinking to model capabilities. These changes affect the session, not defaults for new sessions. Stop is limited to connected Pim-managed runtimes advertising `state.managedRuntime: true`. It requests abort and graceful shutdown without deleting history. Acknowledgment means acceptance, not confirmed process exit; existing tmux reservation checks still apply before resume. Prompt optionally accepts `streamingBehavior: "steer" | "followUp"`. Messages optionally include `images: [{ type: "image", mimeType: "image/png", data: "<base64>" }]`. PNG, JPEG, GIF, and WebP are supported (four images, 4 MiB total decoded bytes). An empty `message` is accepted when images are present. Slash commands, queue editing, and unsupported dialog answers are not exposed.

Extension actions use `{ type: "extension", extension: "ask-user-question", action: { toolCallId, answers?, globalNote?, cancel? } }`. Only registered modules are allowed; there is no arbitrary event-bus dispatch. Ask answers require every question answered, with zero-based `questionIndex` and `optionIndexes`, optional custom `text`/per-question `notes`, or explicit `cancel: true`. Ask acknowledgment waits for its correlated authoritative verdict; an explicit rejection does not close the connection. Missing/malformed verdicts are unknown outcomes. See the [module contract](../src/extension-support/ask-user-question/README.md).

Success returns `outcome: "acknowledged"` and `data.disposition: "dispatched"`. This means the extension invoked the public Pi API, not that work completed or persisted. Observe subsequent output and settlement.

Lost responses, timeouts, or connection failures may have unknown outcomes. Never replay mutations automatically. Used request IDs are rejected for the server's lifetime, bounded to 100,000. This is not durable exactly-once execution.

## Snapshots

Snapshots contain `{ epoch, cursor, session, state, controls, view }`.

- `state`: runtime metadata or read-only file status.
- `controls`: current model, `availableModels` (provider/id/name from the authenticated native registry), `scopedModels` (provider/id/name from `ctx.scopedModels`, not a separate favorites store), effective thinking level, `availableThinkingLevels` (from `pi-ai` capabilities for the current native model), and context usage. Disconnected saved-file snapshots have no available models.
- `view`: current-context messages, authoritative assistant partial, active tools, running/compacting flags, notices, and `extensions` containing registered module-specific pending state. Read-only/disconnected snapshots have no actionable extension state.

Connected snapshots come from the extension's received stream. The server captures the cached snapshot and event boundary synchronously. This is not a checkpoint of the native process.

Saved-file inspection uses Pi's pure JSONL/context helpers, never a SessionManager. It validates header identity and file metadata, rejects malformed/partial records, and reads at most 32 MiB. These snapshots cannot capture in-memory branch selection or unfinished output. Manual refresh sees persisted updates; discovery itself runs at startup.

Disconnected bridges retain explicitly labeled last-known history, not a claim that Pi exited.

## Connections

Native extensions connect to `/bridge` without a token. Origin-bearing browser connections to this endpoint are rejected. All instances share this one server. See [bridge setup](bridge.md).

Browser clients connect to `/events`. REST remains the command channel. The handshake contains `type: "connected"`, `replay: false`, a server epoch, and the current cursor.

Subsequent events contain `epoch`, `cursor`, `sessionId`, `generation`, `type`, and `data`. Types are:

- `connection`: bridge attachment/disconnection metadata.
- `pi-event`: supported native agent/message/tool events and Pim `extension_support` notifications. A support notification carries `{ extensions, notice }`, replaces validated module state, and updates the waiting notice without reloading history.
- `bridge-sync`: refreshed branch/activity snapshot.
- `bridge-status`: changed runtime metadata.

Subscribe first, buffer events while loading the snapshot, discard events at or before its cursor, then apply newer events. Cursors are global; epochs distinguish server restarts. Gaps, epoch mismatches, connection changes, synchronization events, and settlement require fresh inspection.

All reachable LAN/Tailscale clients are trusted. Browser/API and bridge access have no application authentication. Host and Origin checks remain enforced, but are not authentication. Anyone who can reach the service can control connected agents. Network access control belongs to deployment; do not expose Pim publicly.

## Bounds and failures

- 32 native records and bridge sockets; 8 MiB native frames/snapshots.
- 512 active tools and 32 pending commands per native connection.
- 10-second command acknowledgment and 5-second attachment deadlines.
- 32 browser sockets with 8 MiB outbound allowance.
- 6 MiB HTTP bodies, 128 concurrent POST handlers, 256 HTTP connections.
- Saved discovery: 10,000 candidate files, 10,000 subdirectories, 64 KiB headers.
- Browser synchronization: 16 MiB estimated string storage or 4,096 selected-session events.

Slow clients disconnect without stalling Pi. Closing the relay disconnects bridges but never terminates native Pi.

Ask User Question has an explicit browser support module. Other questions and approvals remain terminal-only unless a support module is added. Abort is not assumed to dismiss a dialog. Tests use fake Pi contexts and isolated transports; installed native-Pi integration remains unverified.
