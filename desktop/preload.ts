import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import { type DesktopPlatform, isDesktopNotification } from '../src/shared/desktop.ts';

// Expose narrow desktop controls, never IPC objects, events, or arbitrary channels.
if (window.top === window) {
  const platform: DesktopPlatform = {
    copyText: (text) => ipcRenderer.invoke('lpi:clipboard:write', text),
    onCloseTab: (listener) => {
      const close = () => listener();
      ipcRenderer.on('lpi:tab:close', close);
      return () => ipcRenderer.removeListener('lpi:tab:close', close);
    },
    notify: (notification) => ipcRenderer.invoke('lpi:notify', notification),
    onNotificationClicked: (listener) => {
      const clicked = (_event: IpcRendererEvent, value: unknown) => {
        if (isDesktopNotification(value)) {
          listener(value);
        }
      };
      ipcRenderer.on('lpi:notification:clicked', clicked);
      return () => ipcRenderer.removeListener('lpi:notification:clicked', clicked);
    },
    getZoom: () => ipcRenderer.invoke('lpi:zoom:get'),
    setZoom: (value) => ipcRenderer.invoke('lpi:zoom:set', value),
    onZoomChanged: (listener) => {
      const changed = (_event: IpcRendererEvent, value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          listener(value);
        }
      };
      ipcRenderer.on('lpi:zoom:changed', changed);
      return () => ipcRenderer.removeListener('lpi:zoom:changed', changed);
    },
  };
  contextBridge.exposeInMainWorld('lpiDesktop', platform);
}
