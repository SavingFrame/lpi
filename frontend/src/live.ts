import { record, reduceEvent } from '../../src/client-state.ts';
import type { ServerEvent } from '../../src/events.ts';
import { inspect, type Snapshot } from './api.ts';

export interface LiveState {
  status: 'connecting' | 'syncing' | 'ready' | 'offline';
  snapshot: Snapshot | null;
  error: string | null;
}

export class LiveSession {
  private current: LiveState = { status: 'connecting', snapshot: null, error: null };
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
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
  private readonly invalidate: () => void;

  constructor(invalidate: () => void) {
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
    const url = new URL('/events', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
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
          this.invalidate();
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
        if (item.type === 'connection') {
          this.invalidate();
        }
        if (item.sessionId !== this.id) {
          return;
        }
        if (this.buffer) {
          this.bytes += event.data.length * 2;
          if (this.bytes > 2 * 1024 * 1024 || this.buffer.length >= 4096) {
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
    if (!this.epoch || this.socket?.readyState !== WebSocket.OPEN) {
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
        const snapshot = await inspect(id, controller.signal);
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
      event.type === 'bridge-sync' ||
      event.type === 'bridge-status' ||
      (event.type === 'pi-event' &&
        ['compaction_end', 'agent_settled'].includes(String(record(event.data).type)))
    ) {
      this.refresh();
      return;
    }
    const view =
      event.type === 'pi-event' ? reduceEvent(snapshot.view, record(event.data)) : snapshot.view;
    this.update({ ...this.current, snapshot: { ...snapshot, cursor: event.cursor, view } });
  }
}
