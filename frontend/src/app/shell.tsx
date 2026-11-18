import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { Folder, Settings } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { relayFor } from '../client/controllers';
import { desktop } from '../client/platform';
import { RelayProvider, useRelay } from '../client/relay-context';
import { useWorkspaceInventory, WorkspaceConnections } from '../client/workspace-inventory';
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
import { sessionRoute } from './routes';

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
  const relay = useRelay();
  const [width, setWidth] = useState(280);
  const { tabs: diffTabs, rightTab } = useDiffTabs();
  const { activePane } = useWorkspacePanes();
  const navigate = useNavigate();
  useEffect(
    () =>
      desktop?.onNotificationClicked(({ profileId, projectId, sessionId }) => {
        if (!relayFor(profileId)) {
          return;
        }
        void navigate({
          to: sessionRoute,
          params: { profileId, projectId, sessionId },
        });
      }),
    [navigate],
  );
  const { projectId, sessionId } = useParams({ strict: false });
  const inventory = useWorkspaceInventory();
  const currentProjects = inventory.find((entry) => entry.relay === relay)?.projects;
  const panelRelay = (activePane === 'right' && rightTab && relayFor(rightTab.profileId)) || relay;
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
        <WorkspaceConnections />
        <p className="local-warning">Local access. No authentication.</p>
        <SessionNavigation selectedId={sessionId} selectedProfileId={relay.profileId} />
        <ProviderUsagePanel key={relay.profileId} />
        <Link to="/app/settings" className="settings-link" activeProps={{ className: 'selected' }}>
          <Settings size={15} aria-hidden="true" />
          Settings
        </Link>
        <footer>
          <Folder size={13} aria-hidden="true" />
          {currentProjects?.find((project) => project.id === projectId)?.name ?? 'Select a project'}
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
        <Workspace
          panelRelay={panelRelay}
          projectId={activePane === 'right' && rightTab ? rightTab.projectId : projectId}
        >
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
                      <RelayProvider relay={relayFor(rightTab.profileId) ?? relay}>
                        <DiffView
                          key={JSON.stringify([
                            rightTab.profileId,
                            rightTab.projectId,
                            rightTab.file,
                          ])}
                          projectId={rightTab.projectId}
                          file={rightTab.file}
                          pane="right"
                        />
                      </RelayProvider>
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
