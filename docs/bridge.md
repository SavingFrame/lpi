# Native Pi connection

The extension connects an already running native Pi TUI to the single Pim relay. Pi is the only agent runtime and session-file writer. Pim receives history/events and forwards commands into that same runtime.

## Setup

```sh
npm run build
npm start -- pim.config.json
```

No token or secret file is needed. The Pi working directory must match a discovered project.

Launch normal Pi with the compiled extension:

```sh
pi --extension /absolute/path/to/pim/dist/bridge/extension.js --resume
```

Loading the extension opts into connection on session startup, including after switching sessions. This explicit command is for Pi instances without the bridge globally configured. Browser create/resume relies on Pi’s existing global extension configuration and does not pass `--extension`. Enable the compiled bridge there before using browser launching, and do not configure both a wrapper and an explicit path for the same extension.

To reconnect manually or select another endpoint, run:

```text
/pim-connect ws://127.0.0.1:3141/bridge
```

This asks for local confirmation. With no argument, `/pim-connect` uses the current endpoint. `/pim-disconnect` disconnects without stopping Pi for the current session lifecycle. Session startup or extension reload connects again. A manually selected URL lasts until extension reload; use the environment for persistent configuration.

The endpoint defaults to `ws://127.0.0.1:3141/bridge`. Set `PIM_BRIDGE_URL` for another endpoint. `ws://` and `wss://` URLs ending in `/bridge` are accepted without credentials, query strings, or fragments. For LAN/Tailscale endpoints, add the corresponding HTTP(S) origin to the server's `origins` so Host validation accepts it. Session identity paths must still resolve on the relay host; cross-machine session storage is not implemented. RPC/print/JSON modes and ephemeral sessions do not connect.

## Behavior

- Current-branch conversation history from Pi's read-only session context.
- Assistant partials, tool starts/updates/ends, agent start, and final settlement.
- Partial updates throttled to 40 ms; native execution never awaits network delivery.
- Fresh reconnect snapshots including unfinished responses and active tools.
- Branch navigation, compaction completion, and final settlement refresh history.
- Current model, thinking, context usage, and queued-message presence, sampled every second.
- Browser prompt, steer, follow-up, and abort through public extension APIs.
- Stop runtime for connected Pim-managed instances through `ctx.abort()` and `ctx.shutdown()`. Acceptance is flushed before shutdown cleanup disconnects the bridge. External instances reject this command.
- Native prompt lifecycle notices where Pi exposes them. Dialog answers remain terminal-only.

Browser image attachments are delivered as structured image content through `pi.sendUserMessage`, including with steer/follow-up and image-only messages. PNG, JPEG, GIF, and WebP are supported, up to four images and 4 MiB total per message. A model with image input support is required. Slash commands, model/thinking setters, queue editing, and custom terminal UI adaptation are not exposed. Steer/follow-up use normal Pi semantics and can start a turn when idle.

For each browser image submission, the extension adds a durable native TUI indicator such as `Pim: 1 image submitted (prompt)`. It records the count and delivery mode as a custom session entry, without duplicating image bytes or adding model context. The indicator renders again after reload/resume while the bridge extension is loaded. It indicates submission, not model acceptance or execution, and queued messages can still be changed or discarded in native Pi. Existing submissions are not backfilled.

Acknowledgment means API dispatch, not persistence, model acceptance, or successful execution. Later failures may still appear in Pi. Never replay uncertain commands automatically.

## Connection safety

`/bridge` has no token, rejects Origin-bearing browser connections, and uses Host validation. Browser/API access is also unauthenticated. LAN/Tailscale clients are trusted; anyone who can reach Pim can control connected agents. Network access control belongs to deployment. Do not expose Pim publicly.

Registration canonicalizes the project/file path and validates existing file headers against the declared Pi identity. Stable path-derived inventory IDs merge connected and discovered records without copying files.

Only one connected bridge per canonical session path is accepted. A disconnected instance can reconnect, including after extension reload, with a new generation and snapshot. This is connection routing, not writer fencing. Pi processes outside the bridge can still open the same file, so do not do that.

Disconnection disables commands and retains labeled last-known history. It does not prove process exit or authorize another runtime. Server restart clears the in-memory connection inventory; extensions reconnect.

Commands carry a connection generation. The extension checks generation, current file/session identity, and consumed command IDs. Server acknowledgments correlate to pending requests. Timeout, malformed acknowledgment, or transport loss makes the outcome unknown and closes the command channel. Commands are never replayed.

Closing Pim does not terminate Pi. Closing Pi stops its agent. Browser create/resume launches native Pi in the dedicated `tmux -L pim` server. Use `tmux -L pim list-sessions`, then `tmux -L pim attach -t <name>` to inspect its native TUI. Managed extensions reserve canonical file IDs in their tmux session before registering, preventing managed resume while a disconnected runtime remains. These reservations survive relay restarts and conservatively accumulate across TUI session switches until that tmux session exits. Stop runtime requests orderly Pi exit, which normally removes its dedicated tmux session. It does not kill tmux directly or delete history. Shutdown can take time; a disconnect alone is still not proof of exit. Do not set `PIM_TMUX_SESSION` or `PIM_LAUNCH_ID` manually when launching outside Pim.

## Verification

Focused tests run the compiled extension against a fake public Pi context and isolated local HTTP/WebSocket transports. They cover streaming, commands, dialogs, disconnects, connection conflicts, reload reconnects, stale generations, token-free connections, Host/Origin rejection, and unknown outcomes without model calls.

Real native Pi with the installed extensions remains unverified. No automatic recovery of unfinished tools or generic remote custom-dialog support is claimed.
