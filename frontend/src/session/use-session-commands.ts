import { useEffect, useState, useSyncExternalStore } from 'react';
import { SessionCommands } from '../../../src/client/commands';
import { operate } from '../api';
import { live, queryClient } from '../client';
import { browserStorage } from '../storage';

export function useSessionCommands(id: string, projectId: string) {
  const [commands] = useState(
    () =>
      new SessionCommands(id, projectId, {
        server: window.location.origin,
        connection: live.getState,
        storage: browserStorage,
        dispatch: operate,
        refresh: () => {
          live.refresh();
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
      }),
  );
  const state = useSyncExternalStore(commands.subscribe, commands.getState);
  useEffect(() => {
    void commands.initialize();
  }, [commands]);
  return {
    ...state,
    active: commands.available(),
    available: commands.available,
    submit: commands.submit,
    review: commands.review,
  };
}
