import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildSessionContext, parseSessionEntries } from '@earendil-works/pi-coding-agent';
import { emptyView, message, record, reduceRpc, type View } from './client-state.js';
import type { Config } from './config.js';
import { AppError, object } from './errors.js';
import type { Events } from './events.js';
import type { OwnershipEvent } from './ownership.js';
import { RpcProcess } from './rpc/process.js';
import type { Command } from './rpc/protocol.js';
import { type SessionControls, sessionControls } from './session-controls.js';
import type { Catalog, Session } from './storage/catalog.js';
import type { SessionDiscovery } from './storage/discovery.js';

export class Coordinator {
  private readonly runtimes = new Map<string, RpcProcess>();
  private readonly views = new Map<string, View>();
  private snapshotsInFlight = 0;
  private shuttingDown = false;
  private storageFailure?: Error;
  private readonly config: Config;
  private readonly catalog: Catalog;
  private readonly events: Events;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly discovery?: SessionDiscovery;

  constructor(
    config: Config,
    catalog: Catalog,
    events: Events,
    environment = process.env,
    discovery?: SessionDiscovery,
  ) {
    this.config = config;
    this.catalog = catalog;
    this.events = events;
    this.environment = environment;
    this.discovery = discovery;
  }

  list(): Session[] {
    return [...this.catalog.list(), ...(this.discovery?.list() ?? [])];
  }

  get(id: string): Session {
    return this.discovery?.get(id) ?? this.catalog.get(id);
  }

  create(projectId: string): Session {
    this.assertAvailable();
    const project = this.config.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    const session = this.catalog.create(project);
    this.events.publish(session.id, session.ownership.generation, 'created', session);
    return session;
  }

  async start(id: string, expected: number): Promise<Session> {
    this.assertAvailable();
    if (this.runtimes.size >= 16) {
      throw new AppError('Active runtime limit reached', 429);
    }
    if (this.discovery?.get(id)) {
      throw new AppError(
        'Existing Pi sessions are read-only until coordinated TUI access is implemented',
        409,
      );
    }
    const session = this.catalog.get(id);
    const project = this.config.projects.find((item) => item.id === session.projectId);
    if (!project) {
      throw new AppError('Project unavailable', 409);
    }
    // Synchronous durable claim precedes spawn. Concurrent claims cannot pass.
    this.change(id, 'claim', expected);
    this.views.set(id, emptyView());
    const rpc = new RpcProcess(
      this.config.pi,
      ['--mode', 'rpc', '--session', session.file, '--session-dir', dirname(session.file)],
      project.directory,
      this.environment,
      (record) => {
        const owner = this.catalog.get(id).ownership;
        const view = reduceRpc(this.views.get(id) ?? emptyView(), record);
        // Persisted messages come from RPC snapshots, not an unbounded event cache.
        this.views.set(id, { ...view, messages: [] });
        this.events.publish(id, owner.generation, 'rpc', record);
        if (
          record.type === 'extension_ui_request' &&
          ['select', 'confirm', 'input', 'editor'].includes(String(record.method))
        ) {
          // Phase 3 implements answers and reconnecting dialogs.
          this.events.publish(id, owner.generation, 'interaction-unavailable', {
            reason: 'Remote dialog responses are not implemented in Phase 2',
          });
        }
      },
      (exit) => {
        this.runtimes.delete(id);
        this.views.delete(id);
        try {
          let owner = this.catalog.get(id).ownership;
          if (owner.phase === 'stopping' && (exit.signal !== null || exit.code !== 0)) {
            this.change(id, 'uncertain', owner.generation);
            owner = this.catalog.get(id).ownership;
          }
          this.change(id, 'exit', owner.generation);
          this.events.publish(id, this.catalog.get(id).ownership.generation, 'exit', {
            ...exit,
            stderr: rpc.stderr,
            interrupted: owner.phase !== 'stopping' || exit.signal !== null || exit.code !== 0,
          });
        } catch (error) {
          // Failed persistence must not authorize further writers.
          this.storageFailure = error instanceof Error ? error : new Error(String(error));
        }
      },
      30_000,
      () => {
        try {
          const owner = this.catalog.get(id).ownership;
          if (owner.phase !== 'unknown' && owner.phase !== 'unowned') {
            this.change(id, 'uncertain', owner.generation);
          }
        } catch (error) {
          this.storageFailure = error instanceof Error ? error : new Error(String(error));
        }
      },
    );
    this.runtimes.set(id, rpc);
    try {
      this.change(id, 'spawned', this.catalog.get(id).ownership.generation, rpc.child.pid);
      const state = object(await rpc.request({ type: 'get_state' }));
      if (state.sessionFile !== session.file || state.sessionId !== id) {
        throw new AppError('RPC opened an unexpected session', 503, 'unknown');
      }
      const owner = this.catalog.get(id).ownership;
      if (rpc.closed || owner.phase !== 'starting' || this.shuttingDown) {
        throw new AppError('RPC startup interrupted', 503, 'unknown');
      }
      return this.change(id, 'ready', owner.generation, rpc.child.pid);
    } catch (error) {
      try {
        await rpc.stop();
      } catch {
        const owner = this.catalog.get(id).ownership;
        if (owner.phase !== 'unknown' && owner.phase !== 'unowned') {
          this.change(id, 'uncertain', owner.generation);
        }
      }
      throw error;
    }
  }

  async command(id: string, expected: number, command: Command): Promise<unknown> {
    this.assertAvailable();
    const owner = this.catalog.get(id).ownership;
    const rpc = this.runtimes.get(id);
    if (owner.phase !== 'rpc' || owner.generation !== expected || !rpc) {
      throw new AppError('Runtime unavailable or stale generation');
    }
    // Management commands remain blocked. Skills and templates expand normally.
    if (command.type === 'prompt' && command.message.trimStart().startsWith('/')) {
      const result = object(await rpc.request({ type: 'get_commands' }));
      const name = command.message.trimStart().split(/\s/, 1)[0]?.slice(1);
      const commands = Array.isArray(result.commands) ? result.commands.map(object) : [];
      if (
        commands.some((item) => item.name === name && item.source === 'extension') ||
        !commands.some(
          (item) => item.name === name && (item.source === 'skill' || item.source === 'prompt'),
        )
      ) {
        throw new AppError('Extension slash commands are blocked pending the extension audit', 422);
      }
      // Recheck ownership after the asynchronous discovery request.
      if (this.catalog.get(id).ownership.generation !== expected) {
        throw new AppError('Ownership changed while checking command');
      }
    }
    const result = await rpc.request(command);
    if (command.type === 'set_model' || command.type === 'set_thinking_level') {
      this.events.publish(id, this.catalog.get(id).ownership.generation, 'settings-changed', null);
    }
    return result;
  }

  async snapshot(id: string): Promise<unknown> {
    this.assertAvailable();
    if (this.snapshotsInFlight >= 16) {
      throw new AppError('Snapshot concurrency limit reached', 429);
    }
    this.snapshotsInFlight++;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const checkpoint = this.events.checkpoint(id);
        const session = this.get(id);
        const rpc = this.runtimes.get(id);
        let state: Record<string, unknown> = {};
        let messages: unknown[] = [];
        let controls: SessionControls = {
          model: null,
          thinkingLevel: null,
          models: [],
          thinkingLevels: [],
          contextUsage: null,
        };
        if (session.ownership.phase === 'rpc' && rpc) {
          const [rawState, rawMessages, rawModels, rawLevels, rawStats] = await Promise.all([
            rpc.request({ type: 'get_state' }),
            rpc.request({ type: 'get_messages' }),
            rpc.request({ type: 'get_available_models' }),
            rpc.request({ type: 'get_available_thinking_levels' }),
            rpc.request({ type: 'get_session_stats' }),
          ]);
          state = record(rawState);
          controls = sessionControls({
            model: state.model ?? null,
            thinkingLevel: state.thinkingLevel ?? null,
            models: record(rawModels).models,
            thinkingLevels: record(rawLevels).levels,
            contextUsage: record(rawStats).contextUsage ?? null,
          });
          const result = record(rawMessages);
          if (!Array.isArray(result.messages)) {
            throw new AppError('Invalid RPC snapshot', 503);
          }
          messages = result.messages;
        } else if (session.source === 'pi' && this.discovery) {
          const inspected = this.discovery.inspect(id);
          messages = inspected.messages;
          state = { sessionName: inspected.name, readOnly: true };
        } else if (session.ownership.phase === 'unowned') {
          // Pure read/projection only. Never open a second runtime or SessionManager.
          if (statSync(session.file).size > 32 * 1024 * 1024) {
            throw new AppError('Stopped transcript exceeds the 32 MiB read limit', 413);
          }
          const entries = parseSessionEntries(readFileSync(session.file, 'utf8')).filter(
            (entry) => entry.type !== 'session',
          );
          messages = buildSessionContext(entries).messages;
        }
        const boundary = this.events.checkpoint(id);
        if (
          boundary.revision !== checkpoint.revision ||
          this.get(id).ownership.generation !== session.ownership.generation
        ) {
          continue;
        }
        const view = this.views.get(id) ?? emptyView();
        if (session.source === 'pi') {
          view.notice =
            'Read-only file snapshot. Native Pi may still own this session. Refresh to see persisted changes.';
        }
        return {
          epoch: boundary.epoch,
          cursor: boundary.cursor,
          session,
          state,
          controls,
          view: {
            ...structuredClone(view),
            messages: messages.map(message),
            running: view.running || state.isStreaming === true,
            compacting: view.compacting || state.isCompacting === true,
          },
        };
      }
      throw new AppError('Session changed during snapshot; retry inspection', 409);
    } finally {
      this.snapshotsInFlight--;
    }
  }

  async stop(id: string, expected: number): Promise<Session> {
    this.assertAvailable();
    this.change(id, 'stop', expected);
    const rpc = this.runtimes.get(id);
    if (!rpc) {
      this.change(id, 'uncertain', this.catalog.get(id).ownership.generation);
      throw new AppError('Runtime exit cannot be confirmed', 503, 'unknown');
    }
    try {
      await rpc.stop();
      this.assertStorage();
      return this.catalog.get(id);
    } catch (error) {
      const owner = this.catalog.get(id).ownership;
      if (owner.phase === 'stopping') {
        this.change(id, 'uncertain', owner.generation);
      }
      throw error;
    }
  }

  async shutdown(): Promise<boolean> {
    this.shuttingDown = true;
    const results = await Promise.allSettled(
      [...this.runtimes.entries()].map(async ([id, rpc]) => {
        try {
          const owner = this.catalog.get(id).ownership;
          if (owner.phase === 'rpc') {
            this.change(id, 'stop', owner.generation);
          }
        } finally {
          // Storage failure must block future claims, not strand live children.
          await rpc.stop();
        }
      }),
    );
    return (
      !this.storageFailure &&
      this.runtimes.size === 0 &&
      results.every((result) => result.status === 'fulfilled')
    );
  }

  private change(id: string, event: OwnershipEvent, expected: number, pid?: number): Session {
    try {
      const session = this.catalog.change(id, event, expected, pid);
      this.events.publish(id, session.ownership.generation, 'ownership', session.ownership);
      return session;
    } catch (error) {
      if (!(error instanceof AppError)) {
        this.storageFailure = error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    }
  }

  private assertStorage(): void {
    if (this.storageFailure) {
      throw new AppError('Ownership persistence unavailable; coordinator blocked', 503, 'unknown');
    }
  }

  private assertAvailable(): void {
    this.assertStorage();
    if (this.shuttingDown) {
      throw new AppError('Server shutting down', 503);
    }
  }
}
