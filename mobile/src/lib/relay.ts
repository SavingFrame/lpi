import { type ApiEnvironment, ApiError, RelayApi } from '../../../src/client/api.ts';
import { SessionDrafts } from '../../../src/client/drafts.ts';
import { LaunchController } from '../../../src/client/launches.ts';
import { type EventSocket, LiveSession } from '../../../src/client/live.ts';
import { completionToView, ReadCompletions } from '../../../src/client/read-completion.ts';
import {
  type ClientStorage,
  clientStorageKey,
  serializedStorage,
} from '../../../src/client/storage.ts';
import type { InventorySession, Project } from '../../../src/shared/sessions.ts';
import { MobileMessages } from './messages.ts';
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

/** Mobile binding. A client stays bound to one relay for its entire lifetime. */
export class MobileRelay {
  readonly origin: string;
  readonly live: LiveSession;
  readonly reads: ReadCompletions;
  readonly launches: LaunchController;
  private readonly drafts: SessionDrafts;
  private readonly messageControllers = new Map<string, MobileMessages>();
  private reading: { id: string; following: boolean; visible: boolean } | null = null;
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
    this.drafts = new SessionDrafts({
      server: this.origin,
      storage: this.storage,
      persistImages: false,
    });
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
    this.launches = new LaunchController({
      server: this.origin,
      storage: this.storage,
      dispatch: (projectId, resumeId) => {
        if (resumeId && !this.canResume(resumeId, projectId)) {
          throw new ApiError('Session changed before resume. Nothing was sent.', 'rejected');
        }
        return this.api.launch(projectId, resumeId);
      },
      eligible: () => this.active && this.live.getState().status === 'ready',
      refresh: () => void this.refresh(),
    });
    this.reads = new ReadCompletions({
      target: () => {
        const connection = this.live.getState();
        return completionToView(connection.snapshot, {
          synchronized:
            this.active &&
            connection.status === 'ready' &&
            connection.snapshot?.session.id === this.reading?.id &&
            this.current.selectedId === this.reading?.id,
          following: this.reading?.following === true,
          visible: this.reading?.visible === true,
        });
      },
      dispatch: this.api.markViewed.bind(this.api),
      refresh: () => void this.refresh(),
    });
    this.live.subscribe(() => {
      if (this.live.getState().status !== 'ready') {
        void this.reads.synchronize();
      }
    });
  }

  messages = (id: string, projectId: string): MobileMessages => {
    let controller = this.messageControllers.get(id);
    if (!controller) {
      controller = new MobileMessages(id, projectId, this.drafts.get(id), {
        server: this.origin,
        storage: this.storage,
        connection: this.live.getState,
        dispatch: this.api.operate.bind(this.api),
        refresh: () => {
          this.live.refresh();
          void this.refresh();
        },
      });
      this.messageControllers.set(id, controller);
    }
    return controller;
  };

  private canResume(id: string, projectId: string): boolean {
    const connection = this.live.getState();
    const session = connection.snapshot?.session;
    return (
      this.active &&
      connection.status === 'ready' &&
      this.current.selectedId === id &&
      session?.id === id &&
      session.projectId === projectId &&
      session.connection === 'disconnected'
    );
  }

  resumeSession = (id: string): Promise<boolean> => {
    const session = this.current.sessions.find((item) => item.id === id);
    if (!session || !this.canResume(id, session.projectId)) {
      return Promise.resolve(false);
    }
    return this.launchSession(session.projectId, id);
  };

  createSession = (projectId: string): Promise<boolean> => this.launchSession(projectId);

  private launchSession = async (projectId: string, resumeId?: string): Promise<boolean> => {
    if (!this.current.projects.some((project) => project.id === projectId)) {
      return false;
    }
    const lifecycle = this.lifecycle;
    const selectedId = this.current.selectedId;
    const session = await this.launches.start(projectId, resumeId);
    if (!session || !this.active || lifecycle !== this.lifecycle) {
      return false;
    }
    // Invalidate inventory requests started before the acknowledged launch.
    this.inventoryVersion++;
    this.update({
      ...this.current,
      sessions: [
        {
          ...session,
          activity: 'unknown',
          readState: this.current.sessions.find((item) => item.id === session.id)?.readState ?? {
            completionId: null,
            viewedCompletionId: null,
          },
        },
        ...this.current.sessions.filter((item) => item.id !== session.id),
      ],
      loading: false,
    });
    // A late launch verdict must not navigate away from a newer selection.
    const select = this.current.selectedId === selectedId;
    if (select) {
      await this.select(session.id);
      if (resumeId) {
        this.live.refresh();
      }
    }
    void this.refresh();
    return select && this.active && lifecycle === this.lifecycle;
  };

  setReading = (id: string, following: boolean, visible: boolean): void => {
    this.reading = { id, following, visible };
    void this.reads.synchronize();
  };

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
