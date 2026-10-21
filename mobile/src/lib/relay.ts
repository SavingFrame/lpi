import { type ApiEnvironment, RelayApi } from '../../../src/client/api.ts';
import { type EventSocket, LiveSession } from '../../../src/client/live.ts';
import {
  type ClientStorage,
  clientStorageKey,
  serializedStorage,
} from '../../../src/client/storage.ts';
import type { InventorySession, Project } from '../../../src/shared/sessions.ts';
import { eventsUrl, relayOrigin } from './server.ts';

interface RelayEnvironment extends ApiEnvironment {
  storage: ClientStorage;
  openSocket: (url: string) => EventSocket;
}

export interface InventoryState {
  projects: Project[];
  sessions: InventorySession[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}

/** Read-only mobile binding. A client stays bound to one relay for its entire lifetime. */
export class MobileRelay {
  readonly origin: string;
  readonly live: LiveSession;
  private readonly api: RelayApi;
  private readonly storage: ClientStorage;
  private readonly selectionKey: string;
  private readonly listeners = new Set<() => void>();
  private current: InventoryState = {
    projects: [],
    sessions: [],
    selectedId: null,
    loading: false,
    error: null,
  };
  private active = false;
  private lifecycle = 0;
  private inventoryVersion = 0;
  private restored = false;
  private savedId: string | null = null;

  constructor(server: string, environment: RelayEnvironment) {
    this.origin = relayOrigin(server);
    this.storage = serializedStorage(environment.storage);
    this.selectionKey = clientStorageKey(this.origin, 'selection', 'session');
    this.api = new RelayApi({
      fetch: (path, request) => environment.fetch(new URL(path, this.origin).href, request),
      requestId: environment.requestId,
    });
    this.live = new LiveSession(
      {
        inspect: this.api.inspect.bind(this.api),
        openSocket: () => environment.openSocket(eventsUrl(this.origin)),
      },
      () => void this.refresh(),
    );
  }

  getState = (): InventoryState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: InventoryState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  start = async (): Promise<void> => {
    if (this.active) {
      return;
    }
    this.active = true;
    const lifecycle = ++this.lifecycle;
    if (!this.restored) {
      try {
        const saved = await this.storage.getItem(this.selectionKey);
        if (!this.active || lifecycle !== this.lifecycle) {
          return;
        }
        this.savedId = saved;
        this.restored = true;
      } catch {
        this.update({ ...this.current, error: 'Could not restore the selected session.' });
      }
    }
    if (this.active && lifecycle === this.lifecycle) {
      this.live.connect();
    }
  };

  stop = (): void => {
    this.active = false;
    this.lifecycle++;
    this.inventoryVersion++;
    this.live.disconnect();
    this.update({ ...this.current, loading: false });
  };

  refresh = async (): Promise<void> => {
    if (!this.active) {
      return;
    }
    const version = ++this.inventoryVersion;
    this.update({ ...this.current, loading: true, error: null });
    try {
      const [projects, sessions] = await Promise.all([this.api.projects(), this.api.sessions()]);
      if (!this.active || version !== this.inventoryVersion) {
        return;
      }
      const candidate = this.current.selectedId ?? this.savedId;
      const selectedId = sessions.some((session) => session.id === candidate) ? candidate : null;
      this.savedId = null;
      this.update({ projects, sessions, selectedId, loading: false, error: null });
      this.live.select(selectedId);
    } catch (error) {
      if (this.active && version === this.inventoryVersion) {
        this.update({ ...this.current, loading: false, error: String(error) });
      }
    }
  };

  select = async (id: string): Promise<void> => {
    if (!this.current.sessions.some((session) => session.id === id)) {
      return;
    }
    this.update({ ...this.current, selectedId: id });
    this.live.select(id);
    try {
      await this.storage.setItem(this.selectionKey, id);
    } catch {
      this.update({ ...this.current, error: 'Selection could not be saved on this device.' });
    }
  };
}
