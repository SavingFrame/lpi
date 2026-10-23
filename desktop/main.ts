import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  type BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  protocol,
  session,
} from 'electron';
import appIcon from '../assets/brand/lpi-icon.png?asset';
import {
  DESKTOP_ORIGIN,
  DESKTOP_SCHEME,
  desktopRelayOrigin,
  isDesktopNotification,
} from '../src/shared/desktop.ts';
import { allowedNavigation, desktopDevelopmentOrigin } from './policy.ts';
import { bundledResponse } from './protocol.js';
import { createWindow, secureSession } from './window.js';
import { steppedZoom, ZoomSettings } from './zoom.js';

app.setName('lpi');
app.setPath('userData', join(app.getPath('appData'), 'lpi-desktop'));

const development = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
let origin: string;
let relay: string;
try {
  origin = development
    ? desktopDevelopmentOrigin(process.env.ELECTRON_RENDERER_URL ?? '')
    : DESKTOP_ORIGIN;
  relay = desktopRelayOrigin(process.env.LPI_DESKTOP_SERVER);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid desktop URL');
  app.exit(1);
  throw error;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const primary = app.requestSingleInstanceLock();
if (!primary) {
  app.quit();
}

let quitting = false;
let window: BrowserWindow | undefined;
let zoom: ZoomSettings;
const notifications = new Map<string, Notification>();

function saveZoom(value: unknown): number {
  const factor = zoom.set(value);
  if (window && !window.isDestroyed()) {
    window.webContents.setZoomFactor(factor);
    window.webContents.send('lpi:zoom:changed', factor);
  }
  return factor;
}

function changeZoom(direction: -1 | 0 | 1): void {
  try {
    saveZoom(direction === 0 ? 1 : steppedZoom(zoom.factor, direction));
  } catch {
    dialog.showErrorBox(
      'Could not save UI scale',
      'Check desktop profile permissions and try again.',
    );
  }
}
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  } else if (!quitting) {
    void openWindow();
  }
});

async function openWindow(): Promise<void> {
  const current = createWindow(origin, session.fromPartition('persist:lpi'), zoom.factor);
  window = current;
  const contents = current.webContents;
  contents.setZoomMode('isolated');
  contents.on('did-finish-load', () => contents.setZoomFactor(zoom.factor));
  contents.on('zoom-changed', (_event, direction) => changeZoom(direction === 'in' ? 1 : -1));
  contents.on('before-input-event', (event, input) => {
    const command = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type !== 'keyDown' || !command || input.alt) {
      return;
    }
    if (['+', '=', '-', '0'].includes(input.key)) {
      event.preventDefault();
      changeZoom(input.key === '0' ? 0 : input.key === '-' ? -1 : 1);
    }
  });
  current.on('closed', () => {
    for (const notification of notifications.values()) {
      notification.close();
    }
    notifications.clear();
    if (window === current) {
      window = undefined;
    }
  });
  current.webContents.on('render-process-gone', () => {
    if (!quitting && !current.isDestroyed()) {
      dialog.showMessageBoxSync(current, {
        type: 'error',
        message: 'lpi’s renderer stopped.',
        detail: 'Use View > Reload to reconnect. Pi sessions continue independently.',
      });
    }
  });
  while (!quitting && !current.isDestroyed()) {
    try {
      await current.loadURL(origin);
      return;
    } catch {
      if (quitting || current.isDestroyed()) {
        return;
      }
      const { response } = await dialog.showMessageBox(current, {
        type: 'error',
        message: 'Could not load lpi.',
        detail: development
          ? 'Check that Vite is running. The desktop app does not start the relay or Pi.'
          : 'Build the local UI with npm run build:desktop. The relay and Pi run independently.',
        buttons: ['Retry', 'Close'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) {
        current.close();
        return;
      }
    }
  }
}

app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (!quitting && !window) {
    void openWindow();
  }
});
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());

if (primary) {
  void app.whenReady().then(() => {
    app.dock?.setIcon(appIcon);
    zoom = new ZoomSettings(join(app.getPath('userData'), 'desktop-settings.json'));
    for (const channel of ['lpi:zoom:get', 'lpi:zoom:set', 'lpi:notify']) {
      ipcMain.handle(channel, (event, value: unknown) => {
        const contents = window?.webContents;
        if (
          !contents ||
          contents.isDestroyed() ||
          event.sender !== contents ||
          event.senderFrame !== contents.mainFrame ||
          !allowedNavigation(event.senderFrame.url, origin, true)
        ) {
          throw new Error('Desktop controls are restricted to the desktop main frame.');
        }
        if (channel === 'lpi:notify') {
          if (!isDesktopNotification(value)) {
            throw new Error('Invalid desktop notification.');
          }
          const current = window;
          if (!current || current.isFocused() || !Notification.isSupported()) {
            return;
          }
          const bodies = {
            finished: 'Agent finished responding.',
            input: 'Agent needs your input.',
            error: 'Agent encountered an error.',
          };
          try {
            notifications.get(value.sessionId)?.close();
            notifications.delete(value.sessionId);
            if (notifications.size >= 32) {
              const oldest = notifications.keys().next().value;
              if (oldest !== undefined) {
                notifications.get(oldest)?.close();
                notifications.delete(oldest);
              }
            }
            const notification = new Notification({
              title: value.title || 'lpi',
              body: bodies[value.kind],
              icon: appIcon,
            });
            const remove = () => {
              if (notifications.get(value.sessionId) === notification) {
                notifications.delete(value.sessionId);
              }
            };
            notification.on('close', remove);
            notification.on('failed', remove);
            notification.on('click', () => {
              if (current.isDestroyed() || current.webContents.isDestroyed()) {
                return;
              }
              if (current.isMinimized()) {
                current.restore();
              }
              current.show();
              current.webContents.send('lpi:notification:clicked', value);
              current.focus();
            });
            notifications.set(value.sessionId, notification);
            notification.show();
          } catch {
            // OS notification availability must not affect the relay connection.
          }
          return;
        }
        if (channel === 'lpi:zoom:get') {
          return zoom.factor;
        }
        try {
          return saveZoom(value);
        } catch {
          throw new Error('Could not save UI scale.');
        }
      });
    }
    const desktopSession = session.fromPartition('persist:lpi');
    secureSession(desktopSession);
    desktopSession.protocol.handle(DESKTOP_SCHEME, (request) =>
      bundledResponse(request, fileURLToPath(new URL('../renderer', import.meta.url)), relay),
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: () => changeZoom(1) },
            { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => changeZoom(-1) },
            { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: () => changeZoom(0) },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        { role: 'windowMenu' },
      ]),
    );
    return openWindow();
  });
}
