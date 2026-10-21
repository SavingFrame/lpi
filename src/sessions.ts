import type { NativeBridges } from './bridge/server.js';
import type { Events } from './events.js';
import { emptyView, message, record } from './shared/client-state.js';
import { AppError } from './shared/errors.js';
import type { SessionReadState } from './shared/session-read-state.js';
import type { InventorySession, Session } from './shared/sessions.js';
import type { Snapshot } from './shared/snapshots.js';
import { inspectSavedSession, type SessionDiscovery } from './storage/discovery.js';
import type { SessionReadStore } from './storage/read-state.js';

/** Read-only saved history plus connections to existing native Pi runtimes. */
export class Sessions {
  private readonly discovery: SessionDiscovery;
  private readonly bridges: NativeBridges;
  private readonly events: Events;

  private readonly readStates: SessionReadStore;
  private readonly unsubscribe: () => void;

  constructor(
    discovery: SessionDiscovery,
    bridges: NativeBridges,
    events: Events,
    readStates: SessionReadStore,
  ) {
    this.discovery = discovery;
    this.bridges = bridges;
    this.events = events;
    this.readStates = readStates;
    this.unsubscribe = events.subscribe((event) => {
      if (event.type === 'pi-event' && record(event.data).type === 'agent_settled') {
        this.readStates.complete(event.sessionId);
      }
    });
  }

  close(): void {
    this.unsubscribe();
    this.readStates.close();
  }

  markViewed(id: string, completionId: string): SessionReadState {
    const session = this.get(id);
    const readState = this.readStates.markViewed(id, completionId);
    this.events.publish(id, session.generation, 'read-state', readState);
    return readState;
  }

  list(): InventorySession[] {
    const native = this.bridges.list();
    const ids = new Set(native.map((session) => session.id));
    const visibleNative = native.filter(
      (session) =>
        session.connection === 'connected' ||
        (this.bridges.snapshot(session.id)?.view.messages.length ?? 0) > 0,
    );
    return [
      ...this.discovery
        .list()
        .filter((session) => !ids.has(session.id))
        .map((session) => ({ ...session, activity: 'unknown' as const })),
      ...visibleNative,
    ].map((session) => ({ ...session, readState: this.readStates.get(session.id) }));
  }

  get(id: string): Session {
    const session = this.bridges.get(id) ?? this.discovery.get(id);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    return session;
  }

  validateResume(id: string): void {
    inspectSavedSession(this.get(id));
  }

  snapshot(id: string): Snapshot {
    const native = this.bridges.snapshot(id);
    const readState = this.readStates.get(id);
    if (native) {
      return { ...this.events.checkpoint(), session: this.get(id), readState, ...native };
    }
    const session = this.get(id);
    const inspected = this.discovery.inspect(id);
    return {
      ...this.events.checkpoint(),
      session,
      readState,
      state: { sessionName: inspected.name, readOnly: true, bridgeConnected: false },
      controls: {
        availableModels: [],
        scopedModels: [],
        model: null,
        thinkingLevel: null,
        availableThinkingLevels: [],
        contextUsage: null,
      },
      view: {
        ...emptyView(),
        messages: inspected.messages.map(message),
        notice: 'Read-only file snapshot. Connect native Pi for live output and remote controls.',
      },
    };
  }
}
