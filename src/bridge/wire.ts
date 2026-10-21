import type { WebSocket } from 'ws';
import { record } from '../shared/client-state.js';
import { BRIDGE_LIMIT } from '../shared/commands.js';

const CHUNK_LENGTH = 256 * 1024;

/** Ordered application chunks, not WebSocket fragmentation (maxPayload covers a whole message). */
export class BridgeWriter {
  private readonly socket: WebSocket;
  private readonly queue: {
    data: string;
    bytes: number;
    flushed?: () => void;
  }[] = [];
  private offset = 0;
  private pendingBytes = 0;
  private pendingLarge = false;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('close', () => {
      this.queue.length = 0;
    });
  }

  send(value: unknown, flushed?: () => void): void {
    const data = JSON.stringify(value);
    const bytes = Buffer.byteLength(data);
    // Bound waiting updates, not history. Allow one oversized message to wait behind
    // the active send, so an event followed immediately by a full sync still works.
    if (this.queue.length) {
      if (
        (bytes > BRIDGE_LIMIT && this.pendingLarge) ||
        (bytes <= BRIDGE_LIMIT && this.pendingBytes + bytes > BRIDGE_LIMIT)
      ) {
        this.socket.terminate();
        return;
      }
      if (bytes > BRIDGE_LIMIT) {
        this.pendingLarge = true;
      } else {
        this.pendingBytes += bytes;
      }
    }
    this.queue.push({ data, bytes, flushed });
    if (this.queue.length === 1) {
      this.flush();
    }
  }

  private flush(): void {
    const current = this.queue[0];
    if (!current) {
      return;
    }
    const end =
      current.bytes > BRIDGE_LIMIT
        ? Math.min(this.offset + CHUNK_LENGTH, current.data.length)
        : current.data.length;
    const final = end === current.data.length;
    const data =
      current.bytes > BRIDGE_LIMIT
        ? JSON.stringify({ type: 'chunk', data: current.data.slice(this.offset, end), final })
        : current.data;
    this.socket.send(data, (error) => {
      if (this.queue[0] !== current) {
        return;
      }
      if (error) {
        this.queue.length = 0;
        this.socket.terminate();
        return;
      }
      this.offset = final ? 0 : end;
      if (final) {
        this.queue.shift();
        const next = this.queue[0];
        if (next) {
          if (next.bytes > BRIDGE_LIMIT) {
            this.pendingLarge = false;
          } else {
            this.pendingBytes -= next.bytes;
          }
        }
        this.flush();
        current.flushed?.();
        return;
      }
      this.flush();
    });
  }
}

/** One transfer per connection. Partial transfers are never projected into session state. */
export class BridgeReader {
  private chunks: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly timeout: () => void;

  constructor(timeout: () => void) {
    this.timeout = timeout;
  }

  read(data: string): Record<string, unknown> | undefined {
    const raw = record(JSON.parse(data));
    if (raw.type !== 'chunk') {
      if (this.chunks.length) {
        throw new Error('Interleaved bridge transfer');
      }
      return raw;
    }
    if (
      typeof raw.data !== 'string' ||
      raw.data.length === 0 ||
      raw.data.length > CHUNK_LENGTH ||
      typeof raw.final !== 'boolean'
    ) {
      throw new Error('Invalid bridge chunk');
    }
    this.chunks.push(raw.data);
    clearTimeout(this.timer);
    if (!raw.final) {
      this.timer = setTimeout(() => {
        this.dispose();
        this.timeout();
      }, 30_000);
      this.timer.unref();
      return undefined;
    }
    const complete = this.chunks.join('');
    this.dispose();
    const value = record(JSON.parse(complete));
    if (value.type === 'chunk') {
      throw new Error('Nested bridge transfer');
    }
    return value;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.chunks = [];
  }
}
