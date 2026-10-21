# Pim mobile

An iOS-first React Native + Expo app using Tamagui for the existing Pim relay.

**Status: read-only scaffold.** Connection setup, a combined project/session drawer,
persistent server/selection settings, foreground reconnect, and plain-text live/saved
conversation previews are implemented. Typechecking, mocked transport tests, and an iOS
JavaScript/Hermes bundle export pass. Connection-screen startup is verified in Expo Go
58.0.5 with Xcode 27.1 and Node 22.23.3. The user confirmed operation on a new iPhone 17
simulator (iOS 27.0) after the old iOS 17 device ignored system/app input. Custom native
builds, relay connectivity, detailed interactions, physical devices, and real-Pi integration
remain unverified. See [the implementation plan](PLAN.md).

## Run

From the repository root, using Node.js 22.19+:

```sh
npm ci --ignore-scripts
npm run start --workspace @pim/mobile
```

Start the relay separately using the [root setup](../README.md). Open the app with a
matching Expo Go SDK 58 installation, or a compatible development build. Use a trusted
network for both Pim and Expo's development server. No EAS project, signing account, or
cloud service is configured.

On a Mac with Xcode and an iOS simulator, `npm run ios --workspace @pim/mobile` starts
Expo and requests the simulator. Expo Go simulator startup has been verified. Xcode 27
uses Device Hub instead of `Simulator.app`. If Expo does not focus the simulator window,
use `xcrun simctl list devices` to find its UDID, then open
`devices://device/open?id=<simulator-udid>` with macOS `open`. Android configuration exists,
but Android validation remains deferred. There is no mobile web target.

## Prepared SSH Mac

From the repository root:

```sh
bash .pi/skills/ios-macos/scripts/ios-mac.sh run
bash .pi/skills/ios-macos/scripts/ios-mac.sh screenshot
bash .pi/skills/ios-macos/scripts/ios-mac.sh logs
```

`run` syncs source to the existing test directory, starts or reuses the correct Metro,
and opens Pim on the current simulator. Separate commands: `status`, `sync`, `start`,
`open`. The Bash helper lives beside the project skill and uses the Mac's existing Node
only for JSON parsing. Screenshots are copied to a local path for inspection. It does not provision
macOS, download toolchains, erase devices, or install npm dependencies. Update remote
dependencies explicitly if manifests/lockfile change. It refuses ambiguous simulator
selection and unrelated servers on port 8081. Source sync excludes environment files and
generated output, without deleting destination files.

Defaults target `user@192.168.100.209` and the existing private Node/Expo installation.
Override with `PIM_IOS_SSH`, `PIM_IOS_DIR`, `PIM_IOS_HOST`, or `PIM_IOS_DEVICE` (UDID).
The project-only [iOS testing skill](../.pi/skills/ios-macos/SKILL.md) records the setup,
commands, and known Device Hub/input issues.

## Current behavior

- Conversation is the main screen, without a tab bar.
- Tap Projects or swipe from the leftmost 24 points to open the drawer. The narrow edge
  gesture is intended to leave content scrolling available; device behavior is unverified.
- Projects collapse, older sessions expand, and active/unread/selected sessions remain
  visible outside the recent window. Selecting a session closes the drawer.
- Server settings are secondary. Server URLs and selected session IDs use AsyncStorage,
  scoped by normalized relay origin. A saved selection is restored only if available.
- Foreground connections use shared HTTP validation and snapshot/event synchronization.
  Suspension closes the client transport, not Pi. Late inventory responses are ignored.
- Previews show plain message text, assistant partials, image/tool placeholders, and live
  tool names. Markdown/code formatting and tool-output inspection are not implemented.
- Unread indicators are displayed, but mobile does **not** acknowledge completions yet.
- Sending, abort, create/resume, questionnaire answers, image picking, and model/thinking
  controls are not exposed. There are no placeholder mutation buttons or auto-launches.

## Connection and runtime

Enter a full relay origin, for example `http://192.168.1.20:3141` or an HTTPS Tailscale URL.
Paths, credentials, query parameters, and fragments are rejected. `localhost` on a phone
refers to that phone, not the relay computer.

Add the exact relay origin to Pim's configured `origins`, including its port. Allowed
Hosts are derived from those URLs. Native HTTP/WebSocket requests use their normal
platform networking; no Host/Origin checks are disabled or spoofed. Actual iOS networking,
permissions, and LAN/Tailscale interoperability remain unverified.

The iOS config declares a local-network usage description and the local-network ATS
exception (`NSAllowsLocalNetworking`). It does not enable `NSAllowsArbitraryLoads` or
bypass TLS verification. Prefer HTTPS, particularly for qualified Tailscale hostnames;
arbitrary HTTP hostnames may still be blocked by platform transport policy. These config
settings apply to a native app build, not to an already-installed Expo Go binary.

Pim trusts reachable LAN/Tailscale clients. There is no application authentication. Anyone
who can reach Pim can control connected agents. Keep it private. Native Pi stays on the
host and is the only agent runtime and conversation-file writer. The app neither runs Pi
nor manages JSONL files. Disconnection never authorizes another writer.

## Dependencies and layout

`mobile/` is an npm workspace using the root lockfile. Dependencies are exactly pinned:

| Foundation | Version |
| --- | --- |
| Expo / Expo Router | 58.0.17 / 58.0.25 |
| React / React Native | 19.3.0 / 0.88.0 |
| Tamagui / config | 3.1.2 |
| AsyncStorage | 2.2.0 |
| Drawer layout | 4.2.12 |
| Gesture Handler / Reanimated / Worklets | 3.3.0 / 4.7.1 / 0.13.0 |

Expo's published SDK dependency matrix supplies native package versions. React already
matches the browser; its version was not changed. Mobile has its own TypeScript 6.0.3
while root tooling retains TypeScript 5.9.3. Expo's default Metro workspace support loads
shared source without custom resolver aliases. A root override keeps Gesture Handler at
Expo's supported 3.3.0 across transitive peer dependencies. Tamagui uses its standard runtime, system
fonts, explicit native style props, and no optimizing compiler plugin.

- `src/app/`: Expo Router entry and provider shell.
- `src/features/`: connection form, grouped drawer, conversation preview.
- `src/lib/`: native storage/network construction and read-only lifecycle binding.
- `src/theme/`: mobile presentation colors.
- `tests/`: isolated `node:test` transport/lifecycle fixtures, with no native imports.
- `../src/client/`: shared browser/mobile behavior, already consumed by the browser.

The shared mutation guards, durable drafts, read-completion controller, and extension draft
helpers are ready for later mobile controls. Mobile extension rendering still needs its
own explicit registration; browser components and CSS must not be imported.

## Validation and known limitations

```sh
npm run check
npm run typecheck --workspace @pim/mobile
npm exec --workspace @pim/mobile -- expo install --check
npm run test --workspace @pim/mobile
npm run bundle:ios --workspace @pim/mobile
```

`bundle:ios` exports JavaScript/assets to ignored `mobile/dist/`. This is **not** an iOS
native build. Tests use injected storage and transports, never real credentials, sessions,
user settings, or model calls. Gesture feel, layout, text selection, long-list scrolling,
background recovery, native persistence, and actual networking require device validation.

The current Tamagui release emits Metro package-export fallback warnings. Export and
Expo Go connection-screen startup succeed; drawer, gesture, and transcript behavior still
need native validation. The dependency audit reports 19 high
severity entries propagated from two advisories in Expo's toolchain: `braces` stack
exhaustion (GHSA-vfj7-8cjw-p6xm) and `node-forge` signature verification
(GHSA-86w9-cpqp-85rv). The reviewed registry has no patched releases for either package;
npm's suggested major downgrades are not applied. Keep development tooling private and
review upstream fixes before distribution. No claim of production readiness is made.
