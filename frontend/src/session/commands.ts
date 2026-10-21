import type { BridgeCommand } from '../../../src/bridge/protocol.ts';
import { record } from '../../../src/client-state.ts';
import { ApiError, type operate } from '../api.ts';
import type { LiveState } from '../live.ts';

interface CommandState {
  pending: boolean;
  uncertain: boolean;
  error: Error | null;
  outcome: string | null;
}

interface CommandEnvironment {
  connection: () => LiveState;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  dispatch: typeof operate;
  refresh: () => void;
}

/** One guarded command lane for the composer, settings, runtime controls, and extension answers. */
export class SessionCommands {
  private current: CommandState;
  private readonly listeners = new Set<() => void>();
  private readonly id: string;
  private readonly projectId: string;
  private readonly key: string;
  private readonly environment: CommandEnvironment;

  constructor(id: string, projectId: string, environment: CommandEnvironment) {
    this.id = id;
    this.projectId = projectId;
    this.key = `uncertain:${id}`;
    this.environment = environment;
    this.current = {
      pending: false,
      uncertain: environment.storage.getItem(this.key) === 'true',
      error: null,
      outcome: null,
    };
  }

  getState = (): CommandState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: CommandState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  available(): boolean {
    const connection = this.environment.connection();
    const session = connection.snapshot?.session;
    return (
      connection.status === 'ready' &&
      session?.id === this.id &&
      session.projectId === this.projectId &&
      session.connection === 'connected' &&
      !this.current.pending &&
      !this.current.uncertain
    );
  }

  submit = async (command: BridgeCommand): Promise<boolean> => {
    if (!this.available()) {
      return false;
    }
    const session = this.environment.connection().snapshot?.session;
    if (!session) {
      return false;
    }
    this.update({ ...this.current, pending: true, error: null });
    let dispatched = false;
    let accepted = false;
    try {
      // Persist before dispatch so reload/navigation cannot silently permit a resend.
      this.environment.storage.setItem(this.key, 'true');
      dispatched = true;
      const result = await this.environment.dispatch(this.id, session.generation, command);
      const disposition = result.data == null ? null : record(result.data).disposition;
      this.environment.storage.removeItem(this.key);
      this.update({
        pending: false,
        uncertain: false,
        error: null,
        outcome:
          command.type === 'stop_runtime'
            ? 'Shutdown requested. Runtime exit is not yet confirmed.'
            : command.type === 'extension'
              ? 'Answer accepted by the native extension.'
              : `${disposition ? String(disposition) : String(result.outcome)}. Not necessarily finished.`,
      });
      accepted = true;
    } catch (error) {
      const uncertain = dispatched && !(error instanceof ApiError && error.outcome === 'rejected');
      if (!uncertain) {
        this.environment.storage.removeItem(this.key);
      }
      this.update({
        pending: false,
        uncertain,
        error: error instanceof Error ? error : new Error(String(error)),
        outcome: null,
      });
    }
    this.environment.refresh();
    return accepted;
  };

  review = (): void => {
    if (this.current.pending || this.environment.connection().status !== 'ready') {
      return;
    }
    this.environment.storage.removeItem(this.key);
    this.update({ ...this.current, uncertain: false, error: null });
  };
}
