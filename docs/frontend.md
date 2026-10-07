# Browser client

The client in `frontend/` uses React, TypeScript, Vite, TanStack Query, and TanStack Router. It only controls server-owned sessions. No browser-side agent runtime or independent session-file authority exists.

## Run

Production:

```sh
npm run build
npm start -- pim.config.json
```

Open `http://127.0.0.1:3141`. The backend serves `frontend/dist`. Browser routes use `/app/projects/:projectId/sessions/:sessionId` so deep links do not conflict with the REST session routes.

Development:

```sh
# Start the compiled backend in one terminal.
npm run build:server
npm start -- pim.config.json

# Run Vite in another terminal.
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/projects`, `/sessions`, and `/events` to `http://127.0.0.1:3141`. `PIM_DEV_SERVER` can override the target. Configure the exact browser origins in `pim.config.json`; the example includes production and development origins. Changing the backend port also requires updating production origins.

No authentication is enabled. Loopback binding, Host checks, Origin checks, and JSON content-type requirements remain enforced. A trusted local process can control the agent without credentials. Do not expose the server through a public proxy.

## State and commands

TanStack Query owns project/session catalog queries and mutations. A separate `LiveSession` external store owns the selected session's snapshot and event reducer. The shared reducer in `src/client-state.ts` reconstructs delta-only Pi messages and tracks running state, queues, and active tools.

Reconnects subscribe first, buffer events, read a snapshot, discard events at or before its epoch/cursor boundary, and apply newer events. Global cursors are validated even for sessions not currently displayed. Generation changes, compaction completion, turn completion, settled runs, and model/thinking changes trigger fresh inspection. A gap, server epoch change, or full buffer requires reconnecting. Snapshot reads that cannot find a stable observed event boundary remain visibly synchronizing and retry inspection.

Mutations never retry automatically. Each has a unique request ID and the current ownership generation. Acceptance is not execution completion. Unknown outcomes preserve the draft and block more commands until the user inspects the session and explicitly acknowledges the uncertainty. A pending marker in tab-scoped session storage also protects against reloading during submission.

The composer shows model and thinking selectors plus Pi’s current context usage estimate. Selectors remain available during runs and changes apply to the next model request, including tool continuations. Options come from the owning runtime; model changes refresh thinking capabilities too. Unknown context usage displays `?`, not zero. Disconnected/synchronizing/stopped sessions and uncertain mutations disable settings changes.

Drafts live in tab-scoped session storage. Markdown raw HTML is disabled, and image URLs are not loaded. Production assets use a same-origin content security policy.

## Limits and deferred work

- Transcripts show current runtime context, not the entire branch archive. Stopped sessions use pure JSONL/context projection without opening a writer.
- Unknown ownership cannot authorize start or reclaim.
- Dialog requests show a warning, but answers and full pending-dialog lifecycle are deferred. Abort is not guaranteed to dismiss a question.
- Production TUI handoff, authentication/remote deployment, and the separate iOS client are deferred.
- Real-Pi integration with installed extensions/configuration remains unverified.

## Validation

```sh
npm run check
npm run typecheck
npm run build
npm run test:frontend
# After build:server, focused backend snapshot/API tests:
node --test tests/snapshot.test.mjs tests/api.test.mjs
```

Synchronization tests use mocked browser transport. Backend tests use isolated fake RPC children, temporary HOME/configuration/session directories, and no model calls. A headless Chromium smoke check verified production deep links, runtime start, prompt submission, partial output, reload reconstruction, mobile width, and confirmed stop using only the fake Pi fixture.
