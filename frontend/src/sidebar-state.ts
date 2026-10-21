import type { InventorySession, Project } from '../../src/shared/sessions.ts';

export type SidebarSession = InventorySession;

export function groupSessions(projects: Project[], sessions: SidebarSession[], online: boolean) {
  const groups = new Map(
    projects.map((project) => [project.id, { project, sessions: [] as SidebarSession[] }]),
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
      const latest = (items: SidebarSession[]) =>
        items[0] ? Date.parse(items[0].updatedAt ?? items[0].createdAt) : 0;
      return (
        latest(b.sessions) - latest(a.sessions) ||
        a.project.directory.localeCompare(b.project.directory)
      );
    });
}

export function activityCounts(sessions: SidebarSession[]) {
  return {
    running: sessions.filter((session) => session.activity === 'running').length,
    blocked: sessions.filter((session) => session.activity === 'blocked').length,
  };
}

export function projectColor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ['#c4b5fd', '#67e8f9', '#f9a8d4', '#fdba74', '#a5b4fc', '#bef264'][hash % 6] ?? '#c4b5fd';
}

export function relativeTime(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)}h`;
  }
  return `${Math.floor(minutes / 1440)}d`;
}
