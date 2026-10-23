import { fileURLToPath } from 'node:url';
import { BrowserWindow, type Session } from 'electron';
import { allowedNavigation } from './policy.js';

/** Apply once to the dedicated desktop session, before creating a renderer. */
export function secureSession(session: Session): void {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback(null));
  session.on('will-download', (_event, item) => {
    // Keep the normal native Save As flow. Never set a silent destination or open the file.
    item.setSaveDialogOptions({ title: 'Save Pim download' });
  });
}

export function createWindow(origin: string, session: Session, zoomFactor: number): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Pim',
    autoHideMenuBar: process.platform !== 'darwin',
    width: 1280,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      session,
      zoomFactor,
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event) => {
    if (!allowedNavigation(event.url, origin, true)) {
      event.preventDefault();
    }
  });
  contents.on('will-frame-navigate', (event) => {
    if (!allowedNavigation(event.url, origin, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event) => {
    if (!allowedNavigation(event.url, origin, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  return window;
}
