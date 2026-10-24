import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state';
import { sessions } from '../client/api';
import { relayServer } from '../client/connection';
import { live } from '../client/controllers';
import { desktop } from '../client/platform';
import { WorkspaceTab } from '../components/workspace-tab';
import { useWorkspacePanes } from '../workspace/workspace-panes';
import { statuses } from './session-status';
import {
  closeSessionTab,
  openSessionTab,
  parseSessionTabs,
  type SessionTab,
} from './session-tabs-state';

const storageKey = `lpi:desktop-tabs:v1:${relayServer ?? window.location.origin}`;

export function SessionTabs({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { activePane, setActivePane } = useWorkspacePanes();
  const { projectId, sessionId } = useParams({ strict: false });
  const { branch } = useSearch({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const inventory = useQuery({ queryKey: ['sessions'], queryFn: sessions });
  const online = useSyncExternalStore(live.subscribe, () => {
    const status = live.getState().status;
    return status === 'ready' || status === 'syncing';
  });
  const [state, setState] = useState(() => {
    try {
      return parseSessionTabs(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    } catch {
      return parseSessionTabs(null);
    }
  });
  const initial = useRef(state);
  const restored = useRef(false);

  function activate(tab: SessionTab) {
    setActivePane('main');
    void navigate({
      to: '/app/projects/$projectId/sessions/$sessionId',
      params: tab,
      search: tab.branch ? { branch: tab.branch } : {},
    });
  }

  useLayoutEffect(() => {
    if (projectId && sessionId) {
      setState((current) => openSessionTab(current, { projectId, sessionId, branch }));
    }
  }, [projectId, sessionId, branch]);

  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;
    const tab = initial.current.tabs.find((tab) => tab.sessionId === initial.current.active);
    if (pathname === '/' && tab) {
      void navigate({
        to: '/app/projects/$projectId/sessions/$sessionId',
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
    if (sessionId === id) {
      const tab = next.tabs.find((tab) => tab.sessionId === next.active);
      if (tab) {
        activate(tab);
      } else {
        void navigate({ to: '/' });
      }
    }
  }

  useEffect(() =>
    desktop?.onCloseTab(() => {
      if (sessionId && activePane === 'main') {
        close(sessionId);
      }
    }),
  );

  return (
    <nav className="session-tabs" aria-label="Workspace tabs">
      {state.tabs.map((tab) => {
        const session = inventory.data?.find((session) => session.id === tab.sessionId);
        const title = session?.title || `Session ${tab.sessionId.slice(0, 8)}`;
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
            key={tab.sessionId}
            label={title}
            active={sessionId === tab.sessionId}
            title={`${title}\n${description}`}
            ariaLabel={`${title}, ${label}${unread ? ', unviewed turn' : ''}`}
            onSelect={() => activate(tab)}
            onClose={() => close(tab.sessionId)}
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
