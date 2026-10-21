import { useState, useSyncExternalStore } from 'react';
import { operate } from '../api';
import { live, queryClient } from '../client';
import { SessionCommands } from './commands';

export function useSessionCommands(id: string, projectId: string) {
  const [commands] = useState(
    () =>
      new SessionCommands(id, projectId, {
        connection: live.getState,
        storage: sessionStorage,
        dispatch: operate,
        refresh: () => {
          live.refresh();
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
      }),
  );
  const state = useSyncExternalStore(commands.subscribe, commands.getState);
  return {
    ...state,
    active: commands.available(),
    available: commands.available,
    submit: commands.submit,
    review: commands.review,
  };
}
