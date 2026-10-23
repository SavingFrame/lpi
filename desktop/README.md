# Pim desktop

An Electron app for Pim with the same interface as the browser, plus persistent UI scaling
and native window menus. The UI is bundled locally and connects to an existing Pim relay.
Installers and production distribution are not available yet.

Closing or quitting the app leaves the relay and agents running. Create, Resume, and Stop
runtime actions still go through the relay; the desktop app does not run Pi or manage session files.

## Install and run

You need Node.js **22.19 or newer**, a graphical desktop session, and a configured
[Pim relay](../README.md#install-and-run).
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

Add `pim-app://app` to `origins` in the relay's `pim.config.json` if it is not already there.
The example config includes it. Restart the relay after changing configuration.

Start the configured relay in its own terminal:

```sh
npm run build:server
npm start -- pim.config.json
```

Start the desktop app in another terminal:

```sh
npm run desktop:start
```

This builds and opens the bundled UI. The relay does not need a separate browser frontend build.

## Connect to another relay

The default is `http://127.0.0.1:3141`. Select another relay when launching:

```sh
PIM_DESKTOP_SERVER=https://your-trusted-relay npm run desktop:start
```

Quit the existing desktop instance before changing the endpoint. Relay selection is not yet
available in Settings, and there is no automatic discovery.

Only HTTPS or loopback HTTP is accepted. Do not include credentials, paths, query parameters,
or fragments. For a remote plaintext relay, use an SSH loopback tunnel or trusted HTTPS.
Certificates are validated normally.

Allow `pim-app://app` on the remote relay too, and add its HTTPS origin to `origins` so the
hostname passes Host validation. Host/Origin checks are not authentication.

**Pim has no application authentication. Only use a trusted relay behind LAN, Tailscale,
or tunnel access controls. Do not expose it publicly.**

If the relay is unavailable, the local UI still opens and reports connection failures.
Reconnection does not replay commands or start another runtime. Drafts and uncertain-command
guards are stored separately for each relay.

## Appearance

Open **Settings > Appearance > UI scale** to scale the whole UI from 75% to 200% in 5% steps.
**Reset to 100%**, View-menu zoom controls, Ctrl/Cmd + Plus/Minus/0, and modified-wheel zoom
use the same preference. It persists across reloads and app restarts independently of relay settings.

Desktop data lives under `pim-desktop` in Electron's app-data directory, separate from browser
storage. Another launch with the same profile focuses the existing window.

## Keyboard

Open **Settings > Keyboard** to customize shortcuts, choose Enter behavior, and restore defaults.
Enter sends and Shift+Enter inserts a newline. Shift+Tab cycles supported thinking levels while
in the composer. Ctrl+H / Ctrl+L focuses the left / right pane, Ctrl+K searches sessions, and
Ctrl+Shift+P opens the command palette. Ctrl+, opens Settings.

Preferences are saved on this device. See [keyboard navigation](../docs/frontend.md#keyboard-navigation)
for all defaults and scope rules. Native menu and operating-system shortcuts may take precedence.

## Limitations

- Tabs, native notifications, deep links, installers, signing, and auto-updates are not implemented.
- External links and popups are currently blocked rather than opened in your browser.
- Files use the native Save As flow and never open automatically.
- macOS/Windows behavior and real-Pi integration remain unverified by the Linux smoke tests.

For development, architecture, security internals, and test commands, see
[desktop development](../docs/desktop-development.md).
