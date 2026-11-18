import { QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import { defaultRelay, type WorkspaceRelay } from './controllers';

const RelayContext = createContext(defaultRelay);

export function RelayProvider({ relay, children }: { relay: WorkspaceRelay; children: ReactNode }) {
  return (
    <RelayContext.Provider value={relay}>
      <QueryClientProvider client={relay.client.queryClient}>{children}</QueryClientProvider>
    </RelayContext.Provider>
  );
}

export const useRelay = () => useContext(RelayContext);

export function useRelayReady(relay: WorkspaceRelay) {
  return useSyncExternalStore(relay.client.subscribeAvailability, relay.client.canMutate);
}
