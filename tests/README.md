# Test scope

Tests use `node:test`. `npm test` runs deterministic relay/frontend tests;
`npm run test:browser` is a separate opt-in real-layout check.
See [AGENTS.md](../AGENTS.md#tooling-and-validation) for execution and isolation rules.

## Select a suite

Build the server once after server changes, then select the relevant file:

```sh
npm run build:server
node --test --test-reporter=spec tests/bridge-commands.test.mjs
node --experimental-strip-types --test --test-reporter=spec frontend/tests/live-status.test.mjs
```

| Behavior | Suite |
| --- | --- |
| Native streaming, large history and snapshots | `tests/bridge.test.mjs` |
| Navigation, model/thinking changes and shutdown | `tests/bridge-commands.test.mjs` |
| Attachments and image policy | `tests/bridge-images.test.mjs` |
| Duplicate registrations, unknown delivery, host/origin policy and redacted logs | `tests/bridge-security.test.mjs` |
| Inventory, completion/read metadata, status and launch correlation | `tests/bridge-inventory.test.mjs` |
| Ask native-to-relay integration | `tests/bridge-ask.test.mjs` |
| Native state/command/transport units | `tests/native-bridge.test.mjs` |
| Queue hook lifecycle, revisions, clearing and wire validation | `tests/native-queue.test.mjs` |
| Opt-in real-Pi queue adapter with an isolated fake provider | `node --test tests/integration/native-queue.mjs` |
| Real Chromium queue visibility, draft copying and clear consent | `node --test frontend/tests/browser/pending-queue.mjs` |
| Browser snapshot/reconnect boundaries | `frontend/tests/live.test.mjs` |
| Browser status, lifecycle and read broadcasts | `frontend/tests/live-status.test.mjs` |
| Ask relay-to-browser synchronization | `frontend/tests/live-ask.test.mjs` |
| Browser HTTP correlation, validation and no-retry behavior | `frontend/tests/api.test.mjs` |
| Browser-side shared contract validation | `frontend/tests/shared-contracts.test.mjs` |
| Transcript projection, tool pairing and author grouping | `frontend/tests/transcript-state.test.mjs` |
| Pending/uncertain command lane and reload protection | `frontend/tests/session-commands.test.mjs` |
| Markdown formatting and safety policy | `frontend/tests/safe-markdown.test.mjs` |
| Scroll-controller decisions with mocked DOM values | `frontend/tests/chat-scroll.test.mjs` |
| Real Chromium layout and scroll-controller behavior | `npm run test:browser` |

Other feature tests remain beside these suites. `bridge-fixture.mjs` owns relay setup, fake native contexts, and extension transport teardown. `live-fixture.mjs` supplies snapshots and mocked browser transport. Neither fixture registers tests on import.

## Native integration limits

Fake native contexts do not establish real-Pi integration. Real-layout browser checks
complement mocked scroll-controller tests.

The opt-in queue integration test loads the actual source extension through normal global
discovery in isolated JSON-mode Pi processes. It checks queue clearing and explicit requeueing
against a fake provider, without credentials or a network provider. It uses temporary HOME,
settings, working directories, and sessions. No source-extension build is needed; compiled
native unit tests still require `npm run build:server`.

Set `PIM_TEST_PI_CLI` to an absolute CLI entry path to check a separate/global Pi installation.
This does not verify native TUI/relay integration, reload, navigation, compaction, or dialogs.
