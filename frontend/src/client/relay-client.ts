import { QueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { type HttpRequest, type HttpResponse, RelayApi } from '../../../src/client/api.ts';
import { SessionCommands } from '../../../src/client/commands.ts';
import { SessionDrafts } from '../../../src/client/drafts.ts';
import { LaunchController } from '../../../src/client/launches.ts';
import { type EventSocket, LiveSession } from '../../../src/client/live.ts';
import { SessionNotifications } from '../../../src/client/notifications.ts';
import type { ClientStorage } from '../../../src/client/storage.ts';
import { type DesktopNotification, desktopRelayOrigin } from '../../../src/shared/desktop.ts';
import type { InventorySession } from '../../../src/shared/sessions.ts';
import { openEventSocket } from './live.ts';
import { createProjectDiffRegistry } from './project-diff.ts';
import { browserStorage } from './storage.ts';

interface RelayClientOptions {
  /** Omit for the relay-hosted browser UI, whose HTTP requests stay relative. */
  relayOrigin?: string;
  requireInventory?: boolean;
  storage?: ClientStorage;
  fetch?: (url: string | URL, request: HttpRequest) => Promise<HttpResponse>;
  openSocket?: (url: URL) => EventSocket;
  notify?: (notification: Omit<DesktopNotification, 'profileId'>) => Promise<void>;
}

/** Create once per relay. Never repoint an instance or share its state with another origin. */
export function createRelayClient({
  relayOrigin,
  requireInventory = false,
  storage = browserStorage,
  // A configured relay must not forward its commands to another origin via redirects.
  fetch: fetchRequest = (url, request) =>
    fetch(url, typeof url === 'string' ? request : { ...request, redirect: 'error' }),
  openSocket = openEventSocket,
  notify,
}: RelayClientOptions = {}) {
  const origin =
    relayOrigin === undefined
      ? (globalThis.location?.origin ?? '')
      : desktopRelayOrigin(relayOrigin);
  const api = new RelayApi({
    fetch: (path, request) =>
      fetchRequest(relayOrigin === undefined ? path : new URL(path, origin), request),
    requestId: () => uuid(),
  });
  const socketUrl = (path: string): URL => {
    const url = new URL(path, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 2, staleTime: 10_000 },
      mutations: { retry: false },
    },
  });

  const projects = ({ signal }: { signal?: AbortSignal } = {}) => api.projects(signal);
  const sessions = ({ signal }: { signal?: AbortSignal } = {}) => api.sessions(signal);
  const notifications = new SessionNotifications();
  let inventoryReady = !requireInventory;
  let recovery = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const availabilityListeners = new Set<() => void>();
  const emitAvailability = () => {
    for (const listener of availabilityListeners) {
      listener();
    }
  };
  async function refreshInventory(version: number) {
    if (version !== recovery) {
      return;
    }
    try {
      await Promise.all([
        queryClient.fetchQuery({ queryKey: ['projects'], queryFn: projects, staleTime: 0 }),
        queryClient.fetchQuery({ queryKey: ['sessions'], queryFn: sessions, staleTime: 0 }),
      ]);
      if (version === recovery) {
        inventoryReady = true;
        emitAvailability();
      }
    } catch {
      if (version === recovery) {
        retry = setTimeout(() => void refreshInventory(version), 3_000);
      }
    }
  }

  const live = new LiveSession(
    {
      inspect: api.inspect.bind(api),
      openSocket: () => openSocket(socketUrl('/events')),
      onBoundary: () => {
        notifications.reset();
        if (requireInventory) {
          inventoryReady = false;
          const version = ++recovery;
          clearTimeout(retry);
          // Don't count a request that started before the new event boundary.
          void Promise.all([
            queryClient.cancelQueries({ queryKey: ['projects'] }),
            queryClient.cancelQueries({ queryKey: ['sessions'] }),
          ]).then(() => refreshInventory(version));
          emitAvailability();
        }
      },
      onEvent: (event) => {
        if (!notify) {
          return;
        }
        try {
          const notification = notifications.accept(event);
          if (!notification) {
            return;
          }
          const session = queryClient
            .getQueryData<InventorySession[]>(['sessions'])
            ?.find((session) => session.id === event.sessionId);
          if (!session || session.archived || session.generation > event.generation) {
            return;
          }
          void notify({
            sessionId: session.id,
            projectId: session.projectId,
            title: (session.title || 'lpi').replace(/\s+/g, ' ').slice(0, 160),
            ...notification,
          }).catch(() => {});
        } catch {
          // Best-effort notifications never interrupt session synchronization.
        }
      },
    },
    (refreshTrees, sessionId) => {
      if (requireInventory && !sessionId && !inventoryReady) {
        void queryClient.invalidateQueries({ queryKey: ['tree'] });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (!sessionId) {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
      if (refreshTrees) {
        void queryClient.invalidateQueries({
          queryKey: sessionId ? ['tree', sessionId] : ['tree'],
        });
      }
    },
  );

  live.subscribe(() => {
    const status = live.getState().status;
    if (requireInventory && status === 'offline') {
      inventoryReady = false;
      recovery++;
      clearTimeout(retry);
    }
    emitAvailability();
  });
  const canMutate = () => inventoryReady;
  const subscribeAvailability = (listener: () => void) => {
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
  };
  const commandControllers = new Map<string, SessionCommands>();

  /** Sidebar runtime actions and the open composer share one durable command lane. */
  function sessionCommands(id: string, projectId: string): SessionCommands {
    let commands = commandControllers.get(id);
    if (!commands) {
      commands = new SessionCommands(id, projectId, {
        server: origin,
        connection: () => {
          const state = live.getState();
          return canMutate() ? state : { ...state, status: 'connecting' };
        },
        runtime: () =>
          queryClient
            .getQueryData<InventorySession[]>(['sessions'])
            ?.find((session) => session.id === id),
        storage,
        dispatch: api.operate.bind(api),
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

  const drafts = new SessionDrafts({
    server: origin,
    storage,
    persistImages: false,
  });

  const launches = new LaunchController({
    server: origin,
    storage,
    dispatch: api.launch.bind(api),
    eligible: canMutate,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      live.refresh();
    },
  });

  const diffs = createProjectDiffRegistry(api.diff.bind(api), (path) =>
    openSocket(socketUrl(path)),
  );
  const hasPendingMutation = () =>
    queryClient.isMutating() > 0 ||
    launches.hasPending() ||
    [...commandControllers.values()].some((controller) => controller.getState().pending);
  return Object.freeze({
    hasPendingMutation,
    origin,
    api,
    projects,
    sessions,
    canMutate,
    subscribeAvailability,
    queryClient,
    live,
    sessionCommands,
    drafts,
    launches,
    diffs,
  });
}
