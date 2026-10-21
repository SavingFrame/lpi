import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Folder, Terminal } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { projects, sessions } from './api';
import { live } from './client';
import { LaunchSession } from './launch-session';
import { SessionSidebar } from './session-sidebar';

export function Shell() {
  const { projectId, sessionId } = useParams({ strict: false });
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const sessionQuery = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const connection = useSyncExternalStore(live.subscribe, live.getState);
  useEffect(() => {
    live.connect();
    return live.disconnect;
  }, []);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Link to="/">
            <span className="brand-mark">
              <Terminal size={17} aria-hidden="true" />
            </span>
            pim<span>native Pi relay</span>
          </Link>
        </div>
        <p className={`connection ${connection.status}`} role="status">
          {connection.status}
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
        <LaunchSession />
        <nav aria-label="Sessions by project">
          <h2 className="eyebrow">Projects</h2>
          {sessionQuery.isPending && <p className="muted">Loading sessions…</p>}
          <SessionSidebar
            projects={projectQuery.data ?? []}
            sessions={sessionQuery.data ?? []}
            selectedId={sessionId}
            online={connection.status === 'ready' || connection.status === 'syncing'}
          />
        </nav>
        <footer className="flex items-center gap-2">
          <Folder size={13} aria-hidden="true" />
          {projectQuery.data?.find((project) => project.id === projectId)?.name ??
            'Select a project'}
        </footer>
      </aside>
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
