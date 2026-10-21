import { hasUnreadCompletion } from '../shared/session-read-state.ts';
import type { InventorySession, Project } from '../shared/sessions.ts';

export function groupSessions(projects: Project[], sessions: InventorySession[], online: boolean) {
  const groups = new Map(
    projects.map((project) => [project.id, { project, sessions: [] as InventorySession[] }]),
  );
  for (const session of sessions) {
    const group = groups.get(session.projectId);
    if (group) {
      group.sessions.push({
        ...session,
        activity: online && session.connection === 'connected' ? session.activity : 'unknown',
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort(
        (a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt),
      ),
    }))
    .sort((a, b) => {
      const latest = (items: InventorySession[]) =>
        items[0] ? Date.parse(items[0].updatedAt ?? items[0].createdAt) : 0;
      return (
        latest(b.sessions) - latest(a.sessions) ||
        a.project.directory.localeCompare(b.project.directory)
      );
    });
}

export function activityCounts(sessions: InventorySession[]) {
  return {
    running: sessions.filter((session) => session.activity === 'running').length,
    blocked: sessions.filter((session) => session.activity === 'blocked').length,
  };
}

/** Keep active, unread, and selected sessions visible even outside the recent window. */
export function visibleSessions(
  sessions: InventorySession[],
  selectedId: string | undefined,
  expanded: boolean,
  recentLimit = 5,
): InventorySession[] {
  return expanded
    ? sessions
    : sessions.filter(
        (session, index) =>
          index < recentLimit ||
          session.id === selectedId ||
          session.activity === 'running' ||
          session.activity === 'blocked' ||
          hasUnreadCompletion(session.readState),
      );
}
