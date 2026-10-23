import { QueryClient } from '@tanstack/react-query';
import { SessionCommands } from '../../../src/client/commands';
import { SessionDrafts } from '../../../src/client/drafts';
import { LaunchController } from '../../../src/client/launches';
import { SessionNotifications } from '../../../src/client/notifications';
import type { InventorySession } from '../../../src/shared/sessions';
import { launch, operate } from './api';
import { relayServer } from './connection';
import { LiveSession } from './live';
import { desktop } from './platform';
import { browserStorage } from './storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 10_000 },
    mutations: { retry: false },
  },
});

const notifications = new SessionNotifications();

export const live = new LiveSession(
  (refreshTrees, sessionId) => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    if (!sessionId) {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
    if (refreshTrees) {
      void queryClient.invalidateQueries({ queryKey: sessionId ? ['tree', sessionId] : ['tree'] });
    }
  },
  (event) => {
    if (!desktop) {
      return;
    }
    try {
      const notification = notifications.accept(event);
      if (!notification) {
        return;
      }
      const session = queryClient
        .getQueryData<InventorySession[]>(['sessions'])
        ?.find((session) => session.id === event.sessionId);
      if (!session || session.archived || session.generation > event.generation) {
        return;
      }
      void desktop
        .notify({
          sessionId: session.id,
          projectId: session.projectId,
          title: (session.title || 'lpi').replace(/\s+/g, ' ').slice(0, 160),
          ...notification,
        })
        .catch(() => {});
    } catch {
      // Best-effort notifications never interrupt session synchronization.
    }
  },
  notifications.reset,
);

const commandControllers = new Map<string, SessionCommands>();

/** Sidebar runtime actions and the open composer share one durable command lane. */
export function sessionCommands(id: string, projectId: string): SessionCommands {
  let commands = commandControllers.get(id);
  if (!commands) {
    commands = new SessionCommands(id, projectId, {
      server: relayServer ?? window.location.origin,
      connection: live.getState,
      runtime: () =>
        queryClient
          .getQueryData<InventorySession[]>(['sessions'])
          ?.find((session) => session.id === id),
      storage: browserStorage,
      dispatch: operate,
      refresh: () => {
        if (live.getState().snapshot?.session.id === id) {
          live.refresh();
        }
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      },
    });
    commandControllers.set(id, commands);
  }
  return commands;
}

export const drafts = new SessionDrafts({
  server: relayServer ?? window.location.origin,
  storage: browserStorage,
  persistImages: false,
});

export const launches = new LaunchController({
  server: relayServer ?? window.location.origin,
  storage: browserStorage,
  dispatch: launch,
  eligible: () => true,
  refresh: () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    live.refresh();
  },
});
