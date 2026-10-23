import type { ClientStorage } from '../../../src/client/storage.ts';
import { relayOrigin } from './server.ts';

export const serverPreferenceKey = 'lpi:mobile:server';

interface ConnectionEnvironment {
  storage: ClientStorage;
  check: (origin: string, signal: AbortSignal) => Promise<void>;
  accept: (origin: string) => void;
}

/** A single connection lane, including persistence. Cancellation never switches clients. */
export class RelayConnection {
  private readonly environment: ConnectionEnvironment;
  private attempt: AbortController | null = null;
  private state: { pending: boolean; error: string | null } = { pending: false, error: null };
  private readonly listeners = new Set<() => void>();

  constructor(environment: ConnectionEnvironment) {
    this.environment = environment;
  }

  getState = () => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(pending: boolean, error: string | null): void {
    this.state = { pending, error };
    for (const listener of this.listeners) {
      listener();
    }
  }

  cancel = (): void => {
    this.attempt?.abort();
  };

  connect = async (value: string): Promise<void> => {
    if (this.attempt) {
      return;
    }
    const attempt = new AbortController();
    this.attempt = attempt;
    this.update(true, null);
    try {
      const origin = relayOrigin(value);
      await this.environment.check(origin, attempt.signal);
      if (attempt.signal.aborted) {
        return;
      }
      const previous = await this.environment.storage.getItem(serverPreferenceKey);
      if (attempt.signal.aborted) {
        return;
      }
      await this.environment.storage.setItem(serverPreferenceKey, origin);
      if (attempt.signal.aborted) {
        // Native storage writes cannot be aborted. Restore before releasing the lane.
        if (previous === null) {
          await this.environment.storage.removeItem(serverPreferenceKey);
        } else {
          await this.environment.storage.setItem(serverPreferenceKey, previous);
        }
        return;
      }
      this.environment.accept(origin);
    } catch (error) {
      if (!attempt.signal.aborted) {
        this.update(true, error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.attempt = null;
      this.update(false, this.state.error);
    }
  };
}
