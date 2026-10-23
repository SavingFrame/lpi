# Shared client behavior

Framework-independent relay behavior for browser and mobile. No React, DOM, native UI,
filesystem, database, or Pi runtime dependencies belong here.

- `api.ts`: validated HTTP endpoints, request correlation, cancellation/timeouts, and
  unknown mutation outcomes. Inject fetch/addressing and request-ID generation.
- `live.ts`: subscribe/buffer/snapshot synchronization, event projections, generation and
  cursor recovery. Inject socket construction and snapshot loading. Lifecycle adapters
  call `disconnect()` when suspending and `connect()` when returning; neither method
  dispatches commands or launches Pi. Disconnected history stays visible but not ready.
  The eight most recently viewed snapshots stay in memory for immediate session switching.
  Cached live history stays visible but read-only until a fresh snapshot and buffered events
  synchronize, including when a refresh is interrupted and the session is selected again.
  Cached saved sessions are ready without fetching again while the socket stays connected.
  Events for inactive sessions invalidate their caches; reconnecting clears all caches.
  Manual refresh always fetches fresh state. Background sessions are not projected live.
- `commands.ts`: one protected command lane per session, including extension answers.
- `launches.ts`: one shared fresh-launch lane and individual saved-session resume lanes.
- `mutation-guard.ts`: storage hydration, synchronous in-memory exclusion, persistence
  before dispatch, explicit inspection, and uncertain outcomes without replay.
- `storage.ts`: sync/async storage contract, serialized per-key operations, and scoped keys.
- `drafts.ts`: server/session-scoped async draft hydration, ordered persistence, branch
  suggestions, and acceptance settlement that preserves newer text and attachment edits.
- `inventory.ts`: indexed search with single-pass filter results, project grouping, recency
  ordering, offline activity, activity counts, and recent/selected/active/unread session visibility.
- `read-completion.ts`: loaded-completion eligibility and one-attempt acknowledgment with
  explicit retry, lifecycle gating, and isolation of late verdicts.

## Adapter requirements

Use a stable, normalized server identity when constructing controllers. Bind dispatch,
connection access, and persisted keys to that server, not a mutable global selection.
Keep controllers for inactive servers isolated. Server switching must not rebind an
outstanding request to another server.

Reuse one storage adapter object within a client process. Guard storage operations are
serialized per adapter/key so a remount cannot read through an outstanding marker write.
This is not a cross-process lock or authorization for multiple Pi writers. Mobile storage
must be durable across app restart; the browser adapter retains its tab-scoped storage.

Call `initialize()` before offering mutation controls. Loading or unreadable persisted
state must never authorize dispatch. Initialization does not replay a request. Persisted
markers require explicit review even when the old controller has since received a verdict.

Command dispatch rechecks connection identity and generation after the async marker write.
Mobile lifecycle bindings must make the connection unavailable while backgrounded. Launch
adapters supply `eligible()`, which must become false while their server is inactive or the
app is backgrounded. Neither foreground recovery nor eligibility changes retry a mutation.
Keep one launch controller per server so all create/resume buttons share their lanes.

Storage failures before dispatch send nothing. Cleanup failures after dispatch preserve
uncertainty, including after a known rejection. `review()` is async and blocks the lane
while removing its marker; failed removal cannot clear an uncertain state.

Keep one `SessionDrafts` registry per server for the client lifetime. Remounts share the
latest draft, so a late submission verdict cannot overwrite edits made on another view.
Restoration never submits. Call `initialize()` before sending, observe storage errors,
and offer explicit `retry()`; unreadable storage is not automatically overwritten.
`persistImages` is an explicit platform policy. Browser drafts persist text in tab storage
and retain image attachments only in memory. Native adapters can opt into validated image
persistence. `flush()` waits for queued writes; failures remain visible in draft state.

Bind `ReadCompletions` to one server and supply the current loaded-completion target using
`completionToView()`. Visibility must mean the conversation itself is visible, the app is
foregrounded, and the transcript is following the bottom. Opening a navigation drawer
must not create an eligible target. Call `synchronize()` on snapshot/lifecycle changes;
failed acknowledgments require explicit `retry()`, which rechecks eligibility. Server-side
conditional completion IDs remain authoritative for stale-acknowledgment protection.

Questionnaire selection/custom-answer/note behavior remains extension-specific in
`src/extension-support/ask-user-question/draft.ts`, with no browser UI dependencies.
Native mobile rendering is registered explicitly under `mobile/src/extensions/`, using
these helpers and the shared command lane. Native interaction validation remains pending.

Shared behavior is covered with injected storage and transport in `frontend/tests/`.
These checks do not verify native storage, iOS builds/networking, device lifecycle, or
real native-Pi integration.
