import { groupSessions, indexSessions, searchSessions } from '../../../src/client/inventory.ts';
import type { InventorySession, Project } from '../../../src/shared/sessions.ts';
import type { MobileDevice } from './workspace.ts';

export const sessionKey = (origin: string, id: string) => JSON.stringify([origin, id]);

export function workspaceProjects(devices: MobileDevice[], archived: boolean, query: string) {
  const projects = new Map<string, Project>();
  const targets = new Map<string, { device: MobileDevice; project: Project }[]>();
  const owners = new Map<string, { device: MobileDevice; session: InventorySession }>();
  const indexed = devices.flatMap((device) => {
    const keys = new Map<string, string>();
    for (const project of device.inventory.projects) {
      const key = `name:${project.name}`;
      keys.set(project.id, key);
      if (!projects.has(key)) {
        projects.set(key, { ...project, id: key });
      }
      const options = targets.get(key) ?? [];
      options.push({ device, project });
      targets.set(key, options);
    }
    return indexSessions(device.inventory.sessions, device.inventory.projects).map(
      ({ session, text }) => {
        const id = sessionKey(device.origin, session.id);
        owners.set(id, { device, session });
        return {
          text: `${text} ${device.name.toLocaleLowerCase()}`,
          session: {
            ...session,
            id,
            projectId: keys.get(session.projectId) ?? sessionKey(device.origin, session.projectId),
            activity: device.status === 'online' ? session.activity : ('unknown' as const),
          },
        };
      },
    );
  });
  const matching = searchSessions(indexed, query, true)[archived ? 'archived' : 'all'];
  const groups = groupSessions([...projects.values()], matching, true, archived).filter(
    ({ project, sessions }) =>
      sessions.length > 0 ||
      (!archived &&
        (!query.trim() ||
          project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),
  );
  return { groups, targets, owners };
}
