# Desktop app

Electron bundles the existing React frontend and shared client code. Normal launches load local
assets at `pim-app://app/`, not HTML from the relay or a `file://` page. No local web server is
started to serve the UI. Browser support remains available from the same frontend source.

The desktop connects to an **existing, separately running Pim relay** over HTTP/WebSocket.
It never starts Pi, tmux, or the relay, and never reads or writes Pi session files.
Closing, quitting, reloading, or crashing the desktop leaves agents and the relay running.
Explicit Create, Resume, and Stop runtime actions still go through the relay.

## Setup and launch

Use Node.js 22.19 or newer and a graphical desktop session. From the repository root:

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
cp pim.config.example.json pim.config.json
```

The Electron install step predownloads the binary and is optional: Electron 45 also downloads
a missing binary on first use. Linux needs Electron's normal GTK/NSS/graphics libraries and
working Chromium sandbox support. Do not use `--no-sandbox`.

Edit the project roots for your machine. For local-only access set `host` to `127.0.0.1`.
In an existing config, add these exact values to `origins`:

```json
"pim-app://app",
"http://127.0.0.1:5173"
```

The first allows the bundled UI; the second allows desktop development with Vite. The example
config includes both. Other custom origins and opaque `null` origins are not accepted. Checks apply
to REST, JSON preflight requests, and the event WebSocket. Restart the updated relay after
changing the config.

Start the relay in its own terminal:

```sh
npm run build:server
npm start -- pim.config.json
```

Start the app in another terminal:

```sh
npm run desktop:start
```

This builds the Electron code and frontend, then opens the bundled UI. It does not require
`frontend/dist` on the relay machine. `npm run build:desktop` builds without launching:
`electron-vite` compiles the main process to `dist/desktop/main/index.js`, bundles the TypeScript
preload as sandbox-compatible CommonJS at `dist/desktop/preload/index.cjs`, and builds UI assets
in `dist/desktop/renderer/`. Shared support is bundled into the main process; there is no preload
copy step. Configuration lives in `desktop/electron.vite.config.ts`. Browser builds still use
`frontend/dist/` and share the React/Tailwind configuration.

## Relay selection

Both desktop launch commands use `PIM_DESKTOP_SERVER`, defaulting to `http://127.0.0.1:3141`:

```sh
PIM_DESKTOP_SERVER=https://your-trusted-relay npm run desktop:start
```

Only HTTPS or loopback HTTP is accepted, without credentials, paths, query parameters, or
fragments. For a remote plaintext relay, use an SSH loopback tunnel or trusted HTTPS.
Certificates are validated normally. Allow `pim-app://app` on the remote relay too, and keep its
HTTPS origin in `origins` so its hostname passes Host validation.
Quit the existing desktop instance before changing the endpoint.

The local page receives its relay endpoint through HTML metadata, not through the native IPC
bridge. HTTP requests and the event socket connect directly to that endpoint with normal
CORS/Origin checks. Desktop drafts and uncertain-command guards are scoped by the actual relay
address, not the shared local UI origin. Relay selection is not yet in Settings; there is no
automatic server discovery.

There is **no application authentication** or desktop login/token flow. Host/Origin checks are
not authentication. Only connect to a trusted relay behind network/Tailscale policy or a tunnel.
Do not expose Pim publicly.

If the relay is unavailable, the bundled UI still opens and reports connection/query failures.
Reconnect does not replay agent commands or start another runtime.

## Appearance settings

Open **Settings** in the desktop sidebar and choose **UI scale** from 75% to 200% in 5% steps.
The scale affects text, controls, and layout, and applies immediately. **Reset to 100%** restores
the default. View > Zoom In/Out/Actual Size, Ctrl/Cmd + Plus/Minus/0, and modified-wheel zoom
use the same preference. It persists across reloads and app restarts in
`pim-desktop/desktop-settings.json` under Electron's app-data directory, independently of relay
configuration. Missing or corrupt preferences default to 100%; failed saves report an error.

Settings navigation is desktop-only. The shared settings page uses a narrow typed platform
adapter; browser users retain normal browser zoom. When migrating from the old custom launcher,
restart the dev command once to enable electron-vite's main/preload watching.

## Development

```sh
npm run desktop:dev
# Select another relay:
PIM_DESKTOP_SERVER=https://your-trusted-relay npm run desktop:dev
```

`electron-vite dev --watch` builds main/preload, starts Vite at `http://127.0.0.1:5173`, and
launches Electron. Frontend edits use HMR, main-process edits restart Electron, and preload edits
reload its renderer. These actions leave the relay and Pi running. The main process accepts
`ELECTRON_RENDERER_URL` only as an exact HTTP loopback origin and never uses it when packaged.
The desktop config injects the relay endpoint into the dev page and aligns Vite's visual/API
proxies with it. `PIM_DEV_SERVER` remains the browser-development override; use
`PIM_DESKTOP_SERVER` for desktop development.

Port 5173 must be available; the tool never silently selects another port. Set
`PIM_DESKTOP_DEV_PORT=5174` to use another port explicitly, and add that exact HTTP loopback
origin to the relay configuration. Closing Electron on Linux/Windows or quitting on macOS stops
the dev process. Ctrl+C stops Electron and Vite only. On macOS closing the last window keeps the
app/Vite running; activation reopens it.

## Security and lifecycle

- Sandboxed, context-isolated renderer; Node integration disabled in pages, workers, and frames.
- A sandboxed preload exposes only get/set/subscribe UI-scale methods. Main-process IPC checks
  the exact window, top-level frame, trusted UI URL, and bounded scale before changing preferences.
  It exposes no raw IPC objects/events, filesystem access, relay commands, or agent controls.
  Shared client code remains independent of Electron.
- Web security, CORS, and certificate validation stay enabled.
- Bundled pages have a CSP allowing local scripts/assets and connections to the selected relay.
  Inline scripts/eval and arbitrary external main-page resources are not enabled.
- Navigation is restricted to the local UI's `/` and `/app` routes (Vite's origin in development).
  Redirects follow the same rules. Popups/external links are blocked, not passed to the OS.
- Local asset serving rejects other hosts, traversal, and symlinks escaping the bundle.
  API paths are not served or proxied by the bundled UI protocol.
- Visuals use the existing `/display` shell and opaque-origin blank/srcdoc frames, generated
  locally in bundled mode. Existing visual CSP permits HTTP(S) chart scripts/styles without
  granting relay access. Vite remains development-only and does not supply production CSP.
- Webviews, permission requests/checks, device permissions, and display capture are denied.
  Native notifications and permission-gated clipboard APIs are not integrated.
- Downloads retain the native Save As flow; files never open automatically.
- Desktop storage lives in Electron's app-data directory under `pim-desktop`, separate from
  browser storage. Reload guards are relay-scoped; there is no automatic runtime resume/stop.
- One desktop instance per profile; another launch focuses the current window. Standard native
  menus provide copy/paste, reload, and developer tools. Renderer-crash reload is explicit.

## Validation and remaining work

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
Tabs, native notifications, external-link UX, deep links, installers, signing, auto-updates,
and production distribution remain separate work. Bundling the UI is not an installer.
