import { QueryClient } from '@tanstack/react-query';
import { SessionCommands } from '../../src/client/commands';
import { SessionDrafts } from '../../src/client/drafts';
import { LaunchController } from '../../src/client/launches';
import type { InventorySession } from '../../src/shared/sessions';
import { launch, operate } from './api';
import { LiveSession } from './live';
import { browserStorage } from './storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 10_000 },
    mutations: { retry: false },
  },
});

export const live = new LiveSession((refreshTrees, sessionId) => {
  void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  if (!sessionId) {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }
  if (refreshTrees) {
    void queryClient.invalidateQueries({ queryKey: sessionId ? ['tree', sessionId] : ['tree'] });
  }
});

const commandControllers = new Map<string, SessionCommands>();

/** Sidebar runtime actions and the open composer share one durable command lane. */
export function sessionCommands(id: string, projectId: string): SessionCommands {
  let commands = commandControllers.get(id);
  if (!commands) {
    commands = new SessionCommands(id, projectId, {
      server: window.location.origin,
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
  server: window.location.origin,
  storage: browserStorage,
  persistImages: false,
});

export const launches = new LaunchController({
  server: window.location.origin,
  storage: browserStorage,
  dispatch: launch,
  eligible: () => true,
  refresh: () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    live.refresh();
  },
});
