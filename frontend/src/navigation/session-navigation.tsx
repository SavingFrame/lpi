import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { indexSessions, type SessionFilter, searchSessions } from '../../../src/client/inventory';
import type { InventorySession, Project } from '../../../src/shared/sessions';
import { projects, sessions } from '../client/api';
import { useKeyboardAction } from '../keyboard/keyboard';
import { SessionSidebar } from './session-sidebar';

const emptyProjects: Project[] = [];
const emptySessions: InventorySession[] = [];
const filters = ['all', 'archived'] as const;

/** Keep typing local and urgent; the memoized results use the deferred search value. */
export const SessionNavigation = memo(function SessionNavigation({
  selectedId,
  online,
}: {
  selectedId?: string;
  online: boolean;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const sessionQuery = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const projectList = projectQuery.data ?? emptyProjects;
  const sessionList = sessionQuery.data ?? emptySessions;
  const index = useMemo(() => indexSessions(sessionList, projectList), [sessionList, projectList]);
  const matches = useMemo(
    () => searchSessions(index, deferredSearch, online),
    [index, deferredSearch, online],
  );
  const ordered = [...matches[filter]].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  );
  function move(direction: number) {
    const index = ordered.findIndex((session) => session.id === selectedId);
    const next = ordered[index < 0 ? 0 : index + direction];
    if (next) {
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
        params: { projectId: next.projectId, sessionId: next.id },
      });
    }
  }
  useKeyboardAction('previous', () => move(-1), ordered.length > 0);
  useKeyboardAction('next', () => move(1), ordered.length > 0);
  return (
    <nav aria-label="Sessions by project">
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
      <h2 className="eyebrow">Projects</h2>
      {sessionQuery.error && <p className="error">{sessionQuery.error.message}</p>}
      {sessionQuery.isPending && <p className="muted">Loading sessions…</p>}
      <div aria-busy={deferredSearch !== search}>
        <SessionSidebar
          projects={projectList}
          sessions={sessionList}
          filtered={matches[filter]}
          selectedId={selectedId}
          filter={filter}
          search={deferredSearch}
          online={online}
        />
      </div>
    </nav>
  );
});
