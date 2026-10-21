# Pim mobile

An **iOS-first React Native + Expo app using Tamagui** for the existing Pim relay.

**Status: planning only.** This folder contains documentation, not an application scaffold.
There are no mobile dependencies, install/run commands, or verified device builds yet.
See the [implementation plan](PLAN.md) for the shared-client refactor and delivery stages.

## Experience

The conversation is the main screen. Projects and sessions stay together in a drawer,
matching the browser's combined navigation:

- Swipe right from the left edge or tap the header button to open the drawer.
- Show recent sessions grouped into collapsible projects, with activity and unread
  indicators, older-session expansion, and per-project session creation.
- Select a session to close the drawer and show its conversation.
- Keep horizontal code scrolling usable; the drawer gesture must not capture every swipe.
- Restore the last selected session when it is still available on the configured server.
- Keep server setup and settings secondary, without separate project/session screens or
  an unnecessary tab bar.

Tamagui provides a customizable component foundation. Pim will have its own visual
identity, without requiring Apple's stock-app appearance or compact spacing. Native
interaction quality, readable content, and usable touch targets matter independently of
the visual style.

## Initial scope

- Live and saved current-branch conversations, streaming responses, Markdown/code, and
  inspectable tool activity/output.
- Message sending, using prompt while idle and steer while running, plus abort.
- Fresh session creation and explicit saved-session resume through the existing relay.
- Shared completion/read status, consistent with the browser.
- Ask User Question selections, custom answers, notes, previews, and cancellation where
  supported by the existing extension contract.

Unsupported dialogs remain terminal-only. Full browser parity, advanced tree/branch
navigation, Android validation, and background push notifications are deferred.
Model/thinking controls, image capture or picking, and other parity features can follow
the core end-to-end flow. Existing browser functionality is not being removed.

## Connection and runtime

Connect to the same Pim server over LAN or Tailscale. Native Pi stays on the host computer
and remains the only agent runtime and conversation-file writer. The app does not host a
relay, run Pi, or manage JSONL files.

The existing trusted-network model remains in place: no application authentication and
no public deployment in the initial scope. Anyone who can reach Pim can control connected
agents. Host/Origin checks are not authentication and must not be disabled for mobile.
See [server configuration and API](../docs/server.md).

App suspension or disconnection does not stop Pi and never authorizes another runtime.
Returning to the foreground must resynchronize from the relay, not automatically resend
messages, answers, create requests, or resume requests with uncertain outcomes.

## Shared architecture

Browser and mobile share client behavior, not UI components. The plan includes extracting
transport, synchronization, command/launch guards, session/read-state logic, and reusable
extension state into a framework-independent layer. Platform adapters provide storage,
visibility, and lifecycle signals; each client owns its rendering and navigation.

The browser will adopt that layer too. Backend/API refactors are allowed when they
simplify both clients, while preserving existing browser features and runtime-safety
guarantees. This is not a parallel mobile backend or a browser UI rewrite.

## Development status

The relay and browser already exist; mobile scaffolding and the shared-client extraction
are planned. There is no mobile package.json or verified dependency version matrix yet.
The app will get compatible, exactly pinned Expo/React Native/Tamagui dependencies during
scaffolding.

Use the [root README](../README.md) for the implemented project's setup and the
[root plan](../PLAN.md) for runtime constraints and current integration status.
