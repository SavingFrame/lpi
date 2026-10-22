import type { BridgeCommand } from '../shared/commands.ts';
import type { InventorySession, Session } from '../shared/sessions.ts';
import type { RelayApi } from './api.ts';
import type { LiveState } from './live.ts';
import { MutationGuard } from './mutation-guard.ts';
import { type ClientStorage, clientStorageKey } from './storage.ts';

export interface CommandState {
  loading: boolean;
  pending: boolean;
  uncertain: boolean;
  error: Error | null;
  outcome: string | null;
  shutdownGeneration: number | null;
}

export interface CommandEnvironment {
  server: string;
  connection: () => LiveState;
  storage: ClientStorage;
  dispatch: RelayApi['operate'];
  refresh: () => void;
  runtime?: () => InventorySession | undefined;
}

/** One guarded lane for the composer, settings, runtime controls, and extension answers. */
export class SessionCommands {
  private current: CommandState = {
    loading: true,
    pending: false,
    uncertain: false,
    error: null,
    outcome: null,
    shutdownGeneration: null,
  };
  private readonly guard: MutationGuard;
  private readonly id: string;
  private readonly projectId: string;
  private readonly environment: CommandEnvironment;
  private outcome: string | null = null;
  private shutdownGeneration: number | null = null;

  constructor(id: string, projectId: string, environment: CommandEnvironment) {
    this.id = id;
    this.projectId = projectId;
    this.environment = environment;
    this.guard = new MutationGuard(
      environment.storage,
      clientStorageKey(environment.server, 'command', id),
    );
    this.guard.subscribe(() => {
      const state = this.guard.getState();
      this.current = {
        loading: state.status === 'loading',
        pending: state.status === 'pending',
        uncertain: state.status === 'uncertain',
        error: state.error,
        outcome: state.status === 'ready' && !state.error ? this.outcome : null,
        shutdownGeneration: this.shutdownGeneration,
      };
    });
  }

  initialize = (): Promise<void> => this.guard.initialize();
  getState = (): CommandState => this.current;
  subscribe = (listener: () => void): (() => void) => this.guard.subscribe(listener);

  private connected(): boolean {
    const connection = this.environment.connection();
    const session = connection.snapshot?.session;
    return (
      connection.status === 'ready' &&
      session?.id === this.id &&
      session.projectId === this.projectId &&
      session.connection === 'connected'
    );
  }

  available = (): boolean => this.connected() && this.guard.getState().status === 'ready';

  submit = async (command: BridgeCommand): Promise<boolean> => {
    if (!this.available()) {
      return false;
    }
    const generation = this.environment.connection().snapshot?.session.generation;
    if (generation === undefined) {
      return false;
    }
    return this.run(
      command,
      generation,
      () =>
        this.connected() &&
        this.environment.connection().snapshot?.session.generation === generation,
    );
  };

  private stopTarget(): Session | undefined {
    const connection = this.environment.connection();
    if (connection.status !== 'ready') {
      return undefined;
    }
    const snapshot = connection.snapshot;
    const target =
      snapshot?.session.id === this.id ? snapshot.session : this.environment.runtime?.();
    const managed =
      snapshot?.session.id === this.id
        ? snapshot.state.managedRuntime === true
        : target !== undefined && 'managedRuntime' in target && target.managedRuntime === true;
    return managed &&
      target?.id === this.id &&
      target.projectId === this.projectId &&
      target.connection === 'connected'
      ? target
      : undefined;
  }

  canStop = (generation: number): boolean =>
    this.guard.getState().status === 'ready' &&
    this.shutdownGeneration !== generation &&
    this.stopTarget()?.generation === generation;

  stopRuntime = (generation: number): Promise<boolean> => {
    if (!this.canStop(generation)) {
      return Promise.resolve(false);
    }
    return this.run(
      { type: 'stop_runtime' },
      generation,
      () => this.stopTarget()?.generation === generation,
    );
  };

  private async run(
    command: BridgeCommand,
    generation: number,
    eligible: () => boolean,
  ): Promise<boolean> {
    this.outcome = null;
    const result = await this.guard.run(async () => {
      const result = await this.environment.dispatch(this.id, generation, command);
      if (command.type === 'stop_runtime') {
        this.shutdownGeneration = generation;
      }
      this.outcome =
        command.type === 'stop_runtime'
          ? 'Shutdown requested. Runtime exit is not yet confirmed.'
          : command.type === 'clear_queue'
            ? 'Queued messages cleared.'
            : command.type === 'navigate_tree'
              ? 'Native branch switched.'
              : command.type === 'extension'
                ? 'Answer accepted by the native extension.'
                : null;
      return result;
    }, eligible);
    this.environment.refresh();
    return result !== null;
  }

  review = async (): Promise<void> => {
    const runtime = this.environment.runtime?.();
    if (
      this.connected() ||
      (this.environment.connection().status === 'ready' &&
        runtime?.id === this.id &&
        runtime.projectId === this.projectId)
    ) {
      await this.guard.review();
    }
  };
}
