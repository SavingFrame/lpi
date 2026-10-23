import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { DesktopPlatform } from '../src/shared/desktop.ts';

// Expose only UI scale controls. Never expose IPC objects, events, or arbitrary channels.
if (window.top === window) {
  const platform: DesktopPlatform = {
    getZoom: () => ipcRenderer.invoke('pim:zoom:get'),
    setZoom: (value) => ipcRenderer.invoke('pim:zoom:set', value),
    onZoomChanged: (listener) => {
      const changed = (_event: IpcRendererEvent, value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          listener(value);
        }
      };
      ipcRenderer.on('pim:zoom:changed', changed);
      return () => ipcRenderer.removeListener('pim:zoom:changed', changed);
    },
  };
  contextBridge.exposeInMainWorld('pimDesktop', platform);
}
