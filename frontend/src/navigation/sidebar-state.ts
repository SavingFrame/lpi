import type { groupSessions } from '../../../src/client/inventory.ts';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state.ts';

export function visibleProjects(
  groups: ReturnType<typeof groupSessions>,
  selectedId: string | undefined,
  pinned: ReadonlySet<string>,
  all: boolean,
  recentLimit = 10,
) {
  return all
    ? groups
    : groups.filter(
        (group, index) =>
          index < recentLimit ||
          pinned.has(group.project.id) ||
          group.sessions.some(
            (session) =>
              session.id === selectedId ||
              session.connection === 'connected' ||
              hasUnreadCompletion(session.readState),
          ),
      );
}

export function projectColor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ['#c4b5fd', '#67e8f9', '#f9a8d4', '#fdba74', '#a5b4fc', '#bef264'][hash % 6] ?? '#c4b5fd';
}
