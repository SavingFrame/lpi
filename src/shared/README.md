# Shared contracts

Browser-safe types, wire validators, and pure projections used by the relay, native bridge,
and frontend. There are no filesystem, socket, database, Pi runtime, or React dependencies.
Pi model/content types are imported with `import type` only.

- `sessions.ts`: project/session/inventory models and parsers, plus title normalization.
- `snapshots.ts`: native status, bridge/browser snapshots, parsers, and shared status/event
  projection. Saved snapshots do not require live runtime metadata.
- `commands.ts`: native registration identity and the guarded command union/parser.
- `session-tree.ts`: compact tree topology, bounded ancestry validation, and read-only branch preview contracts.
- `events.ts`: browser event envelope; payloads are validated by their consuming boundary.
- `client-state.ts`: messages, conversation views, bounded view parsing, and event reduction.
- `session-controls.ts`: model/thinking/context wire validation.
- `session-activity.ts`, `session-read-state.ts`: activity and completion/read semantics.
- `attachments.ts`: raster attachment validation and transport size limits.
- `errors.ts`: browser-safe validation errors and scalar checks.

Import these definitions directly rather than through server implementations or frontend
HTTP helpers. Do not add compatibility re-exports at old locations. Shared modules may
use browser-safe contracts from `src/extension-support/`; native bindings, React components,
and extension-specific UI remain outside this directory.

Validation remains at every network boundary. The bridge validates attach/sync/status and
commands; the browser validates HTTP responses and selected-session event payloads. Both
use the same view/control parsers and event/status projections, without sharing mutable
runtime state. Cursor, generation, buffering, and reconnect decisions stay in transport code.

`tests/shared-contracts.test.mjs` covers contract validation, projection invariants, and
source dependency boundaries. Run it after `npm run build:server`. Browser synchronization
and native bridge tests separately exercise the transport consumers. Real-Pi integration
remains unverified.
