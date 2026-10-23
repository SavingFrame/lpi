# lpi desktop

An Electron app for lpi with the same interface as the browser, plus persistent UI scaling,
native window menus, and desktop notifications. The UI is bundled locally and connects to an existing lpi relay.
Installers and production distribution are not available yet.

Closing or quitting the app leaves the relay and agents running. Create, Resume, and Stop
runtime actions still go through the relay; the desktop app does not run Pi or manage session files.

## Install and run

You need Node.js **22.19 or newer**, a graphical desktop session, and a configured
[lpi relay](../README.md#install-and-run).
Linux also needs Electron's GTK/NSS/graphics libraries and working Chromium sandbox support.
Do not use `--no-sandbox`.

From the repository root:

```sh
npm ci --ignore-scripts
```

Electron downloads its binary on first use. To download it explicitly instead:

```sh
node node_modules/electron/install.js
```

Add `lpi-app://app` to `origins` in the relay's `lpi.config.json` if it is not already there.
The example config includes it. Restart the relay after changing configuration.

Start the configured relay in its own terminal:

```sh
npm run build:server
npm start -- lpi.config.json
```

Start the desktop app in another terminal:

```sh
npm run desktop:start
```

This builds and opens the bundled UI. The relay does not need a separate browser frontend build.

## Connect to another relay

The default is `http://127.0.0.1:3141`. Select another relay when launching:

```sh
LPI_DESKTOP_SERVER=https://your-trusted-relay npm run desktop:start
```

Quit the existing desktop instance before changing the endpoint. Relay selection is not yet
available in Settings, and there is no automatic discovery.

Only HTTPS or loopback HTTP is accepted. Do not include credentials, paths, query parameters,
or fragments. For a remote plaintext relay, use an SSH loopback tunnel or trusted HTTPS.
Certificates are validated normally.

Allow `lpi-app://app` on the remote relay too, and add its HTTPS origin to `origins` so the
hostname passes Host validation. Host/Origin checks are not authentication.

**lpi has no application authentication. Only use a trusted relay behind LAN, Tailscale,
or tunnel access controls. Do not expose it publicly.**

If the relay is unavailable, the local UI still opens and reports connection failures.
Reconnection does not replay commands or start another runtime. Drafts and uncertain-command
guards are stored separately for each relay.

## Appearance

Open **Settings > Appearance > UI scale** to scale the whole UI from 75% to 200% in 5% steps.
**Reset to 100%**, View-menu zoom controls, Ctrl/Cmd + Plus/Minus/0, and modified-wheel zoom
use the same preference. It persists across reloads and app restarts independently of relay settings.

Desktop data lives under `lpi-desktop` in Electron's app-data directory, separate from browser
storage. Another launch with the same profile focuses the existing window.

## Keyboard

Open **Settings > Keyboard** to customize shortcuts, choose Enter behavior, and restore defaults.
Enter sends and Shift+Enter inserts a newline. Shift+Tab cycles supported thinking levels while
in the composer. Ctrl+H / Ctrl+L focuses the left / right pane, Ctrl+K searches sessions, and
Ctrl+Shift+P opens the command palette. Ctrl+, opens Settings.

Preferences are saved on this device. See [keyboard navigation](../docs/frontend.md#keyboard-navigation)
for all defaults and scope rules. Native menu and operating-system shortcuts may take precedence.

## Session tabs

Opening or creating a session opens and activates a tab. Opening it again focuses the existing
tab. Tabs share one renderer and relay connection. Each session retains its draft and scroll
position when switching tabs. Open tabs and the active tab are restored per relay after restart;
this only opens views, never starts or resumes runtimes. Scroll positions are kept in memory.

Close a tab with its close button or Ctrl/Cmd+W. Closing a tab never stops its agent. Closing the
last tab leaves the sidebar available to open another session. Ctrl/Cmd+Shift+W closes the window.
Notification clicks open or focus the corresponding session tab. Tabs show running, input-needed,
and disconnected indicators, plus a green dot for an unviewed turn. Idle tabs have no status icon;
hover for status details. Inactive close buttons appear on hover or keyboard focus.
The browser UI is unchanged.

## Notifications

While the window is unfocused, native desktop notifications report finished turns, input
requests (including native-terminal prompts), and agent or compaction errors across sessions.
Click an alert to focus lpi and open that session. Archived sessions are excluded.
Notifications show the session title and up to 200 characters from the start of the agent’s final
response. Turns without response text, input requests, and errors use a generic status.
Response previews may be visible on your lock screen, depending on OS settings.

The window must remain open and connected. Notifications are best-effort, depend on OS
notification settings, and are not replayed after reloads or reconnects. Closing the last macOS
window stops notifications even though the app remains running.

## Limitations

- Deep links, installers, signing, and auto-updates are not implemented.
- External links and popups are currently blocked rather than opened in your browser.
- Files use the native Save As flow and never open automatically.
- macOS/Windows behavior and real-Pi integration remain unverified by the Linux smoke tests.

For development, architecture, security internals, and test commands, see
[desktop development](../docs/desktop-development.md).
