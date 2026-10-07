import { QueryClient } from '@tanstack/react-query';
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
