import { hasUnreadCompletion } from '../shared/session-read-state.ts';
import type { InventorySession, Project } from '../shared/sessions.ts';

export type SessionFilter = 'all' | 'live' | 'saved' | 'archived';

export function filterSessions(
  sessions: InventorySession[],
  projects: Project[],
  filter: SessionFilter,
  query: string,
  online: boolean,
): InventorySession[] {
  return searchSessions(indexSessions(sessions, projects), query, online)[filter];
}

/** Build once per inventory update, not once per keystroke and filter count. */
export function indexSessions(sessions: InventorySession[], projects: Project[]) {
  const byProject = new Map(projects.map((project) => [project.id, project]));
  return sessions.map((session) => {
    const project = byProject.get(session.projectId);
    return {
      session,
      text: [session.title, session.id, session.directory, project?.name, project?.directory]
        .join(' ')
        .toLocaleLowerCase(),
    };
  });
}

export function searchSessions(
  index: ReturnType<typeof indexSessions>,
  query: string,
  online: boolean,
): Record<SessionFilter, InventorySession[]> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result: Record<SessionFilter, InventorySession[]> = {
    all: [],
    live: [],
    saved: [],
    archived: [],
  };
  for (const { session, text } of index) {
    if (!terms.every((term) => text.includes(term))) {
      continue;
    }
    if (session.archived) {
      result.archived.push(session);
    } else {
      result.all.push(session);
      if (session.connection === 'disconnected') {
        result.saved.push(session);
      } else if (online) {
        result.live.push(session);
      }
    }
  }
  return result;
}

export function groupSessions(
  projects: Project[],
  sessions: InventorySession[],
  online: boolean,
  archived = false,
) {
  const groups = new Map(
    projects.map((project) => [
      project.id,
      { project, configured: true, sessions: [] as InventorySession[] },
    ]),
  );
  for (const session of sessions) {
    if (session.archived !== archived) {
      continue;
    }
    let group = groups.get(session.projectId);
    if (!group) {
      group = {
        project: { id: session.projectId, name: session.directory, directory: session.directory },
        configured: false,
        sessions: [],
      };
      groups.set(session.projectId, group);
    }
    const activity = online && session.connection === 'connected' ? session.activity : 'unknown';
    group.sessions.push(activity === session.activity ? session : { ...session, activity });
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
