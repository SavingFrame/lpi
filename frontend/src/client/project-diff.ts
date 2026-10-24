import type { EventSocket } from '../../../src/client/live';
import { ProjectDiffController } from '../../../src/client/project-diff';
import { projectDiffEventsPath } from '../../../src/shared/project-diff';
import { diff } from './api';
import { relayServer } from './connection';

interface DiffEntry {
  controller: ProjectDiffController;
  users: number;
  visibility: () => void;
}
const entries = new Map<string, DiffEntry>();

/** All mounted panes for a project share one transport and one cached snapshot. */
export function projectDiffEntry(projectId: string): DiffEntry {
  const existing = entries.get(projectId);
  if (existing) {
    return existing;
  }
  const controller = new ProjectDiffController({
    read: (signal) => diff(projectId, signal),
    openSocket: () => {
      const url = new URL(projectDiffEventsPath(projectId), relayServer ?? window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const native = new WebSocket(url);
      const socket: EventSocket = {
        get readyState() {
          return native.readyState;
        },
        onmessage: null,
        onerror: null,
        onclose: null,
        close: () => native.close(),
      };
      native.onmessage = (event) => socket.onmessage?.({ data: event.data });
      native.onerror = () => socket.onerror?.();
      native.onclose = () => socket.onclose?.();
      return socket;
    },
  });
  const entry = {
    controller,
    users: 0,
    visibility: () => {
      if (document.visibilityState === 'visible') {
        controller.start();
      } else {
        controller.stop();
      }
    },
  };
  entries.set(projectId, entry);
  return entry;
}

export function retainProjectDiff(projectId: string, entry: DiffEntry): () => void {
  entry.users++;
  if (entry.users === 1) {
    entries.set(projectId, entry);
    document.addEventListener('visibilitychange', entry.visibility);
    entry.visibility();
  }
  return () => {
    if (--entry.users === 0) {
      document.removeEventListener('visibilitychange', entry.visibility);
      entry.controller.stop();
      if (entries.get(projectId) === entry) {
        entries.delete(projectId);
      }
    }
  };
}
