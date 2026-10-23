import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Folder, Settings } from 'lucide-react';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';
import { projects } from '../client/api';
import { live } from '../client/controllers';
import { desktop } from '../client/platform';
import { KeyboardProvider } from '../keyboard/keyboard';
import { KeyboardNavigation } from '../keyboard/navigation';
import { SessionNavigation } from '../navigation/session-navigation';

function ConnectionStatus() {
  const status = useSyncExternalStore(live.subscribe, () => live.getState().status);
  const online = status === 'ready' || status === 'syncing';
  return (
    <p className={`connection ${online ? 'ready' : status}`} role="status">
      {online ? 'connected' : status}
    </p>
  );
}

export function Shell() {
  return (
    <KeyboardProvider>
      <ShellContent />
    </KeyboardProvider>
  );
}

function ShellContent() {
  const [width, setWidth] = useState(360);
  const navigate = useNavigate();
  useEffect(
    () =>
      desktop?.onNotificationClicked(({ projectId, sessionId }) => {
        void navigate({
          to: '/app/projects/$projectId/sessions/$sessionId',
          params: { projectId, sessionId },
        });
      }),
    [navigate],
  );
  const { projectId, sessionId } = useParams({ strict: false });
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: projects });
  const online = useSyncExternalStore(live.subscribe, () => {
    const status = live.getState().status;
    return status === 'ready' || status === 'syncing';
  });
  useEffect(() => {
    live.connect();
    return live.disconnect;
  }, []);
  return (
    <div className="shell" style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
      <KeyboardNavigation />
      <aside className="sidebar" aria-label="Session sidebar">
        <div className="brand">
          <Link to="/">
            <img className="brand-mark" src="/assets/lpi-icon.svg" width={32} height={32} alt="" />
            lpi<span>native Pi relay</span>
          </Link>
        </div>
        <ConnectionStatus />
        <p className="local-warning">Local access. No authentication.</p>
        {projectQuery.error && <p className="error">{projectQuery.error.message}</p>}
        {projectQuery.isPending && <p className="muted">Loading projects…</p>}
        {projectQuery.data?.length === 0 && (
          <p className="muted">
            No project folders found. Add a folder under a configured root, then restart the server.
          </p>
        )}
        <SessionNavigation selectedId={sessionId} online={online} />
        <Link to="/app/settings" className="settings-link" activeProps={{ className: 'selected' }}>
          <Settings size={15} aria-hidden="true" />
          Settings
        </Link>
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
      <main tabIndex={-1} aria-label="Conversation">
        <Outlet />
      </main>
    </div>
  );
}
