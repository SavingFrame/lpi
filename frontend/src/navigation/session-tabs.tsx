import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hasUnreadCompletion } from '../../../src/shared/session-read-state';
import { sessions } from '../client/api';
import { relayServer } from '../client/connection';
import { live } from '../client/controllers';
import { desktop } from '../client/platform';
import { statuses } from './session-status';
import {
  closeSessionTab,
  openSessionTab,
  parseSessionTabs,
  type SessionTab,
} from './session-tabs-state';

const storageKey = `lpi:desktop-tabs:v1:${relayServer ?? window.location.origin}`;

export function SessionTabs() {
  const navigate = useNavigate();
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
      if (sessionId) {
        close(sessionId);
      }
    }),
  );

  useEffect(() => {
    if (state.active === sessionId) {
      document
        .querySelector('.session-tab.active')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [sessionId, state.active]);

  return (
    <nav className="session-tabs" aria-label="Open sessions">
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
          // biome-ignore lint/a11y/noStaticElementInteractions: Middle-click supplements the keyboard-accessible close button.
          <div
            key={tab.sessionId}
            className={`session-tab ${sessionId === tab.sessionId ? 'active' : ''}`}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                close(tab.sessionId);
              }
            }}
          >
            <button
              type="button"
              className="session-tab-select"
              aria-current={sessionId === tab.sessionId ? 'page' : undefined}
              title={`${title}\n${description}`}
              aria-label={`${title}, ${label}${unread ? ', unviewed turn' : ''}`}
              onClick={() => activate(tab)}
            >
              {activity !== 'idle' && (
                <Icon
                  size={14}
                  className={`session-tab-status status-${activity} ${activity === 'running' ? 'working-icon' : ''}`}
                  aria-hidden="true"
                />
              )}
              <span className="session-tab-title">{title}</span>
              {unread && <span className="session-tab-unread status-unread" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="session-tab-close"
              aria-label={`Close ${title}`}
              title="Close tab (Ctrl+W / Cmd+W)"
              onClick={() => close(tab.sessionId)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {!state.tabs.length && (
        <span className="session-tabs-empty">Open a session from the sidebar</span>
      )}
    </nav>
  );
}
