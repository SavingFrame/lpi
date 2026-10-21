import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Config } from '../config.js';
import type { Events } from '../events.js';
import { emptyView, record } from '../shared/client-state.js';
import { BRIDGE_LIMIT, type BridgeCommand, bridgeCommand } from '../shared/commands.js';
import { AppError, text } from '../shared/errors.js';
import { sessionActivity } from '../shared/session-activity.js';
import { promptTitle, type Session } from '../shared/sessions.js';
import {
  type BridgeSnapshot,
  bridgeSnapshot,
  bridgeStatus,
  projectEvent,
  projectStatus,
} from '../shared/snapshots.js';
import { piInventoryId } from '../storage/session-id.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NativeSession {
  launchId?: string;
  session: Session;
  socket?: WebSocket;
  snapshot: BridgeSnapshot;
  pending: Map<string, Pending>;
}

/** An observation/control channel to an already running TUI. Never opens a session writer. */
export class NativeBridges {
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: BRIDGE_LIMIT,
    perMessageDeflate: false,
  });
  private readonly sessions = new Map<string, NativeSession>();
  private readonly config: Config;
  private readonly events: Events;
  private readonly timeout: number;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly alive = new WeakSet<WebSocket>();
  private closed = false;

  constructor(config: Config, events: Events, timeout = 10_000) {
    this.config = config;
    this.events = events;
    this.timeout = timeout;
    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
        } else {
          this.alive.delete(socket);
          socket.ping();
        }
      }
    }, 15_000);
    this.heartbeat.unref();
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.closed || request.headers.origin !== undefined || this.sockets.clients.size >= 32) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (client) => this.connect(client));
  }

  private connect(socket: WebSocket): void {
    let native: NativeSession | undefined;
    const connectionId = randomUUID();
    function warn(event: string, details: Record<string, unknown>): void {
      console.warn(
        '[pim:bridge]',
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event,
          connectionId,
          sessionId: native?.session.id,
          generation: native?.session.generation,
          ...details,
        }),
      );
    }
    const startup = setTimeout(() => {
      warn('attach-timeout', { timeoutMs: 5000 });
      socket.terminate();
    }, 5000);
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
    socket.on('error', (error) => {
      warn('socket-error', { reason: error.message.slice(0, 512) });
      socket.terminate();
    });
    socket.on('close', () => {
      clearTimeout(startup);
      if (native?.socket === socket) {
        native.socket = undefined;
        native.session.connection = 'disconnected';
        native.session.generation++;
        native.snapshot = {
          ...native.snapshot,
          state: { nativeTui: true, readOnly: true, bridgeConnected: false },
          view: {
            ...emptyView(),
            messages: native.snapshot.view.messages,
            notice:
              'Native bridge disconnected. Pi may still be running. Remote controls are blocked.',
          },
        };
        for (const pending of native.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(
            new AppError('Native command outcome unknown after disconnect', 503, 'unknown'),
          );
        }
        native.pending.clear();
        this.events.publish(
          native.session.id,
          native.session.generation,
          'connection',
          native.session,
        );
      }
    });
    socket.on('message', (data, binary) => {
      const phase = native ? 'connected' : 'registration';
      let frame = 'unparsed';
      try {
        if (binary) {
          throw new Error('Text bridge frames required');
        }
        const raw = record(JSON.parse(data.toString()));
        frame = ['attach', 'ack', 'status', 'sync', 'event'].includes(String(raw.type))
          ? String(raw.type)
          : 'unsupported';
        if (!native) {
          if (raw.type !== 'attach') {
            throw new Error('Attach first');
          }
          native = this.attach(raw, socket);
          clearTimeout(startup);
          return;
        }
        if (native.socket !== socket) {
          throw new Error('Stale bridge connection');
        }
        if (raw.type === 'ack') {
          const id = text(raw.id, 'command ID', 64);
          const pending = native.pending.get(id);
          if (!pending) {
            throw new Error('Unknown or stale command acknowledgment');
          }
          if (raw.outcome !== 'acknowledged' && raw.outcome !== 'rejected') {
            throw new Error('Invalid command acknowledgment');
          }
          const rejection =
            raw.outcome === 'rejected' ? text(raw.error, 'command rejection', 4096) : undefined;
          clearTimeout(pending.timer);
          native.pending.delete(id);
          if (rejection) {
            pending.reject(new AppError(rejection, 422));
          } else {
            pending.resolve({ disposition: 'dispatched' });
          }
          return;
        }
        if (raw.type === 'status') {
          const status = bridgeStatus({
            ...raw,
            notice: record(raw.state).pendingDialog ?? null,
          });
          native.snapshot = projectStatus(native.snapshot, {
            ...status,
            state: { ...status.state, readOnly: false, nativeTui: true },
          });
          this.events.publish(native.session.id, native.session.generation, 'bridge-status', {
            state: native.snapshot.state,
            controls: native.snapshot.controls,
            notice: native.snapshot.view.notice,
          });
        } else if (raw.type === 'sync') {
          native.snapshot = bridgeSnapshot(raw.snapshot);
          this.events.publish(native.session.id, native.session.generation, 'bridge-sync', null);
        } else if (raw.type === 'event') {
          const event = record(raw.event);
          if (
            ![
              'agent_start',
              'agent_settled',
              'message_start',
              'message_update',
              'message_end',
              'tool_execution_start',
              'tool_execution_update',
              'tool_execution_end',
              'compaction_start',
              'compaction_end',
              'extension_support',
            ].includes(String(event.type))
          ) {
            throw new Error('Unsupported bridge event');
          }
          const next = projectEvent(native.snapshot, event);
          if (next.view.tools.length > 512) {
            throw new Error('Native tool limit reached');
          }
          if (Buffer.byteLength(JSON.stringify(next)) > BRIDGE_LIMIT) {
            throw new Error('Native snapshot limit reached');
          }
          native.snapshot = next;
          this.events.publish(native.session.id, native.session.generation, 'pi-event', event);
        } else {
          throw new Error('Unsupported bridge frame');
        }
        if (raw.type === 'sync' || raw.type === 'event') {
          native.session.updatedAt = new Date().toISOString();
        }
        native.session.title =
          promptTitle(native.snapshot.state.sessionName) ??
          promptTitle(
            native.snapshot.view.messages.find((message) => message.role === 'user')?.content,
          );
      } catch (error) {
        // JSON parser errors can quote payload contents. Never log frames or parser excerpts.
        warn('rejected', {
          phase,
          frame,
          reason:
            error instanceof SyntaxError
              ? 'Invalid JSON'
              : error instanceof Error
                ? error.message.slice(0, 512)
                : 'Unknown bridge error',
        });
        clearTimeout(startup);
        socket.close(1008, 'Bridge registration or protocol rejected');
      }
    });
  }

  private attach(raw: Record<string, unknown>, socket: WebSocket): NativeSession {
    const identity = record(raw.session);
    const cwd = realpathSync(text(identity.cwd, 'native cwd', 4096));
    const project = this.config.projects.find((item) => item.directory === cwd);
    const path = text(identity.file, 'native session file', 4096);
    if (!project || !isAbsolute(path)) {
      throw new Error('Native project or file unavailable');
    }
    // New Pi sessions may have a filename before their first message is persisted.
    const file = existsSync(path)
      ? realpathSync(path)
      : join(realpathSync(dirname(path)), basename(path));
    const piSessionId = text(identity.id, 'native Pi session ID', 128);
    if (existsSync(file)) {
      const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = fstatSync(fd);
        if (!metadata.isFile()) {
          throw new Error('Native session must be a regular file');
        }
        const buffer = Buffer.alloc(65_536);
        const size = readSync(fd, buffer, 0, buffer.length, 0);
        const end = buffer.subarray(0, size).indexOf(10);
        if (end < 0) {
          throw new Error('Missing or oversized native header');
        }
        const header = record(JSON.parse(buffer.subarray(0, end).toString('utf8')));
        if (
          header.type !== 'session' ||
          header.id !== piSessionId ||
          realpathSync(text(header.cwd, 'header cwd', 4096)) !== cwd
        ) {
          throw new Error('Native file identity mismatch');
        }
      } finally {
        closeSync(fd);
      }
    }
    const createdAt = text(identity.createdAt, 'native creation time', 128);
    if (!Number.isFinite(Date.parse(createdAt))) {
      throw new Error('Invalid native creation time');
    }
    const id = piInventoryId(file);
    const previous = this.sessions.get(id);
    if (previous && (previous.socket || previous.session.piSessionId !== piSessionId)) {
      throw new Error('Conflicting native connection or session identity');
    }
    if (!previous && this.sessions.size >= 32) {
      throw new Error('Native session inventory limit reached');
    }
    const native: NativeSession = {
      launchId: raw.launchId === undefined ? undefined : text(raw.launchId, 'launch ID', 128),
      socket,
      pending: new Map(),
      session: {
        id,
        file,
        directory: cwd,
        projectId: project.id,
        createdAt,
        updatedAt: new Date().toISOString(),
        piSessionId,
        connection: 'connected',
        generation: (previous?.session.generation ?? 0) + 1,
      },
      snapshot: bridgeSnapshot(raw.snapshot),
    };
    native.session.title =
      promptTitle(native.snapshot.state.sessionName) ??
      promptTitle(
        native.snapshot.view.messages.find((message) => message.role === 'user')?.content,
      );
    this.sessions.set(id, native);
    socket.send(
      JSON.stringify({
        type: 'attached',
        sessionId: id,
        generation: native.session.generation,
      }),
    );
    this.events.publish(id, native.session.generation, 'connection', native.session);
    return native;
  }

  findLaunch(launchId: string): Session | undefined {
    const native = [...this.sessions.values()].find(
      (item) => item.launchId === launchId && item.session.connection === 'connected',
    );
    return native ? structuredClone(native.session) : undefined;
  }

  list() {
    return structuredClone(
      [...this.sessions.values()].map((native) => ({
        ...native.session,
        activity: sessionActivity(
          native.session.connection === 'connected',
          native.snapshot.state,
          native.snapshot.view,
        ),
      })),
    );
  }

  get(id: string): Session | undefined {
    const native = this.sessions.get(id);
    return native ? structuredClone(native.session) : undefined;
  }

  snapshot(id: string): BridgeSnapshot | undefined {
    const native = this.sessions.get(id);
    return native ? structuredClone(native.snapshot) : undefined;
  }

  async command(id: string, expected: number, raw: BridgeCommand): Promise<unknown> {
    const command = bridgeCommand(raw);
    const native = this.sessions.get(id);
    const socket = native?.socket;
    if (
      this.closed ||
      !native ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      native.session.connection !== 'connected' ||
      native.session.generation !== expected
    ) {
      throw new AppError('Native bridge unavailable or stale generation');
    }
    if (command.type === 'stop_runtime' && native.snapshot.state.managedRuntime !== true) {
      throw new AppError('Only Pim-managed runtimes can be stopped remotely', 422);
    }
    if (native.pending.size >= 32 || socket.bufferedAmount > 1024 * 1024) {
      throw new AppError('Native command channel overloaded', 429);
    }
    return new Promise((resolve, reject) => {
      const commandId = randomUUID();
      const timer = setTimeout(() => {
        // Do not replay an uncertain command or accept more against this connection.
        reject(new AppError('Native command acknowledgment timed out', 503, 'unknown'));
        socket.terminate();
      }, this.timeout);
      native.pending.set(commandId, { resolve, reject, timer });
      socket.send(
        JSON.stringify({ type: 'command', id: commandId, generation: expected, command }),
      );
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.clients) {
      socket.terminate();
    }
    this.sockets.close();
  }
}
