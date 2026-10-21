import { QueryClient } from '@tanstack/react-query';
import { SessionDrafts } from '../../src/client/drafts';
import { LaunchController } from '../../src/client/launches';
import { launch } from './api';
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
