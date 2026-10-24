# Desktop development

For installation, relay selection, and appearance controls, see the
[desktop README](../desktop/README.md). Commands run from the repository root.

## Build and architecture

Electron bundles the existing React frontend and shared client code at `lpi-app://app/`.
It starts no local UI web server and never starts Pi or the relay.

`npm run build:desktop` builds without launching. `electron-vite` compiles the main process to `dist/desktop/main/index.js`, bundles the TypeScript
preload as sandbox-compatible CommonJS at `dist/desktop/preload/index.cjs`, and builds UI assets
in `dist/desktop/renderer/`. Shared support is bundled into the main process; there is no preload
copy step. Configuration lives in `desktop/electron.vite.config.ts`. Browser builds still use
`frontend/dist/` and share the React/Tailwind configuration.

The local page receives its relay endpoint through HTML metadata, not through the native IPC
bridge. HTTP requests and the event socket connect directly to that endpoint with normal
CORS/Origin checks. Desktop drafts and uncertain-command guards are scoped by the actual relay
address, not the shared local UI origin. Relay selection is not yet in Settings; there is no
automatic server discovery.

The shared settings page uses a typed platform adapter; browser users retain browser zoom.
Desktop session tabs live in `frontend/src/navigation/session-tabs.tsx`. The route selects one
session at a time through the existing shared client. Relay-scoped local storage saves the tab
set and active session; restoration never launches runtimes. The native Close Tab menu sends a
narrow preload event to the UI instead of closing the window.

## Development

```sh
npm run desktop:dev
# Select another relay:
LPI_DESKTOP_SERVER=https://your-trusted-relay npm run desktop:dev
```

`electron-vite dev --watch` builds main/preload, starts Vite at `http://127.0.0.1:5173`, and
launches Electron. Frontend edits use HMR, main-process edits restart Electron, and preload edits
reload its renderer. These actions leave the relay and Pi running. The main process accepts
`ELECTRON_RENDERER_URL` only as an exact HTTP loopback origin and never uses it when packaged.
The desktop config injects the relay endpoint into the dev page and aligns Vite's visual/API
proxies with it. `LPI_DEV_SERVER` remains the browser-development override; use
`LPI_DESKTOP_SERVER` for desktop development.

Port 5173 must be available; the tool never silently selects another port. Set
`LPI_DESKTOP_DEV_PORT=5174` to use another port explicitly, and add that exact HTTP loopback
origin to the relay configuration. Closing Electron on Linux/Windows or quitting on macOS stops
the dev process. Ctrl+C stops Electron and Vite only. On macOS closing the last window keeps the
app/Vite running; activation reopens it.

## Security and lifecycle

- Sandboxed, context-isolated renderer; Node integration disabled in pages, workers, and frames.
- A sandboxed preload exposes a close-tab subscription, get/set/subscribe UI-scale methods, and bounded notification
  delivery/click methods. Main-process IPC checks the exact window, top-level frame, trusted UI
  URL, and validated payloads. Native alerts are suppressed while the window is focused.
  It exposes no raw IPC objects/events, filesystem access, relay commands, or agent controls.
  Shared client code remains independent of Electron.
- Web security, CORS, and certificate validation stay enabled.
- Bundled pages have a CSP allowing local scripts/assets and connections to the selected relay.
  Inline scripts/eval and arbitrary external main-page resources are not enabled.
- Navigation is restricted to the local UI's `/` and `/app` routes (Vite's origin in development).
  External HTTP(S) link navigation and new-window requests open in the default browser using
  `shell.openExternal`; URLs with credentials and other schemes are rejected. Electron popups
  stay blocked. Subframe navigation and redirects never launch the browser.
- Local asset serving rejects other hosts, traversal, and symlinks escaping the bundle.
  API paths are not served or proxied by the bundled UI protocol.
- Visuals use the existing `/display` shell and opaque-origin blank/srcdoc frames, generated
  locally in bundled mode. Existing visual CSP permits HTTP(S) chart scripts/styles without
  granting relay access. Vite remains development-only and does not supply production CSP.
- Webviews, permission requests/checks, device permissions, and display capture are denied.
  Native notifications use main-process Electron APIs, not browser permission grants.
  Permission-gated clipboard APIs are not integrated.
- Downloads retain the native Save As flow; files never open automatically.
- Desktop storage lives in Electron's app-data directory under `lpi-desktop`, separate from
  browser storage. Reload guards are relay-scoped; there is no automatic runtime resume/stop.
- One desktop instance per profile; another launch focuses the current window. Standard native
  menus provide copy/paste, reload, and developer tools. Renderer-crash reload is explicit.

## Validation

```sh
npm run test:desktop
npm run test:desktop:smoke
npm run check
```

Unit tests build/type-check Electron and cover endpoint/navigation policy and bundled asset
handling. The Linux-only smoke test runs real Electron with temporary configuration, an isolated
relay without frontend files, no Pi runtimes, and no credentials. It checks bundled React and
visual rendering, cross-origin REST/preflight/WebSocket access, renderer isolation, navigation
and redirect blocking, relay survival on close, and local UI loading with the relay stopped.
It checks settings controls, real viewport scaling, keyboard/menu synchronization, invalid IPC
rejection, and persistence across reload/restart. The electron-vite launch/shutdown subtest uses
an isolated temporary port so it never interrupts an existing dev app. A graphical display
and Electron binary are required.

This does not establish real-Pi integration or macOS/Windows behavior. Manual platform checks
should include window reopening, app quit, downloads, attachment/paste, and development HMR.
Native notification delivery and click behavior require manual OS checks.
Default-browser link opening requires a manual OS check. Deep links, installers, signing,
auto-updates, and production distribution remain separate work. Bundling the UI is not an installer.
