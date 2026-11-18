import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state';
import { sessionRoute } from '../app/routes';
import { defaultRelay, relayFor, workspaceRelays } from '../client/controllers';
import { desktop } from '../client/platform';
import { useWorkspaceInventory } from '../client/workspace-inventory';
import { WorkspaceTab } from '../components/workspace-tab';
import { useWorkspacePanes } from '../workspace/workspace-panes';
import { statuses } from './session-status';
import {
  closeSessionTab,
  openSessionTab,
  parseSessionTabs,
  type SessionTab,
  sessionTabKey,
} from './session-tabs-state';

const storageKey = defaultRelay.profileId
  ? 'lpi:desktop-tabs:v2'
  : `lpi:desktop-tabs:v1:${defaultRelay.client.origin}`;

export function SessionTabs({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { activePane, setActivePane } = useWorkspacePanes();
  const { profileId, projectId, sessionId } = useParams({ strict: false });
  const { branch } = useSearch({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const inventory = useWorkspaceInventory();
  const currentKey = sessionId && sessionTabKey({ profileId, sessionId });
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved && defaultRelay.profileId) {
        let state = parseSessionTabs(null);
        for (const relay of workspaceRelays) {
          const legacy = parseSessionTabs(
            JSON.parse(
              localStorage.getItem(`lpi:desktop-tabs:v1:${relay.client.origin}`) ?? 'null',
            ),
          );
          for (const tab of legacy.tabs) {
            state = openSessionTab(state, { ...tab, profileId: relay.profileId });
          }
        }
        return state;
      }
      const parsed = parseSessionTabs(JSON.parse(saved ?? 'null'));
      return { ...parsed, tabs: parsed.tabs.filter((tab) => relayFor(tab.profileId)) };
    } catch {
      return parseSessionTabs(null);
    }
  });
  const initial = useRef(state);
  const restored = useRef(false);

  function activate(tab: SessionTab) {
    setActivePane('main');
    void navigate({
      to: sessionRoute,
      params: tab,
      search: tab.branch ? { branch: tab.branch } : {},
    });
  }

  useLayoutEffect(() => {
    if (projectId && sessionId) {
      setState((current) => openSessionTab(current, { profileId, projectId, sessionId, branch }));
    }
  }, [profileId, projectId, sessionId, branch]);

  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;
    const tab = initial.current.tabs.find((tab) => sessionTabKey(tab) === initial.current.active);
    if (pathname === '/' && tab) {
      void navigate({
        to: sessionRoute,
        params: tab,
        search: tab.branch ? { branch: tab.branch } : {},
        replace: true,
      });
    }
  }, [navigate, pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Tabs remain usable when device storage is unavailable.
    }
  }, [state]);

  function close(id: string) {
    const next = closeSessionTab(state, id);
    setState(next);
    if (currentKey === id) {
      const tab = next.tabs.find((tab) => sessionTabKey(tab) === next.active);
      if (tab) {
        activate(tab);
      } else {
        void navigate({ to: '/' });
      }
    }
  }

  useEffect(() =>
    desktop?.onCloseTab(() => {
      if (currentKey && activePane === 'main') {
        close(currentKey);
      }
    }),
  );

  return (
    <nav className="session-tabs" aria-label="Workspace tabs">
      {state.tabs.map((tab) => {
        const owner = inventory.find(({ relay }) => relay.profileId === tab.profileId);
        const session = owner?.sessions?.find((session) => session.id === tab.sessionId);
        const online = owner?.online;
        const name = session?.title || `Session ${tab.sessionId.slice(0, 8)}`;
        const title = owner?.relay.name ? `${name} · ${owner.relay.name}` : name;
        const activity =
          online && session?.connection === 'connected' ? session.activity : 'unknown';
        const status = statuses[activity];
        const Icon = status.icon;
        const unread = session ? hasUnreadCompletion(session.readState) : false;
        const label = !session
          ? 'Session status unavailable'
          : !online || session.connection === 'disconnected'
            ? 'Disconnected'
            : activity === 'unknown'
              ? 'Status unavailable'
              : status.label;
        const description = `${label}. ${status.description}${unread ? ' Unviewed turn. This does not imply task success.' : ''}`;
        return (
          <WorkspaceTab
            key={sessionTabKey(tab)}
            label={title}
            active={currentKey === sessionTabKey(tab)}
            title={`${title}\n${description}`}
            ariaLabel={`${title}, ${label}${unread ? ', unviewed turn' : ''}`}
            onSelect={() => activate(tab)}
            onClose={() => close(sessionTabKey(tab))}
            icon={
              activity !== 'idle' && (
                <Icon
                  size={14}
                  className={`session-tab-status status-${activity} ${activity === 'running' ? 'working-icon' : ''}`}
                  aria-hidden="true"
                />
              )
            }
            indicator={
              unread && <span className="session-tab-unread status-unread" aria-hidden="true" />
            }
          />
        );
      })}
      {children}
      {!state.tabs.length && !children && (
        <span className="session-tabs-empty">Open a session from the sidebar</span>
      )}
    </nav>
  );
}
