import { WebSocket } from 'ws';
import { BridgeWriter } from '../../../src/bridge/wire.js';
import { record } from '../../../src/shared/client-state.js';
import { BRIDGE_LIMIT } from '../../../src/shared/commands.js';
import { reserveManagedFile } from '../../../src/tmux-binding.js';
import type { NativeCommands } from './commands.js';
import type { NativeState } from './state.js';

/** Outbound relay lifecycle and bounded delivery. Never owns Pi session state. */
export class NativeTransport {
  url = process.env.PIM_BRIDGE_URL ?? 'ws://127.0.0.1:3141/bridge';
  private readonly state: NativeState;
  private readonly commands: NativeCommands;
  private socket: WebSocket | undefined;
  private writer: BridgeWriter | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private partialTimer: ReturnType<typeof setTimeout> | undefined;
  private partialEvent: Record<string, unknown> | undefined;
  private generation: number | undefined;
  private enabled = false;
  private attempt = 0;
  private lastStatus = '';

  constructor(state: NativeState, commands: NativeCommands) {
    this.state = state;
    this.commands = commands;
  }

  start(): void {
    this.stop();
    if (this.state.context?.mode !== 'tui') {
      return;
    }
    this.enabled = true;
    this.lastStatus = '';
    this.connect();
    this.heartbeat = setInterval(() => {
      if (!this.state.context || this.generation === undefined) {
        return;
      }
      const current = this.state.status();
      const serialized = JSON.stringify(current);
      if (serialized !== this.lastStatus) {
        this.lastStatus = serialized;
        this.send({ type: 'status', ...current });
      }
    }, 1000);
    this.heartbeat.unref();
  }

  stop(): void {
    this.enabled = false;
    clearTimeout(this.retry);
    this.clearPartial();
    clearInterval(this.heartbeat);
    this.generation = undefined;
    const previous = this.socket;
    this.socket = undefined;
    this.writer = undefined;
    previous?.terminate();
    this.state.context?.ui.setStatus('pim-bridge', undefined);
  }

  terminate(): void {
    this.socket?.terminate();
  }

  sync(): void {
    if (!this.state.context || this.generation === undefined) {
      return;
    }
    // Full snapshots already contain the latest throttled partial.
    this.clearPartial();
    this.send({ type: 'sync', snapshot: this.state.snapshot() });
  }

  forward(event: Record<string, unknown>): void {
    if (this.generation === undefined) {
      return;
    }
    if (event.type === 'message_update') {
      this.partialEvent = event;
      if (!this.partialTimer) {
        this.partialTimer = setTimeout(() => {
          this.partialTimer = undefined;
          if (this.partialEvent) {
            this.send({ type: 'event', event: this.partialEvent });
            this.partialEvent = undefined;
          }
        }, 40);
      }
      return;
    }
    clearTimeout(this.partialTimer);
    this.partialTimer = undefined;
    if (this.partialEvent) {
      this.send({ type: 'event', event: this.partialEvent });
      this.partialEvent = undefined;
    }
    this.send({ type: 'event', event });
  }

  private clearPartial(): void {
    clearTimeout(this.partialTimer);
    this.partialTimer = undefined;
    this.partialEvent = undefined;
  }

  private send(value: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.writer?.send(value);
    } catch {
      this.socket.terminate();
    }
  }

  private connect = (): void => {
    const context = this.state.context;
    if (!this.enabled || !context) {
      return;
    }
    try {
      const url = new URL(this.url);
      if (
        !['ws:', 'wss:'].includes(url.protocol) ||
        url.pathname !== '/bridge' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error('Pim endpoint must be a ws:// or wss:// URL ending in /bridge');
      }
      const session = this.state.identity();
      reserveManagedFile(session.file);
      const current = new WebSocket(url, {
        maxPayload: BRIDGE_LIMIT,
        perMessageDeflate: false,
        handshakeTimeout: 5000,
      });
      this.socket = current;
      this.writer = new BridgeWriter(current);
      this.generation = undefined;
      context.ui.setStatus('pim-bridge', 'Pim: connecting');
      current.on('open', () => {
        if (this.socket !== current || !this.state.context) {
          return;
        }
        this.send({
          type: 'attach',
          launchId: process.env.PIM_LAUNCH_ID,
          session,
          snapshot: this.state.snapshot(),
        });
      });
      current.on('message', async (data, binary) => {
        if (this.socket !== current || !this.state.context) {
          return;
        }
        try {
          if (binary) {
            throw new Error('Text bridge frames required');
          }
          const raw = record(JSON.parse(data.toString()));
          if (raw.type === 'attached' && this.generation === undefined) {
            if (typeof raw.generation !== 'number' || !Number.isSafeInteger(raw.generation)) {
              throw new Error('Invalid bridge generation');
            }
            this.generation = raw.generation;
            this.attempt = 0;
            this.state.context.ui.setStatus(
              'pim-bridge',
              'Pim: connected (remote controls enabled)',
            );
            // Reconcile events between attach and its acknowledgment before accepting commands.
            this.sync();
            return;
          }
          if (raw.type !== 'command') {
            throw new Error('Unsupported bridge message');
          }
          const generation = this.generation;
          const result = await this.commands.execute(raw, {
            generation,
            session,
            isCurrent: () => this.socket === current && this.generation === generation,
          });
          // Async verdicts and settings changes must never acknowledge a new connection.
          if (this.socket !== current || this.generation !== generation) {
            return;
          }
          const acknowledgment = {
            type: 'ack',
            id: result.id,
            outcome: result.outcome,
            ...(result.outcome === 'rejected' ? { error: result.error } : {}),
          };
          if (result.outcome === 'acknowledged' && result.shutdown) {
            const shutdown = result.shutdown;
            this.writer?.send(acknowledgment, () => {
              try {
                shutdown();
              } catch {
                current.terminate();
              }
            });
            return;
          }
          if (result.outcome === 'acknowledged' && result.sync) {
            this.sync();
          }
          this.send(acknowledgment);
        } catch {
          current.terminate();
        }
      });
      current.on('error', () => current.terminate());
      current.on('close', (code) => {
        if (this.socket !== current) {
          return;
        }
        this.socket = undefined;
        this.writer = undefined;
        this.generation = undefined;
        this.state.context?.ui.setStatus('pim-bridge', 'Pim: disconnected');
        if (code === 1008 || code === 1009) {
          this.enabled = false;
          this.state.context?.ui.notify(
            'Pim rejected the bridge or its payload. Check project configuration and bridge conflicts, then /pim-connect again.',
            'warning',
          );
        } else if (this.enabled) {
          this.retry = setTimeout(this.connect, Math.min(1000 * 2 ** this.attempt++, 10_000));
        }
      });
    } catch (error) {
      this.enabled = false;
      context.ui.notify(error instanceof Error ? error.message : 'Pim bridge failed', 'error');
    }
  };
}
