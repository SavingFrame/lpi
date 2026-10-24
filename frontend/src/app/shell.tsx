import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Folder, Settings } from 'lucide-react';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';
import { projects } from '../client/api';
import { live } from '../client/controllers';
import { desktop } from '../client/platform';
import { SplitWorkspace } from '../components/split-workspace';
import { KeyboardProvider } from '../keyboard/keyboard';
import { KeyboardNavigation } from '../keyboard/navigation';
import { ProviderUsagePanel } from '../navigation/provider-usage';
import { SessionNavigation } from '../navigation/session-navigation';
import { SessionTabs } from '../navigation/session-tabs';
import { DiffView } from '../workspace/diff-page';
import { DiffTabs, DiffTabsProvider, useDiffTabs } from '../workspace/diff-tabs';
import { Workspace } from '../workspace/workspace';
import {
  useWorkspacePanes,
  WorkspaceGroup,
  WorkspacePanesProvider,
} from '../workspace/workspace-panes';

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
      <WorkspacePanesProvider>
        <DiffTabsProvider>
          <ShellContent />
        </DiffTabsProvider>
      </WorkspacePanesProvider>
    </KeyboardProvider>
  );
}

function ShellContent() {
  const [width, setWidth] = useState(280);
  const { tabs: diffTabs, rightTab } = useDiffTabs();
  const { activePane } = useWorkspacePanes();
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
        <ProviderUsagePanel />
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
            setWidth(Math.max(240, Math.min(520, event.clientX - left)));
          }
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth((current) =>
              Math.max(240, Math.min(520, current + (event.key === 'ArrowRight' ? 10 : -10))),
            );
          } else if (event.key === 'Home') {
            event.preventDefault();
            setWidth(280);
          }
        }}
      />
      <div className="desktop-workspace">
        <Workspace projectId={activePane === 'right' && rightTab ? rightTab.projectId : projectId}>
          {(controls) => (
            <SplitWorkspace
              primary={
                <WorkspaceGroup
                  pane="main"
                  tabs={
                    <div className="workspace-tabbar">
                      <SessionTabs>
                        {diffTabs.some((tab) => tab.pane === 'main') ? <DiffTabs /> : null}
                      </SessionTabs>
                      {controls}
                    </div>
                  }
                >
                  <main tabIndex={-1} aria-label="Workspace content" data-workspace-scroll>
                    <Outlet />
                  </main>
                </WorkspaceGroup>
              }
              secondary={
                rightTab && (
                  <WorkspaceGroup
                    pane="right"
                    tabs={
                      <nav className="session-tabs" aria-label="Right workspace tabs">
                        <DiffTabs pane="right" />
                      </nav>
                    }
                  >
                    <section
                      className="workspace-group-content"
                      tabIndex={-1}
                      aria-label="Right workspace content"
                      data-workspace-scroll
                    >
                      <DiffView
                        key={JSON.stringify([rightTab.projectId, rightTab.file])}
                        projectId={rightTab.projectId}
                        file={rightTab.file}
                        pane="right"
                      />
                    </section>
                  </WorkspaceGroup>
                )
              }
            />
          )}
        </Workspace>
      </div>
    </div>
  );
}
