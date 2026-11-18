import type { RelayApi } from '../../../src/client/api.ts';
import type { EventSocket } from '../../../src/client/live.ts';
import { ProjectDiffController } from '../../../src/client/project-diff.ts';
import { projectDiffEventsPath } from '../../../src/shared/project-diff.ts';

interface DiffEntry {
  controller: ProjectDiffController;
  users: number;
  visibility: () => void;
}

export function createProjectDiffRegistry(
  diff: RelayApi['diff'],
  openSocket: (path: string) => EventSocket,
) {
  const entries = new Map<string, DiffEntry>();

  /** All mounted panes for a project share one transport and one cached snapshot. */
  function projectDiffEntry(projectId: string): DiffEntry {
    const existing = entries.get(projectId);
    if (existing) {
      return existing;
    }
    const controller = new ProjectDiffController({
      read: (signal) => diff(projectId, signal),
      openSocket: () => openSocket(projectDiffEventsPath(projectId)),
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

  function retainProjectDiff(projectId: string, entry: DiffEntry): () => void {
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

  return { projectDiffEntry, retainProjectDiff };
}
