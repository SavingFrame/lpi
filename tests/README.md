# Test scope

Use `node:test`. Run the smallest relevant files while editing, then final checks after the change stabilizes. `npm test` runs all deterministic relay/frontend tests only when explicitly requested. `npm run test:browser` is a separate opt-in real-layout check. No CI changes or new test dependencies are required.

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

## Maintenance decisions

- The pending command test checks every command as both an initial dispatch and a blocked competitor, without the former command-type cross-product. Unknown-outcome tests still check every command remains blocked.
- The offline dispatch test also covers availability read before disconnection, replacing a separate duplicate scenario.
- Prompt and extension HTTP delivery failures share one parameterized no-retry contract. Wrong acknowledgment correlation remains a separate failure path.
- Markdown tests retain table semantics, alignment and security assertions without depending on exact wrapper nesting or placeholder tags.
- Native, relay and browser safety assertions remain separate where they protect different trust boundaries. Do not remove them merely because their names look similar.

A new test should cover a distinct user-visible behavior, contract or regression. Avoid adding cases for library behavior unrelated to Pim's configuration or for every implementation detail. Real-layout coverage complements controller units; fake native contexts do not establish real-Pi integration. The opt-in queue integration test starts both the installed bundled launcher and unbundled native Pi CLI in JSON mode. It symlinks the actual `extensions/pim` folder into the isolated agent directory, verifies that normal global discovery loads its `index.ts` without an explicit bridge path, and runs a source-based queue probe. No extension compilation or host-class injection is used. It loads the real queue adapter, clears queued steering/follow-up messages, verifies they never reach a fake provider, and verifies explicitly requeued replacements do. It uses temporary HOME, settings, working directory and sessions, no credentials, no network provider and no TUI. The opt-in source integration test does not require a build; compiled native unit tests still require `npm run build:server`. Set `PIM_TEST_PI_CLI` to an absolute CLI entry path to also verify a separate/global Pi installation with the same isolation. Real TUI/bridge integration and native-Pi reload, navigation, compaction and dialogs remain unverified.
