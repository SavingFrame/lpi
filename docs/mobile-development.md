# Mobile development

User setup, native build instructions, and runtime limits are in the
[mobile README](../mobile/README.md). Run commands below from the repository root.

## Architecture and layout

`mobile/` is an npm workspace using the root lockfile. Expo Router provides the app shell;
React Native and Tamagui provide native presentation. Dependency versions live in
[mobile/package.json](../mobile/package.json); root overrides keep transitive native
dependencies aligned with the Expo SDK.

Paths below are relative to `mobile/` unless stated otherwise:

- `src/app/`: Expo Router entry and provider shell.
- `src/features/`: connection form, grouped drawer, conversation UI.
- `src/lib/`: native storage/network adapters and lifecycle binding.
- `src/theme/`: mobile presentation colors.
- `src/extensions/index.tsx`: explicit mobile extension-renderer registration.
- `tests/`: isolated `node:test` fixtures.
- Repository-root `src/client/`: shared transport, synchronization, command guards,
  drafts, and completion-read controllers.

Keep shared behavior independent of React Native. Use platform adapters for storage,
networking, and lifecycle. Expo's default Metro workspace support loads shared source
without custom resolver aliases. Mobile and browser have separate React versions;
Expo's monorepo autolinking must keep the mobile bundle on one React copy.

Markdown is lexed with `marked` and rendered using native Text/View components.
Only explicit HTML artifacts use a WebView. Transcript and drawer layout use explicit
React Native styles; Tamagui supplies the provider/form foundation.

## State and interaction contracts

- Server settings, selection, text drafts, and uncertain-command guards are scoped to the
  normalized relay origin. Restore selection only if the session is still available.
- Foregrounding reconnects and synchronizes; suspension closes the client transport, not Pi.
  Ignore stale inventory responses.
- Persist command uncertainty before dispatch and recheck connectivity/generation after
  storage writes. Rejected submissions retain drafts; accepted submissions preserve newer edits.
  Unknown outcomes require explicit review and never trigger replay, including after restart.
- Fresh-session creation has a shared durable launch lane; resume guards are per session.
  Resume requires explicit offline confirmation. Stop acceptance is not proof of process exit.
- Read acknowledgments require a synchronized loaded completion, foreground visibility,
  and following the bottom. Pause while drawers, settings, sheets, or the photo picker are open.
- The inverted transcript keeps the newest content at offset zero. Preserve older reading
  positions, avoid blank-space anchoring for short histories, and pause following while
  inspecting older content.
- Tool calls/results pair by ID. Keep orphan results, errors, and missing-result states
  inspectable. Hidden thinking must not split tool groups.
- Images are validated by bytes. Text drafts persist; unsent images and questionnaire drafts
  are memory-only. Selecting an attachment never sends it.
- Ask answers share the command lane and require the authoritative native verdict.
  Unsupported dialogs remain terminal-only.
- Model/thinking changes require synchronized, connected, idle Pi with no queues or dialogs.

## HTML artifacts and networking

Explicit `show` results use a sandboxed iframe inside an incognito WebView.
CDN scripts, styles, and fonts are allowed over HTTP(S), subject to platform transport policy.
External images, fetch/XHR/WebSocket access, navigation, file access, cookies, and storage
remain restricted. The native callback accepts bounded size reports, never agent actions.
Normal Markdown must never become executable HTML. Mobile file export is not implemented.

The native iOS configuration declares local-network usage and
`NSAllowsLocalNetworking`, not `NSAllowsArbitraryLoads`. It does not bypass certificate
validation. These settings apply to a native build, not the installed Expo Go binary.

## Native iOS lifecycle

`mobile/plugins/with-ios-scene-lifecycle.cjs` adapts the SDK 57 native template to
Expo's scene lifecycle for Xcode 27 / iOS 27. The app delegate supplies the React Native
factory; the scene delegate creates the window and forwards lifecycle/deep-link events.
The plugin also registers scene configuration in Info.plist and fails on incompatible
template changes. Review it when upgrading Expo. Its regression test is not native
build or device validation.

## Simulator and remote testing

On a Mac with Xcode:

```sh
npm run ios --workspace @lpi/mobile
```

Xcode 27 uses Device Hub. If Expo does not focus the simulator, find its UDID with
`xcrun simctl list devices`, then use macOS `open` with
`devices://device/open?id=<simulator-udid>`.

For the prepared SSH Mac, use the [project iOS testing skill](../.pi/skills/ios-macos/SKILL.md).
Its helper syncs source, reuses Metro, opens the simulator, and captures screenshots/logs.
It does not provision macOS or install dependencies. Update remote dependencies explicitly
after manifest or lockfile changes.

Notification handoff checks are in [manual mobile testing](notifications.md#manual-mobile-testing).

## Validation

```sh
npm run check
npm run typecheck --workspace @lpi/mobile
npm exec --workspace @lpi/mobile -- expo install --check
npm run test --workspace @lpi/mobile
npm run bundle:ios --workspace @lpi/mobile
```

`bundle:ios` exports JavaScript/assets to ignored `mobile/dist/`; it is not a native build.
Tests use injected storage and transports, never real credentials, sessions, settings, or
model calls. Simulator and mocked-controller checks do not establish real-Pi integration.
Custom native builds and full native-Pi integration remain unverified.

Device checks must cover keyboard/follow behavior, long transcripts, gestures, text
selection, horizontal scrolling, image delivery, WebView isolation, background recovery,
storage, and actual LAN/Tailscale networking. Tamagui may emit Metro package-export fallback
warnings. Dependency audits have reported unresolved vulnerabilities; retrieve current
results rather than relying on historical counts. No production-readiness claim is made.
