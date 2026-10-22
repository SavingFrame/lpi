import type { NativeBridges } from './bridge/server.js';
import type { Events } from './events.js';
import { historyMessages, historyNodes } from './pi-history.js';
import { emptyView, message, record } from './shared/client-state.js';
import { AppError } from './shared/errors.js';
import type { SessionReadState } from './shared/session-read-state.js';
import { type BranchPreview, type SessionTree, sessionTree } from './shared/session-tree.js';
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

  setArchived(id: string, archived: boolean): void {
    const session = this.get(id);
    if (archived && session.connection === 'connected') {
      throw new AppError('Stop the runtime before archiving this session', 409);
    }
    this.readStates.setArchived(id, archived);
    this.events.publish(id, session.generation, 'archive-state', { archived });
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
    ].map((session) => ({
      ...session,
      readState: this.readStates.get(session.id),
      archived: this.readStates.isArchived(session.id),
      managedRuntime: this.bridges.snapshot(session.id)?.state.managedRuntime === true,
    }));
  }

  get(id: string): Session {
    const session = this.bridges.get(id) ?? this.discovery.get(id);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    return session;
  }

  validateResume(id: string): void {
    if (this.readStates.isArchived(id)) {
      throw new AppError('Restore this session before resuming its runtime', 409);
    }
    inspectSavedSession(this.get(id));
  }

  tree(id: string): SessionTree {
    const session = this.get(id);
    const native = this.bridges.snapshot(id);
    const { entries } = inspectSavedSession(session);
    return sessionTree({
      sessionId: id,
      generation: session.generation,
      connected: session.connection === 'connected',
      activeLeafId: session.connection === 'connected' ? (native?.state.leafId ?? null) : null,
      nodes: historyNodes(entries),
    });
  }

  preview(id: string, entryId: string): BranchPreview {
    const { entries } = inspectSavedSession(this.get(id));
    if (!entries.some((entry) => entry.id === entryId)) {
      throw new AppError('Branch entry not found; refresh the tree', 404);
    }
    return { sessionId: id, entryId, messages: historyMessages(entries, entryId).map(message) };
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
