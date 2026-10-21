import { QueryClient } from '@tanstack/react-query';
import { launch } from './api';
import { LaunchController } from './launches';
import { LiveSession } from './live';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 10_000 },
    mutations: { retry: false },
  },
});

export const live = new LiveSession(() => {
  void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  void queryClient.invalidateQueries({ queryKey: ['projects'] });
});

export const launches = new LaunchController({
  storage: () => sessionStorage,
  dispatch: launch,
  refresh: () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    live.refresh();
  },
});
