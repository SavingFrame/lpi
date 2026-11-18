import { useNavigate } from '@tanstack/react-router';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { indexSessions, type SessionFilter, searchSessions } from '../../../src/client/inventory';
import type { InventorySession, Project } from '../../../src/shared/sessions';
import { sessionRoute } from '../app/routes';
import { useWorkspaceInventory, workspaceKey } from '../client/workspace-inventory';
import { useKeyboardAction } from '../keyboard/keyboard';
import { SessionSidebar } from './session-sidebar';
import type { LaunchTarget } from './workspace-projects';

const filters = ['all', 'archived'] as const;

/** Keep typing local and urgent; the memoized results use the deferred search value. */
export const SessionNavigation = memo(function SessionNavigation({
  selectedId,
  selectedProfileId,
}: {
  selectedId?: string;
  selectedProfileId?: string;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const inventory = useWorkspaceInventory();
  const data = useMemo(() => {
    const projects = new Map<string, Project>();
    const targets = new Map<string, LaunchTarget[]>();
    const rows = new Map<
      string,
      { relay: (typeof inventory)[number]['relay']; session: InventorySession; online: boolean }
    >();
    const indexed = inventory.flatMap(({ relay, projects: list, sessions, online }) => {
      const groupId = (project: Project) =>
        inventory.length > 1 ? `name:${project.name}` : project.id;
      const groups = new Map((list ?? []).map((project) => [project.id, groupId(project)]));
      for (const project of list ?? []) {
        const id = groupId(project);
        if (!projects.has(id)) {
          projects.set(id, { ...project, id });
        }
        const choices = targets.get(id) ?? [];
        choices.push({ relay, project, online });
        targets.set(id, choices);
      }
      return indexSessions(sessions ?? [], list ?? []).map(({ session, text }) => {
        const id = workspaceKey(relay.profileId, session.id);
        rows.set(id, { relay, session, online });
        return {
          text: `${text} ${relay.name.toLocaleLowerCase()}`,
          session: {
            ...session,
            id,
            projectId:
              groups.get(session.projectId) ?? workspaceKey(relay.profileId, session.projectId),
            file: workspaceKey(relay.profileId, session.file),
            parentSession:
              session.parentSession && workspaceKey(relay.profileId, session.parentSession),
            activity: online ? session.activity : ('unknown' as const),
          },
        };
      });
    });
    return {
      projects: [...projects.values()],
      targets,
      rows,
      indexed,
      sessions: indexed.map(({ session }) => session),
    };
  }, [inventory]);
  const matches = useMemo(
    () => searchSessions(data.indexed, deferredSearch, true),
    [data, deferredSearch],
  );
  const selectedKey = selectedId && workspaceKey(selectedProfileId, selectedId);
  const ordered = [...matches[filter]].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  );
  function move(direction: number) {
    const index = ordered.findIndex((session) => session.id === selectedKey);
    const next = ordered[index < 0 ? 0 : index + direction];
    const row = next && data.rows.get(next.id);
    if (row) {
      void navigate({
        to: sessionRoute,
        params: {
          profileId: row.relay.profileId,
          projectId: row.session.projectId,
          sessionId: row.session.id,
        },
      });
    }
  }
  useKeyboardAction('previous', () => move(-1), ordered.length > 0);
  useKeyboardAction('next', () => move(1), ordered.length > 0);
  return (
    <nav aria-label="Sessions">
      <label className="session-search">
        <span className="sr-only">Search sessions</span>
        <input
          type="search"
          placeholder="Search sessions or projects…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.repeat ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.shiftKey ||
              search !== deferredSearch
            ) {
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'Enter') {
              return;
            }
            const first = event.currentTarget
              .closest('nav')
              ?.querySelector<HTMLAnchorElement>('.session-link');
            if (!first) {
              return;
            }
            event.preventDefault();
            if (event.key === 'Enter') {
              first.click();
            } else {
              first.focus();
            }
          }}
        />
      </label>
      <fieldset className="session-visibility" aria-label="Session visibility">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item === 'all' ? 'All' : 'Archived'}
            <span>{matches[item].length}</span>
          </button>
        ))}
      </fieldset>
      <div aria-busy={deferredSearch !== search}>
        <SessionSidebar
          projects={data.projects}
          sessions={data.sessions}
          targets={data.targets}
          rows={data.rows}
          filtered={matches[filter]}
          selectedId={selectedKey}
          filter={filter}
          search={deferredSearch}
        />
      </div>
    </nav>
  );
});
