# Extension support modules

Pim adds browser support explicitly, one extension at a time. Normal tools still execute
in native Pi without an adapter. A support module adds browser interaction or rendering
through an extension's documented public API. It does not install, replace, or run that
extension in the browser.

No universal interaction schema, terminal-input proxy, RPC runtime, or per-extension
server is involved. All modules share Pim's existing connection, snapshots, and
generation-checked command endpoint.

## Layout

```text
src/extension-support/
  registry.ts                 # Shared allowlist, module-specific state/action validation
  native.ts                   # Native registrations and lifecycle dispatch
  web.tsx                     # Browser registrations
  ask-user-question/
    contract.ts               # Extension-specific types, channels, and validators
    native.ts                 # Public event bindings and answer correlation
    web.tsx                   # React questionnaire
    draft.ts                  # Framework-independent browser/mobile questionnaire behavior
    web.css                   # Module-owned styling
    README.md
    tests/
```

There are separate registrations for shared validation, native code, and browser code.
This prevents a browser component from importing the agent runtime and prevents native
Pi from loading React or CSS. Shared contracts must remain browser-safe.

## Add support for another extension

1. Read its installed code, public API documentation, and event declarations. Record
   the version inspected and what is actually supported in the module README.
2. Create a folder named for the extension. Keep its types, native bindings, browser
   rendering, styles, and focused tests there. Do not force its data into Ask's shape.
3. Add its state and action types and validators to `registry.ts`. This is an explicit
   allowlist. Reject unknown extension IDs; never expose arbitrary event channels,
   commands, shell execution, or terminal input.
4. Register native bindings in `native.ts`. Start session-scoped listeners from the
   bridge's session lifecycle, not by starting resources in an extension factory.
   Keep live pending state while the transport is offline. The bridge snapshots that
   state on reconnect and forwards changes without retransmitting the transcript.
5. Register its React component in `web.tsx`. Use the provided disabled state and
   `onCommand` callback rather than creating another transport or bypassing Pim's
   mutation/uncertainty guards. Render only validated data. Use
   `frontend/src/components/safe-markdown.ts` for rich Markdown content so raw HTML,
   image URLs, and unsafe links use the same policy as the transcript.
6. Dispose listeners and mark in-flight action outcomes unknown on native session
   replacement or shutdown. A transport disconnect alone must not dismiss native UI,
   discard live pending state, or trigger a second runtime.
7. Resolve an action only after the extension's documented acceptance signal. Reject
   only before dispatch or after an explicit rejection. Missing, malformed, or lost
   verdicts are unknown outcomes. Never replay actions automatically.
8. Test malformed data, stale/closed requests, concurrent interactions, replies from
   the terminal, reconnects, and lost verdicts. Use fake public contexts and isolated
   local transports, without user settings, real sessions, or model calls.
9. Update the support list below, `README.md`, and `PLAN.md`. State native integration
   verification separately from mocked transport coverage.

Support is intentionally implemented one extension at a time, not through a universal
UI schema or automatic plugin discovery. Pending interactions use the three explicit
registration files above. Persisted tool-result rendering may also need a dedicated
frontend parser/component and explicit wiring in `frontend/src/transcript.tsx`, as Ask
currently uses `ask-history.ts` and `ask-history-card.tsx`. Document both the pending UI
and history-rendering entry points in the extension's README. Keep the normal raw tool
fallback when persisted results are missing or unsupported.

Common transport and synchronization code should not acquire extension-specific
branches. Extract helpers only when more than one module needs them.

## Supported modules

| Folder | Native extension | Surface |
| --- | --- | --- |
| [ask-user-question](ask-user-question/README.md) | `@juicesharp/rpiv-ask-user-question` | Questions, selections/custom text, notes, previews, cancellation |

An extension without a usable public API may need an upstream change. Custom terminal
components do not translate automatically. Missed events from before the bridge loaded,
unfinished tools after a Pi restart, and child sessions on a different event bus are not
reconstructed from JSONL.

## Validation

```sh
npm run check
npm run typecheck
npm run build:server
node --test tests/extension-support.test.mjs tests/bridge.test.mjs
node --experimental-strip-types --test frontend/tests/extension-support.test.mjs frontend/tests/live.test.mjs
npm run build:frontend
```

The small test entry files register module-owned tests with the existing test commands.
Do not run real native-Pi integration or the full suite without an explicit request.

Native code uses `.js` imports where appropriate; shared TypeScript source can use `.ts`
imports so browser tests run without a build. TypeScript's
`rewriteRelativeImportExtensions` emits matching JavaScript paths in `dist`.
