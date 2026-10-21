# Pim mobile plan

Status: shared-client foundation in progress. Validated HTTP transport, snapshot/event
synchronization, and async-storage command/launch guards live in `src/client/` and are
consumed by browser adapters. Guards wait for hydration, scope persisted markers by server,
and recheck eligibility after persistence. Draft persistence, inventory/read behavior, and
reusable extension state still need extraction. The mobile folder
contains documentation, not an app scaffold. Dependency installation and device verification
have not started. Current relay/browser implementation status is documented in the
[root plan](../PLAN.md). Real native-Pi integration remains unverified.

Paths in this document are relative to the repository root unless stated otherwise.
See the [mobile overview](README.md) for scope and navigation.

## Product and navigation

- Use React Native + Expo + Tamagui, targeting iPhone first. Connect to the same Pim relay
  over the trusted LAN/Tailscale network. No phone-side Pi runtime or conversation writer.
- Make the conversation the main screen. A rightward swipe from the left edge opens a
  drawer; a header button provides the same action. Keep horizontal code scrolling usable.
- Keep projects and sessions together in that drawer, not on separate screens. Show
  collapsible projects with recent sessions, running/needs-input/unread indicators,
  older-session expansion, and per-project creation. Selecting a session closes the
  drawer. Restore the last selection when it is still available on the configured server.
- Keep server connection setup and settings secondary. Do not add a tab bar without
  distinct destinations that justify it.
- Use Tamagui as a customizable component foundation, not a prescribed app design. Native
  interaction quality does not require Apple's stock-app appearance or compact layouts.
  Start with the standard runtime; experimental native-runtime optimizations are not a
  prerequisite. Enable platform-native integrations only where useful.

Initial core scope: current-branch live and saved conversations, streaming responses,
Markdown/code, inspectable tool activity/output, message sending, abort, fresh session
creation, explicit saved-session resume, shared read status, and Ask User Question answers
and cancellation. Sending follows the existing idle-prompt/running-steer behavior.
Unsupported dialogs remain terminal-only. Create/resume keeps existing tmux reservations,
external-writer confirmation, and uncertain-outcome handling.

Background push notifications, Android validation, full browser feature parity, and
advanced tree/branch navigation are deferred. These are mobile scope boundaries, not
permission to remove existing browser features. Model/thinking controls, image capture or
picking, and other parity features can be scheduled after the core flow works end to end.

## Shared behavior, separate presentation

Build one framework-independent client behavior layer consumed by the browser and mobile,
rather than copying the browser's controllers into a second implementation:

| Shared | Platform-specific |
| --- | --- |
| Contracts, validators, event/status projections | Components, styling, navigation, gestures |
| HTTP transport and snapshot/event synchronization | Transport construction and lifecycle bindings |
| Command/launch correlation and pending/uncertain guards | Storage implementation and app/tab visibility |
| Session inventory, activity, read eligibility, draft settlement | Transcript layout, scrolling, keyboard handling |
| Extension state/action validation and reusable questionnaire state | Browser and React Native extension rendering |

Keep pure contracts under `src/shared/` and extension-specific contracts under
`src/extension-support/`. Extract reusable client behavior into `src/client/`; do not add
DOM, React, React Native, Tamagui, filesystem, database, or Pi runtime dependencies there.
Platform adapters must supply storage and lifecycle signals without duplicating command
policy. Mobile extension rendering needs an explicit registration separate from the
existing browser and native-Pi registrations; it must not import browser CSS/components.

The browser must migrate to the shared layer as behavior is extracted. Preserve its
existing features and meaningful safety coverage. Backend/API changes are allowed when
they reduce duplication or clarify shared contracts. Update both clients and affected
contract tests together rather than adding a parallel mobile API or unrequested
compatibility paths. Do not turn this into an unrelated server or frontend rewrite.

## Proposed repository layout

Only `mobile/README.md` and `mobile/PLAN.md` exist today. The target layout is:

```text
mobile/
  README.md                 # Existing mobile overview
  PLAN.md                   # Existing implementation plan
  package.json
  app.config.ts
  tamagui.config.ts
  src/
    app/                    # Expo Router routes and app shell
    features/
      connection/
      sessions/             # Combined project/session drawer
      conversation/
    components/             # Shared mobile presentation
    lib/                    # Mobile platform adapters
    theme/
  tests/
src/client/                 # Framework-independent browser/mobile behavior
```

Keep the existing `frontend/`, relay, and extension layout. The mobile app gets its own
application dependencies, pinned to compatible exact Expo/React Native/Tamagui versions.
Resolve workspace/Metro wiring during scaffolding without forcing the browser's React
version to match Expo or loading multiple React copies into one app. Choose concrete
storage/rendering packages only after reviewing their compatibility and actual need.

## Safety and mobile lifecycle

- Subscribe and buffer before loading a snapshot, then apply only events newer than its
  epoch/cursor boundary. Reconnect, server restart, generation changes, and event gaps must
  resynchronize from authoritative state. Returning to the foreground is a normal recovery
  path, not authorization to launch/resume Pi or replay a mutation.
- Persist submission/launch guards before dispatch through an adapter that supports async
  mobile storage. Keep uncertain outcomes across app restart and server switching; scope
  persisted state by server and session/project as appropriate. An interrupted request
  must not silently become an available Send or Create button on next launch.
- Preserve unsent drafts and newer edits during pending/rejected/unknown submissions.
  Restoring a draft never submits it. Server changes must not leak drafts or commands into
  another server's sessions.
- Acknowledge only the completion loaded in a synchronized, visible conversation while
  following the bottom and the app is foregrounded. Opening the drawer or receiving a
  background event is not a read acknowledgment. Keep stale-completion protection.
- Distinguish disconnected, last-known history, saved/read-only, and synchronized live
  state. Disconnection never proves Pi exited. App suspension or termination must not
  stop native Pi, answer a questionnaire, or create another writer.
- Validate native HTTP/WebSocket behavior against existing Host/Origin rules and configured
  LAN/Tailscale addresses. Review iOS local-network permissions and transport policy;
  do not solve mobile connectivity by disabling server checks or exposing Pim publicly.

## Delivery stages

1. **Shared client foundation.** Read the existing transport/controllers and tests, extract
   behavior with explicit adapters, and migrate browser consumers incrementally. Keep
   focused regressions for reconnect ordering, stale generations, uncertain commands and
   launches, draft settlement, and shared read state. Adjust backend contracts only where
   both clients benefit.
2. **Expo/Tamagui foundation.** Pin compatible dependencies and add the mobile package,
   theme, connection setup, persistent server selection, and conversation/drawer shell.
   Verify a simulator build and device networking before treating setup as complete.
3. **Read-only end-to-end flow.** Connect to the relay, populate the grouped drawer, select
   live/saved sessions, render snapshots and streaming tools/messages, and synchronize
   foreground/reconnect transitions and shared read state.
4. **Core controls.** Add protected drafts, prompt/steer sending, abort, create/resume, and
   mobile Ask User Question rendering through the shared mutation guards. Surface explicit
   rejected/unknown outcomes; no automatic command or launch retry.
5. **Device validation.** Check real iPhone drawer gestures, keyboard/composer layout,
   long-transcript scrolling, code selection/scrolling, background/foreground recovery,
   LAN/Tailscale connectivity, and read-state synchronization with the browser.

Use isolated `node:test` fixtures for shared behavior and affected relay/browser contracts.
Keep meaningful browser regression coverage as consumers migrate. Device checks should
use isolated relay state and fake-native fixtures where possible, without real credentials
or paid model calls. Mocked transport and simulator results do not establish real iPhone
layout, native-Pi integration, or unattended background connectivity. Record each verified
scope separately. Real native-Pi integration still requires an explicit request.
