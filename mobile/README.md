# Pim mobile

An iOS-first React Native + Expo app using Tamagui for the existing Pim relay.

**Status: conversation and core message controls implemented.** Connection setup, a combined project/session drawer,
persistent server/selection settings, foreground reconnect, and native live/saved
conversation rendering are implemented. The drawer uses flat session rows with dates and
compact status indicators. Conversations support Markdown, horizontally scrolling code and
tables and visible compact tool groups with per-call details. Thinking is hidden. Typechecking, mocked transport tests, and an iOS
JavaScript/Hermes bundle export pass. The workspace now targets SDK 57 to match the
user's physical-device Expo Go. Previous connection-screen startup was verified in Expo Go
58.0.5 with Xcode 27.1 and Node 22.23.3; SDK 57 device startup remains unverified. The user confirmed operation on a new iPhone 17
simulator (iOS 27.0) after the old iOS 17 device ignored system/app input. Simulator
screenshots and remote taps verify the drawer, tool detail expansion,
paired arguments/output, and vertical transcript scrolling against the configured relay.
The user reports physical-device validation complete and confirms the initial message controls
work on their phone. The simplified inline Send/Stop button still needs device interaction
validation. Read acknowledgments have isolated controller coverage. Custom native builds and real-Pi integration remain
unverified. See [the implementation plan](PLAN.md).

## Run

From the repository root, using Node.js 22.19+:

```sh
npm ci --ignore-scripts
npm run start --workspace @pim/mobile
```

Start the relay separately using the [root setup](../README.md). Open the app with a
matching Expo Go SDK 57 installation, or a compatible development build. Use a trusted
network for both Pim and Expo's development server. No EAS project, signing account, or
cloud service is configured.

For a physical iPhone, start Metro with `npm run start --workspace @pim/mobile -- --go --lan`
and scan its QR code with Camera, or open its `exp://<computer-LAN-IP>:8081` URL in Safari.
Allow Expo Go local-network access. Saving source files on the Metro host triggers Fast
Refresh; edits on another computer must be synced there first. After changing SDKs, install
dependencies again and restart Metro with `--clear`. No paid Apple account is needed for
an already-compatible Expo Go client.

On a Mac with Xcode and an iOS simulator, `npm run ios --workspace @pim/mobile` starts
Expo and requests the simulator. Expo Go simulator startup has been verified. Xcode 27
uses Device Hub instead of `Simulator.app`. If Expo does not focus the simulator window,
use `xcrun simctl list devices` to find its UDID, then open
`devices://device/open?id=<simulator-udid>` with macOS `open`. Android configuration exists,
but Android validation remains deferred. There is no mobile web target.

## Native iOS builds

The SDK 57 bundled native template still starts React Native in `AppDelegate`. Pim's
`plugins/with-ios-scene-lifecycle.cjs` prebuild plugin adopts Expo's scene lifecycle for
Xcode 27 / iOS 27: the app delegate provides the React Native factory, and Expo's scene
delegate creates the window and forwards lifecycle and deep-link events. The plugin also
registers the scene configuration in Info.plist. It fails if an upstream template changes
incompatibly, so review it when upgrading Expo. Native build and device validation are
separate from the template regression test.

On the Mac, run `npx expo prebuild --platform ios` from `mobile/`, then open
`ios/Pim.xcworkspace`. Configure your signing team in Xcode and select your phone. Use the
Release run configuration to bundle JavaScript without Metro. A free Personal Team needs
signing renewal every seven days and cannot enable remote push notifications. Avoid
`prebuild --clean` on a configured project unless you intend to recreate native settings.

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
- Conversations show user messages, assistant Markdown/partials, and collapsible system
  details. All thinking content is hidden, including empty thinking blocks. Empty assistant
  text does not create blank rows.
- Tool groups are always visible as compact rows under a small count/status heading.
  Rows show a truncated monospace command/path/search/script preview and status icons:
  a green check for completion, a red cross for errors, a native spinner while running,
  and an outlined minus for missing results. Accessibility labels retain status text.
  Only per-call arguments/output are collapsed. Calls and results pair by ID, and hidden
  thinking does not split groups. User messages and ordinary assistant responses separate
  groups.
  Arguments and output stay inspectable, including orphan results, live partial output,
  and errors. Missing results are not treated as successful completion; active tools are
  not duplicated in a separate footer.
- Code and tables scroll horizontally. Valid embedded conversation images render inline;
  unavailable/invalid images retain a placeholder. Raw HTML is displayed as text, and only
  HTTP(S)/mail links open.
- The compact header shows the session title and live/saved/offline state. Server settings
  and refresh live in the drawer. Session rows include dates, activity, and unread markers.
- The transcript uses an inverted native list with the latest content at offset zero and
  a 12-point trailing gap. Native visible-position anchoring preserves older reading positions.
  Following stays active across streaming and keyboard/composer resizing, pauses when scrolling
  back or inspecting details, and resumes through Latest or scrolling to the bottom.
  Controller tests cover follow/read eligibility; native anchoring, long transcripts, and
  keyboard interactions still need simulator/device validation.
- A multiline composer persists server/session-scoped drafts on this device. Send uses
  prompt while idle and steer while running. One button at the right of the input sends
  text/images, switches to Stop when Pi is running and the draft is empty, and shows a disabled
  spinner while submitting. Stop requests cancellation without clearing queued messages
  or dismissing native dialogs. Draft saving is silent; storage failures show a small icon
  with an on-demand retry dialog. The composer remains editable while a request is pending;
  acceptance preserves newer edits.
- Connected, Pim-managed sessions show a power icon in the top-right header to stop the runtime. A destructive
  confirmation explains that active work stops but saved history stays. Stop shares the
  composer command lane and rejects confirmations for an older runtime generation.
  Acknowledgment means shutdown was requested, not that exit is confirmed. Unmanaged
  terminal sessions do not show this control. Native interaction and real-Pi shutdown
  remain unverified.
- Shared durable command guards block dispatch until hydration, persist before sending,
  and recheck connectivity/generation after storage writes. Rejected requests retain the
  draft. Unknown outcomes block new commands across app restarts until explicit review;
  neither review nor reconnect resends anything. Draft storage errors expose explicit retry.
- Loaded completions are acknowledged only while synchronized, foregrounded, following
  the bottom, and outside the drawer/settings. Read failures expose explicit retry.
- The + button opens the system photo picker for screenshots/photos, with a fixed-height
  thumbnail strip above the input and removal controls that stay tappable with the keyboard
  open. Keyboard avoidance accounts for the outer safe-area top inset. Image-only messages are supported. Up to four PNG/JPEG/GIF/WebP
  images may total 4 MiB; larger/unsupported selections show an error without changing
  the draft. Picker output is checked by its bytes rather than the original asset MIME.
  Unsent images remain in memory across session switches but do not survive app restarts;
  only text drafts and command guards are persisted. Selection never sends automatically.
  No camera, microphone, or broad photo-library permission is requested by this flow.
  Read acknowledgments pause while the picker is open. Native picker interactions and
  end-to-end image delivery still need device validation.
- Each project has a + button for creating a fresh native Pi session through the relay.
  The acknowledged session is selected and the drawer closes unless selection changed while
  waiting. A shared durable launch lane blocks duplicate requests and survives app restarts.
  Unknown outcomes require runtime inspection and explicit review; review never retries.
  Creation UI and real-Pi launching still need device/integration validation.
- Saved conversations show a green Resume runtime power button in the same top-right header
  position as Stop runtime. It is enabled only when synchronized and requires explicit confirmation
  that no Pi process still uses the file. Resume keeps server-side reservation and external-writer
  protections, uses its own durable lane, and refreshes the same conversation after acknowledgment.
  Unknown resume outcomes require inspection and explicit review. Reconnect never resumes.
- Pending Ask User Question prompts open a native questionnaire sheet with single/multiple
  selections, custom text, per-question/global notes, Markdown previews, submission, and
  explicit cancellation. Close preserves the mounted draft without answering. Drafts are
  memory-only and reset on navigation or bridge generation changes. Answers share the
  composer command lane and require the native extension verdict; unknown outcomes block
  new commands without replay. Read acknowledgments pause while the sheet is open.
  Resume and questionnaire controls have isolated transport tests, but native interaction
  and real-Pi integration remain unverified. Model/thinking controls remain deferred.

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
| Expo / Expo Router | 57.0.31 / 57.0.29 |
| React / React Native | 19.2.3 / 0.86.3 |
| Tamagui / config | 3.1.2 |
| AsyncStorage | 2.2.0 |
| Expo ImagePicker | 57.0.20 |
| Drawer layout | 4.2.12 |
| Gesture Handler / Reanimated / Worklets | 2.32.0 / 4.5.1 / 0.10.1 |

Expo's published SDK dependency matrix supplies native package versions. Mobile uses React
and React DOM 19.2.3, while the browser stays on 19.3.0. Expo's monorepo autolinking resolver
keeps the mobile bundle on one React copy; an exported source map confirms this. Mobile has
its own TypeScript 6.0.3 while root tooling retains TypeScript 5.9.3. Expo's default Metro
workspace support loads shared source without custom resolver aliases. Root overrides keep
Expo, Expo Font, React Native, its Metro config, Gesture Handler, Reanimated, and Worklets
on the SDK 57 versions across transitive peer dependencies. Tamagui uses its standard runtime, system
fonts, explicit native style props, and no optimizing compiler plugin.

- `src/app/`: Expo Router entry and provider shell.
- `src/features/`: connection form, grouped drawer, conversation preview.
- `src/lib/`: native storage/network construction and read-only lifecycle binding.
- `src/theme/`: mobile presentation colors.
- `tests/`: isolated `node:test` transport/lifecycle fixtures, with no native imports.
- `../src/client/`: shared browser/mobile behavior, already consumed by the browser.

Markdown uses the exactly pinned `marked` 18.0.11 lexer with native Text/View rendering,
not a WebView. Transcript and drawer layout use explicit React Native styles rather than
Tamagui's default button/text presentation; Tamagui remains the app's provider/form foundation.

The mobile composer and read acknowledgments use the shared mutation guards, durable
drafts, and read-completion controller. Mobile extension rendering is registered explicitly
in `src/extensions/index.tsx`; Ask uses the shared questionnaire draft helpers and native
Markdown renderer, without browser components or CSS.

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
Expo Go startup, drawer taps, tool detail expansion, and vertical transcript scrolling
have been checked on the simulator. Edge gestures, horizontal code scrolling, text selection,
and physical-device behavior still need validation. After moving to SDK 57, the dependency
audit reports 124 entries (2 moderate, 122 high). This is not a security-cleared dependency
set; no forced audit fixes or unrelated major changes were applied. Keep development
tooling private and review upstream fixes before distribution. No claim of production
readiness is made.
