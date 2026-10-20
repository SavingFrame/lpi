import type { NativeBridges } from './bridge/server.js';
import { emptyView, message } from './client-state.js';
import { AppError } from './errors.js';
import type { Events } from './events.js';
import type { SessionDiscovery } from './storage/discovery.js';

export interface Session {
  id: string;
  projectId: string;
  directory: string;
  file: string;
  createdAt: string;
  piSessionId: string;
  connection: 'connected' | 'disconnected';
  /** Connection version for rejecting stale commands, not a runtime ownership claim. */
  generation: number;
}

/** Read-only saved history plus connections to existing native Pi runtimes. */
export class Sessions {
  private readonly discovery: SessionDiscovery;
  private readonly bridges: NativeBridges;
  private readonly events: Events;

  constructor(discovery: SessionDiscovery, bridges: NativeBridges, events: Events) {
    this.discovery = discovery;
    this.bridges = bridges;
    this.events = events;
  }

  list(): Session[] {
    const native = this.bridges.list();
    const ids = new Set(native.map((session) => session.id));
    return [...this.discovery.list().filter((session) => !ids.has(session.id)), ...native];
  }

  get(id: string): Session {
    const session = this.bridges.get(id) ?? this.discovery.get(id);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    return session;
  }

  snapshot(id: string) {
    const native = this.bridges.snapshot(id);
    if (native) {
      return { ...this.events.checkpoint(), session: this.get(id), ...native };
    }
    const session = this.get(id);
    const inspected = this.discovery.inspect(id);
    return {
      ...this.events.checkpoint(),
      session,
      state: { sessionName: inspected.name, readOnly: true, bridgeConnected: false },
      controls: { model: null, thinkingLevel: null, contextUsage: null },
      view: {
        ...emptyView(),
        messages: inspected.messages.map(message),
        notice: 'Read-only file snapshot. Connect native Pi for live output and remote controls.',
      },
    };
  }
}
