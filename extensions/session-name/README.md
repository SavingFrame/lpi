# Automatic session names

The independent `extensions/session-name/index.ts` extension generates native Pi session names from the
first user message. It does not depend on lpi or tmux. Load it separately:

```sh
pi --extension /absolute/path/to/lpi/extensions/session-name/index.ts
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
Real-Pi naming integration remains unverified.
