import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, type BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron';
import { DESKTOP_ORIGIN, DESKTOP_SCHEME, desktopRelayOrigin } from '../src/shared/desktop.ts';
import { allowedNavigation, desktopDevelopmentOrigin } from './policy.ts';
import { bundledResponse } from './protocol.js';
import { createWindow, secureSession } from './window.js';
import { steppedZoom, ZoomSettings } from './zoom.js';

app.setName('Pim');
app.setPath('userData', join(app.getPath('appData'), 'pim-desktop'));

const development = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);
let origin: string;
let relay: string;
try {
  origin = development
    ? desktopDevelopmentOrigin(process.env.ELECTRON_RENDERER_URL ?? '')
    : DESKTOP_ORIGIN;
  relay = desktopRelayOrigin(process.env.PIM_DESKTOP_SERVER);
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

function saveZoom(value: unknown): number {
  const factor = zoom.set(value);
  if (window && !window.isDestroyed()) {
    window.webContents.setZoomFactor(factor);
    window.webContents.send('pim:zoom:changed', factor);
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
  const current = createWindow(origin, session.fromPartition('persist:pim'), zoom.factor);
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
    if (window === current) {
      window = undefined;
    }
  });
  current.webContents.on('render-process-gone', () => {
    if (!quitting && !current.isDestroyed()) {
      dialog.showMessageBoxSync(current, {
        type: 'error',
        message: 'Pim’s renderer stopped.',
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
        message: 'Could not load Pim.',
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
    zoom = new ZoomSettings(join(app.getPath('userData'), 'desktop-settings.json'));
    for (const channel of ['pim:zoom:get', 'pim:zoom:set']) {
      ipcMain.handle(channel, (event, value: unknown) => {
        const contents = window?.webContents;
        if (
          !contents ||
          contents.isDestroyed() ||
          event.sender !== contents ||
          event.senderFrame !== contents.mainFrame ||
          !allowedNavigation(event.senderFrame.url, origin, true)
        ) {
          throw new Error('UI scale is restricted to the desktop main frame.');
        }
        if (channel === 'pim:zoom:get') {
          return zoom.factor;
        }
        try {
          return saveZoom(value);
        } catch {
          throw new Error('Could not save UI scale.');
        }
      });
    }
    const desktopSession = session.fromPartition('persist:pim');
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
