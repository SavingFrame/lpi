import { useEffect, useSyncExternalStore } from 'react';
import { useRelay, useRelayReady } from '../client/relay-context';

export function useSessionCommands(id: string, projectId: string) {
  const relay = useRelay();
  const ready = useRelayReady(relay);
  const commands = relay.client.sessionCommands(id, projectId);
  const state = useSyncExternalStore(commands.subscribe, commands.getState);
  useEffect(() => {
    void commands.initialize();
  }, [commands]);
  return {
    ...state,
    active: ready && commands.available(),
    available: commands.available,
    submit: commands.submit,
    review: commands.review,
    stopRuntime: commands.stopRuntime,
    canStop: commands.canStop,
  };
}
