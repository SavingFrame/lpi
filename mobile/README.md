# lpi mobile

An iOS-first app for following and controlling your native Pi sessions from your phone.
It connects to an existing lpi relay. Pi and your conversation files stay on the relay host.

The app currently runs through Expo Go or a local native build. No App Store release or
prebuilt installer is available.

## Features

- Browse live and saved conversations by project, with activity and unread indicators.
- Archive and restore sessions across clients.
- Browse live working-tree changes and full-screen file diffs, without tabs or split panes.
- Read streaming Markdown, code, tables, images, and expandable tool details. Thinking is hidden.
- View image and interactive HTML artifacts, including CDN-backed charts when online.
- Send text and images, steer running agents, and stop a response.
- Create, resume, and stop lpi-managed runtimes.
- Choose models and thinking levels, and answer supported Ask User Question prompts inline.
- Keep text drafts and relay settings on your device.
- Open sessions from optional Home Assistant completion notifications.

## Run with Expo Go

You need Node.js **22.19 or newer**, a running [lpi relay](../README.md#install-and-run),
and an Expo Go installation compatible with **Expo SDK 57**. Keep both the relay and Expo's
development server on a trusted network. No paid Apple developer account is needed for Expo Go.

From the repository root:

```sh
npm ci --ignore-scripts
npm run start --workspace @lpi/mobile -- --go --lan
```

Scan the QR code with the iPhone Camera, or open `exp://<computer-LAN-IP>:8081` in Safari.
Allow Expo Go local-network access. The computer running Expo must be reachable from your phone.
After changing SDKs, reinstall dependencies and restart Metro with `--clear`.

For simulator setup and source development, see [mobile development](../docs/mobile-development.md).

## Connect to your relay

In the app's server settings, enter the full relay origin, for example:

```text
http://192.168.1.20:3141
```

`localhost` on your phone refers to the phone, not your computer. Do not include paths,
credentials, query parameters, or fragments. Use the relay address, not the Expo development
server address. Before saving or switching servers, the app checks relay inventory responses
and the event WebSocket handshake with a five-second timeout. Failed or cancelled checks
keep your previous server settings and connection.

Configure the relay to listen on a reachable address and add that exact relay URL, including
its port, to `origins` in `lpi.config.json`. Restart the relay after changing its configuration.
Prefer HTTPS, especially for qualified Tailscale hostnames. Some HTTP hostnames may be blocked
by iOS transport policy; certificate validation is not bypassed.

**lpi has no application authentication. Anyone who can reach the relay can control connected
agents. Keep it behind trusted LAN, Tailscale, or tunnel access controls.**

## Using the app

Open **Projects**, or swipe from the left edge, to select a conversation. Server settings and
refresh are in the drawer. Use a project's **+** button to create a new native Pi session.

The header **Changes** icon opens a full-screen changed-file list with addition/deletion
counts. Tap a file for its unified diff, with line numbers and horizontal scrolling for long
lines. Changes update automatically while this view is open, including edits made outside Pi.
The last loaded file count stays on the icon; closing the view or backgrounding the app pauses
its subscription. Returning refreshes without changing the selected file. A file that becomes
clean stays selected with an explanatory message. Changes are read-only and do not mark the
covered conversation read. Lines longer than 2,000 characters are explicitly shortened for
display. Git and the relay's normal Diff output limits apply.

The composer sends a prompt while idle and steers while the agent is running. With an empty
draft during a run, its button becomes **Stop**, which requests response cancellation without
clearing queues or dismissing native dialogs. Tap the model/thinking pill to change settings
while Pi is idle with no queued messages or dialogs.

The attachment **+** opens the photo picker. Up to four PNG, JPEG, GIF, or WebP images may total
4 MiB per message. Image-only messages are supported with an image-capable model. Text drafts
survive app restarts; unsent images do not.

The header power button stops a connected lpi-managed runtime **without confirmation**.
This interrupts active work but keeps saved history. Externally managed runtimes must be stopped
in their terminal. Saved sessions offer **Resume runtime**, which requires confirmation that no
other Pi process is using the file. A disconnected session may still be running.

Closing or backgrounding the app does not stop Pi. Reconnection does not automatically resend
commands or resume runtimes. If a command's outcome is unknown, inspect the runtime before
explicitly reviewing the warning. Review does not resend the command.

## Native iOS builds

You need a Mac with Xcode and an Apple signing team. No EAS project or cloud build service is
configured. From `mobile/`:

```sh
npx expo prebuild --platform ios
```

Open `ios/lpi.xcworkspace` in Xcode, configure your signing team, and select your phone.
Use the **Release** run configuration to bundle JavaScript without Metro. A free Personal Team
requires signing renewal every seven days and cannot enable remote push notifications.
Avoid `prebuild --clean` unless you intend to recreate native settings.

Custom native builds remain unverified. See [native lifecycle details](../docs/mobile-development.md#native-ios-lifecycle)
when changing Expo or the generated iOS project.

## Notification session links

Optional alerts use the Home Assistant Companion app, so lpi needs no push entitlement or
paid Apple membership. See [notification setup](../docs/notifications.md).

A native lpi build registers links such as `lpi:///?session=<inventory-session-id>`.
They open history on the app's currently configured relay, without starting Pi or switching
servers. Missing sessions show an error. iOS opens Home Assistant first, then redirects to lpi;
the first handoff may require confirmation.

Expo Go cannot handle `lpi://`. For development, use
`exp://<metro-host>:8081/--/?session=<inventory-session-id>` while Metro is reachable.
Automatic relay notifications target native lpi, not Expo Go. See the
[manual notification checks](../docs/notifications.md#manual-mobile-testing).

## Limitations

- iOS is the primary target. Android configuration exists but is unvalidated; there is no mobile web target.
- Some native interactions, networking scenarios, custom builds, and full native-Pi integration
  still require validation. Do not treat simulator or mocked-test coverage as production readiness.
- Unsupported Pi dialogs still require the terminal. HTML artifact file export is not implemented.
- Dependency audits have reported unresolved vulnerabilities. Keep development tooling private
  and review current dependency security before distribution.

For implementation, testing, and repository layout, see [mobile development](../docs/mobile-development.md).
