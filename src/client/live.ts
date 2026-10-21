import { EVENT_BUFFER_LIMIT } from '../shared/attachments.ts';
import { record } from '../shared/client-state.ts';
import type { ServerEvent } from '../shared/events.ts';
import { readState } from '../shared/session-read-state.ts';
import { bridgeStatus, projectEvent, projectStatus, type Snapshot } from '../shared/snapshots.ts';
/** Structural socket contract usable by browser and React Native adapters. */
export interface EventSocket {
  readonly readyState: number;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface LiveEnvironment {
  openSocket: () => EventSocket;
  inspect: (id: string, signal: AbortSignal) => Promise<Snapshot>;
}

export interface LiveState {
  status: 'connecting' | 'syncing' | 'ready' | 'offline';
  snapshot: Snapshot | null;
  error: string | null;
}

export class LiveSession {
  private current: LiveState = { status: 'connecting', snapshot: null, error: null };
  private readonly listeners = new Set<() => void>();
  private socket: EventSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private epoch: string | null = null;
  private cursor = 0;
  private id: string | null = null;
  private attempt = 0;
  private version = 0;
  private buffer: ServerEvent[] | null = null;
  private bytes = 0;
  private readonly invalidate: (refreshTrees?: boolean, sessionId?: string) => void;

  private readonly environment: LiveEnvironment;

  constructor(
    environment: LiveEnvironment,
    invalidate: (refreshTrees?: boolean, sessionId?: string) => void,
  ) {
    this.environment = environment;
    this.invalidate = invalidate;
  }

  getState = (): LiveState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: LiveState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  connect = (): void => {
    clearTimeout(this.reconnect);
    if (this.socket) {
      return;
    }
    this.update({ ...this.current, status: 'connecting', error: null });
    const socket = this.environment.openSocket();
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      try {
        if (typeof event.data !== 'string') {
          throw new Error('Invalid event frame');
        }
        const raw = record(JSON.parse(event.data));
        if (raw.type === 'connected') {
          if (
            typeof raw.epoch !== 'string' ||
            typeof raw.cursor !== 'number' ||
            !Number.isSafeInteger(raw.cursor)
          ) {
            throw new Error('Invalid connection boundary');
          }
          this.epoch = raw.epoch;
          this.cursor = raw.cursor;
          this.attempt = 0;
          this.invalidate(true);
          this.refresh();
          return;
        }
        if (
          raw.epoch !== this.epoch ||
          raw.cursor !== this.cursor + 1 ||
          typeof raw.sessionId !== 'string' ||
          typeof raw.generation !== 'number' ||
          !Number.isSafeInteger(raw.generation) ||
          typeof raw.type !== 'string'
        ) {
          throw new Error('Event gap or invalid event. Reconnecting.');
        }
        const item = raw as unknown as ServerEvent;
        this.cursor = item.cursor;
        if (
          ['connection', 'bridge-status', 'bridge-sync', 'read-state'].includes(item.type) ||
          (item.type === 'pi-event' &&
            [
              'agent_start',
              'agent_settled',
              'compaction_start',
              'compaction_end',
              'extension_support',
            ].includes(String(record(item.data).type)))
        ) {
          this.invalidate(
            item.type === 'connection' ||
              item.type === 'bridge-sync' ||
              (item.type === 'pi-event' && record(item.data).type === 'agent_settled'),
            item.sessionId,
          );
        }
        if (item.sessionId !== this.id) {
          return;
        }
        if (this.buffer) {
          this.bytes += event.data.length * 2;
          if (this.bytes > EVENT_BUFFER_LIMIT * 2 || this.buffer.length >= 4096) {
            throw new Error('Synchronization buffer exceeded. Reconnecting.');
          }
          this.buffer.push(item);
        } else {
          this.apply(item);
        }
      } catch (error) {
        this.update({ ...this.current, status: 'offline', error: String(error) });
        socket.close();
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.epoch = null;
      this.cancelSnapshot();
      this.update({ ...this.current, status: 'offline' });
      this.reconnect = setTimeout(this.connect, Math.min(1000 * 2 ** this.attempt++, 10_000));
    };
  };

  disconnect = (): void => {
    clearTimeout(this.reconnect);
    this.cancelSnapshot();
    const socket = this.socket;
    this.socket = null;
    this.epoch = null;
    socket?.close();
    this.update({ ...this.current, status: 'offline' });
  };

  select = (id: string | null): void => {
    if (id === this.id) {
      return;
    }
    this.id = id;
    this.cancelSnapshot();
    this.update({ ...this.current, snapshot: null, error: null });
    this.refresh();
  };

  private cancelSnapshot(): void {
    this.version++;
    this.controller?.abort();
    clearTimeout(this.retry);
    this.buffer = null;
    this.bytes = 0;
  }

  refresh = (): void => {
    this.cancelSnapshot();
    if (!this.epoch || this.socket?.readyState !== 1) {
      return;
    }
    if (!this.id) {
      this.update({ status: 'ready', snapshot: null, error: null });
      return;
    }
    const id = this.id;
    const epoch = this.epoch;
    const version = this.version;
    this.buffer = [];
    this.update({ ...this.current, status: 'syncing', error: null });
    const load = async (): Promise<void> => {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const snapshot = await this.environment.inspect(id, controller.signal);
        if (version !== this.version) {
          return;
        }
        if (snapshot.epoch !== epoch || snapshot.session.id !== id) {
          this.socket?.close();
          return;
        }
        const buffered = this.buffer ?? [];
        this.buffer = null;
        this.bytes = 0;
        this.update({ status: 'ready', snapshot, error: null });
        for (const event of buffered) {
          this.apply(event);
          if (version !== this.version) {
            break;
          }
        }
      } catch (error) {
        if (version === this.version) {
          this.update({
            ...this.current,
            status: 'syncing',
            error: error instanceof Error ? error.message : String(error),
          });
          this.retry = setTimeout(() => void load(), 1000);
        }
      }
    };
    void load();
  };

  private apply(event: ServerEvent): void {
    const snapshot = this.current.snapshot;
    if (!snapshot || event.cursor <= snapshot.cursor) {
      return;
    }
    if (
      event.generation !== snapshot.session.generation ||
      event.type === 'connection' ||
      event.type === 'bridge-sync'
    ) {
      this.refresh();
      return;
    }
    if (event.type === 'read-state') {
      this.update({
        ...this.current,
        snapshot: { ...snapshot, cursor: event.cursor, readState: readState(event.data) },
      });
      return;
    }
    if (event.type === 'bridge-status') {
      this.update({
        ...this.current,
        snapshot: {
          ...snapshot,
          ...projectStatus(snapshot, bridgeStatus(event.data)),
          cursor: event.cursor,
        },
      });
      return;
    }
    const next = event.type === 'pi-event' ? projectEvent(snapshot, record(event.data)) : snapshot;
    this.update({ ...this.current, snapshot: { ...snapshot, ...next, cursor: event.cursor } });
  }
}
