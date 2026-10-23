import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Folder, Settings, Terminal } from 'lucide-react';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';
import { filterSessions, type SessionFilter } from '../../src/client/inventory';
import { projects, sessions } from './api';
import { live } from './client';
import { desktop } from './platform';
import { SessionSidebar } from './session-sidebar';

export function Shell() {
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [search, setSearch] = useState('');
  const [width, setWidth] = useState(360);
  const { projectId, sessionId } = useParams({ strict: false });
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const sessionQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: sessions,
  });
  const status = useSyncExternalStore(live.subscribe, () => live.getState().status);
  const online = status === 'ready' || status === 'syncing';
  const filters = ['all', 'live', 'saved', 'archived'] as const;
  useEffect(() => {
    live.connect();
    return live.disconnect;
  }, []);
  return (
    <div className="shell" style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <aside className="sidebar">
        <div className="brand">
          <Link to="/">
            <span className="brand-mark">
              <Terminal size={17} aria-hidden="true" />
            </span>
            pim<span>native Pi relay</span>
          </Link>
        </div>
        <p className={`connection ${status}`} role="status">
          {status}
        </p>
        <p className="local-warning">Local access. No authentication.</p>
        {projectQuery.error && <p className="error">{projectQuery.error.message}</p>}
        {sessionQuery.error && <p className="error">{sessionQuery.error.message}</p>}
        {projectQuery.isPending && <p className="muted">Loading projects…</p>}
        {projectQuery.data?.length === 0 && (
          <p className="muted">
            No project folders found. Add a folder under a configured root, then restart the server.
          </p>
        )}
        <nav aria-label="Sessions by project">
          <label className="session-search">
            <span className="sr-only">Search sessions</span>
            <input
              type="search"
              placeholder="Search sessions or projects…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
                {item === 'all'
                  ? 'All'
                  : item === 'live'
                    ? 'Live'
                    : item === 'saved'
                      ? 'Saved'
                      : 'Archived'}
                <span>
                  {
                    filterSessions(
                      sessionQuery.data ?? [],
                      projectQuery.data ?? [],
                      item,
                      search,
                      online,
                    ).length
                  }
                </span>
              </button>
            ))}
          </fieldset>
          <h2 className="eyebrow">Projects</h2>
          {sessionQuery.isPending && <p className="muted">Loading sessions…</p>}
          <SessionSidebar
            projects={projectQuery.data ?? []}
            sessions={sessionQuery.data ?? []}
            selectedId={sessionId}
            filter={filter}
            search={search}
            online={online}
          />
        </nav>
        {desktop && (
          <Link
            to="/app/settings"
            className="settings-link"
            activeProps={{ className: 'selected' }}
          >
            <Settings size={15} aria-hidden="true" />
            Settings
          </Link>
        )}
        <footer>
          <Folder size={13} aria-hidden="true" />
          {projectQuery.data?.find((project) => project.id === projectId)?.name ??
            'Select a project'}
        </footer>
      </aside>
      <button
        type="button"
        className="sidebar-resize"
        aria-label="Resize sidebar"
        title="Drag to resize. Left and Right arrows adjust width; Home resets."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
            setWidth(Math.max(320, Math.min(520, event.clientX - left)));
          }
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth((current) =>
              Math.max(320, Math.min(520, current + (event.key === 'ArrowRight' ? 10 : -10))),
            );
          } else if (event.key === 'Home') {
            event.preventDefault();
            setWidth(360);
          }
        }}
      />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function Welcome() {
  useEffect(() => live.select(null), []);
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <Terminal size={24} aria-hidden="true" />
      </div>
      <p className="eyebrow">PIM / WORKSPACE</p>
      <h1>
        Your sessions,
        <br />
        on your PC.
      </h1>
      <p>Create a session, resume saved history, or connect a running native Pi instance.</p>
      <p className="muted">Pi runs the agent. Pim relays history, events, and commands.</p>
    </div>
  );
}
