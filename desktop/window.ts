import { fileURLToPath } from 'node:url';
import { BrowserWindow, type Session, shell } from 'electron';
import appIcon from '../assets/brand/lpi-icon.png?asset';
import { allowedExternalUrl, allowedNavigation } from './policy.js';

/** Apply once to the dedicated desktop session, before creating a renderer. */
export function secureSession(
  session: Session,
  appOrigin: string,
  hasHttpRelay: () => boolean,
): void {
  // Chromium may require Local Network Access for private relays. The bundled
  // main frame still has a connect-src allowlist of exact configured endpoints.
  const localNetwork = (permission: string, mainFrame: boolean, url?: string) =>
    (permission === 'local-network' || permission === 'local-network-access') &&
    mainFrame &&
    url !== undefined &&
    allowedNavigation(url, appOrigin, true) &&
    hasHttpRelay();
  session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      origin === appOrigin &&
      localNetwork(permission, details.isMainFrame, details.requestingUrl ?? contents?.getURL()),
  );
  session.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(localNetwork(permission, details.isMainFrame, details.requestingUrl)),
  );
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback(null));
  session.on('will-download', (_event, item) => {
    // Keep the normal native Save As flow. Never set a silent destination or open the file.
    item.setSaveDialogOptions({ title: 'Save lpi download' });
  });
}

export function createWindow(origin: string, session: Session, zoomFactor: number): BrowserWindow {
  const window = new BrowserWindow({
    title: 'lpi',
    icon: appIcon,
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
  const openExternal = (url: string): void => {
    if (allowedExternalUrl(url) && !allowedNavigation(url, origin, true)) {
      void shell.openExternal(url).catch((error: unknown) => {
        console.error('Could not open external link:', error);
      });
    }
  };
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => {
    if (!allowedNavigation(event.url, origin, event.isMainFrame)) {
      event.preventDefault();
      if (event.isMainFrame) {
        openExternal(event.url);
      }
    }
  });
  contents.on('will-redirect', (event) => {
    if (!allowedNavigation(event.url, origin, event.isMainFrame)) {
      event.preventDefault();
    }
  });
  return window;
}
