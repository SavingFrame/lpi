import { type ProjectDiff, projectDiff } from '../shared/project-diff.ts';
import type { EventSocket } from './live.ts';

export interface ProjectDiffState {
  data: ProjectDiff | null;
  loading: boolean;
  error: Error | null;
  status: 'paused' | 'connecting' | 'live' | 'reconnecting';
}

interface DiffEnvironment {
  read: (signal: AbortSignal) => Promise<ProjectDiff>;
  openSocket: () => EventSocket;
}

/** Read-only live invalidation. Lost subscriptions always refresh; nothing is replayed. */
export class ProjectDiffController {
  private readonly environment: DiffEnvironment;
  private readonly listeners = new Set<() => void>();
  private current: ProjectDiffState = { data: null, loading: false, error: null, status: 'paused' };
  private active = false;
  private socket: EventSocket | null = null;
  private request: AbortController | null = null;
  private dirty = false;
  private retry = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private debounce?: ReturnType<typeof setTimeout>;
  private readRetry?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;

  constructor(environment: DiffEnvironment) {
    this.environment = environment;
  }

  getState = (): ProjectDiffState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(change: Partial<ProjectDiffState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) {
      listener();
    }
  }

  start = (): void => {
    if (this.active) {
      return;
    }
    this.active = true;
    this.retry = 0;
    this.connect();
    void this.refresh();
  };

  stop = (): void => {
    this.active = false;
    clearTimeout(this.reconnect);
    clearTimeout(this.readRetry);
    clearTimeout(this.debounce);
    clearTimeout(this.handshake);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.request?.abort();
    this.request = null;
    this.dirty = false;
    this.update({ loading: false, status: 'paused' });
  };

  refresh = async (): Promise<void> => {
    if (!this.active) {
      return;
    }
    if (this.request) {
      this.dirty = true;
      return;
    }
    clearTimeout(this.debounce);
    clearTimeout(this.readRetry);
    const controller = new AbortController();
    this.request = controller;
    this.dirty = false;
    this.update({ loading: true });
    try {
      const data = projectDiff(await this.environment.read(controller.signal));
      if (this.request !== controller || !this.active) {
        return;
      }
      const previous = this.current.data;
      this.update({
        data:
          previous?.patch === data.patch && previous.truncated === data.truncated ? previous : data,
        error: null,
      });
    } catch (error) {
      if (this.request === controller && this.active) {
        this.update({
          error: error instanceof Error ? error : new Error('Could not refresh diff'),
        });
        this.readRetry = setTimeout(() => void this.refresh(), 2000);
      }
    } finally {
      if (this.request === controller) {
        this.request = null;
        this.update({ loading: false });
        if (this.dirty && this.active) {
          void this.refresh();
        }
      }
    }
  };

  private connect(): void {
    if (!this.active) {
      return;
    }
    this.update({ status: this.retry ? 'reconnecting' : 'connecting' });
    let socket: EventSocket;
    try {
      socket = this.environment.openSocket();
    } catch {
      this.lost();
      return;
    }
    this.socket = socket;
    const fail = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      clearTimeout(this.handshake);
      socket.close();
      this.lost();
    };
    this.handshake = setTimeout(fail, 10_000);
    socket.onclose = fail;
    socket.onerror = fail;
    socket.onmessage = (message) => {
      if (this.socket !== socket || !this.active) {
        return;
      }
      try {
        if (typeof message.data !== 'string' || message.data.length > 1024) {
          throw new Error('Invalid diff event');
        }
        const event: unknown = JSON.parse(message.data);
        if (!event || typeof event !== 'object' || !('type' in event)) {
          throw new Error('Invalid diff event');
        }
        if (event.type === 'diff-ready') {
          clearTimeout(this.handshake);
          this.retry = 0;
          this.update({ status: 'live' });
          void this.refresh();
        } else if (event.type === 'diff-changed') {
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => void this.refresh(), 200);
        } else {
          throw new Error('Invalid diff event');
        }
      } catch {
        fail();
      }
    };
  }

  private lost(): void {
    if (!this.active) {
      return;
    }
    this.update({ status: 'reconnecting' });
    this.reconnect = setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
  }
}
