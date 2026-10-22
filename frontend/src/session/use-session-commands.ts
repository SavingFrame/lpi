import { useEffect, useState, useSyncExternalStore } from 'react';
import { sessionCommands } from '../client';

export function useSessionCommands(id: string, projectId: string) {
  const [commands] = useState(() => sessionCommands(id, projectId));
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
    stopRuntime: commands.stopRuntime,
    canStop: commands.canStop,
  };
}
