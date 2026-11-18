import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { InventorySession, Project } from '../../../src/shared/sessions';
import { type WorkspaceRelay, workspaceRelays } from './controllers';
import { useRelayReady } from './relay-context';

export function WorkspaceConnections() {
  useEffect(() => {
    for (const { client } of workspaceRelays) {
      client.live.connect();
    }
    return () => {
      for (const { client } of workspaceRelays) {
        client.live.disconnect();
      }
    };
  }, []);
  return workspaceRelays.map((relay) => (
    <RelayInventory key={relay.profileId ?? 'browser'} relay={relay} />
  ));
}

function RelayInventory({ relay }: { relay: WorkspaceRelay }) {
  const { client, name } = relay;
  const status = useSyncExternalStore(client.live.subscribe, () => client.live.getState().status);
  const ready = useRelayReady(relay);
  const enabled = !relay.profileId || ready;
  const projects = useQuery(
    { queryKey: ['projects'], queryFn: client.projects, enabled },
    client.queryClient,
  );
  const sessions = useQuery(
    { queryKey: ['sessions'], queryFn: client.sessions, enabled },
    client.queryClient,
  );
  const label =
    status === 'offline'
      ? 'Offline'
      : status === 'connecting' || !ready
        ? 'Connecting'
        : 'Connected';
  const stale = label !== 'Connected' && Boolean(projects.data || sessions.data);
  return (
    <div>
      <p className={`connection ${label === 'Connected' ? 'ready' : status}`} role="status">
        {name && `${name}: `}
        {label.toLowerCase()}
        {stale ? ' · stale inventory' : ''}
      </p>
      {(projects.error || sessions.error) && (
        <p className="error">{(projects.error ?? sessions.error)?.message}</p>
      )}
      {projects.data?.length === 0 && label === 'Connected' && (
        <p className="muted">No project folders found.</p>
      )}
    </div>
  );
}

export const workspaceKey = (profileId: string | undefined, id: string) =>
  profileId ? `${profileId}:${id}` : id;

function readInventory() {
  return workspaceRelays.map((relay) => ({
    relay,
    projects: relay.client.queryClient.getQueryData<Project[]>(['projects']),
    sessions: relay.client.queryClient.getQueryData<InventorySession[]>(['sessions']),
    status:
      relay.client.live.getState().status === 'offline'
        ? 'offline'
        : relay.client.canMutate() &&
            ['ready', 'syncing'].includes(relay.client.live.getState().status)
          ? 'online'
          : 'connecting',
    online:
      relay.client.canMutate() &&
      ['ready', 'syncing'].includes(relay.client.live.getState().status),
  }));
}
let inventory = readInventory();
function getInventory() {
  const next = readInventory();
  if (
    next.some(
      (entry, i) =>
        entry.status !== inventory[i]?.status ||
        entry.projects !== inventory[i]?.projects ||
        entry.sessions !== inventory[i]?.sessions,
    )
  ) {
    inventory = next;
  }
  return inventory;
}
function subscribeInventory(listener: () => void) {
  const cleanups = workspaceRelays.flatMap(({ client }) => [
    client.subscribeAvailability(listener),
    client.queryClient.getQueryCache().subscribe(({ query }) => {
      if (query.queryKey[0] === 'sessions' || query.queryKey[0] === 'projects') {
        listener();
      }
    }),
  ]);
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
export const useWorkspaceInventory = () => useSyncExternalStore(subscribeInventory, getInventory);
