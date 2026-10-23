import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, type BrowserWindow, dialog, Menu, protocol, session } from 'electron';
import {
  DESKTOP_DEV_ORIGIN,
  DESKTOP_ORIGIN,
  DESKTOP_SCHEME,
  desktopRelayOrigin,
} from '../src/shared/desktop.js';
import { bundledResponse } from './protocol.js';
import { createWindow, secureSession } from './window.js';

app.setName('Pim');
app.setPath('userData', join(app.getPath('appData'), 'pim-desktop'));

const development = !app.isPackaged && process.env.PIM_DESKTOP_DEV === '1';
const origin = development ? DESKTOP_DEV_ORIGIN : DESKTOP_ORIGIN;
let relay: string;
try {
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
  const current = createWindow(origin, session.fromPartition('persist:pim'));
  window = current;
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
    const desktopSession = session.fromPartition('persist:pim');
    secureSession(desktopSession);
    desktopSession.protocol.handle(DESKTOP_SCHEME, (request) =>
      bundledResponse(request, fileURLToPath(new URL('./renderer', import.meta.url)), relay),
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
    return openWindow();
  });
}
