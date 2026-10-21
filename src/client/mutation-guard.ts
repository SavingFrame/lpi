import { ApiError } from './api.ts';
import { type ClientStorage, serializedStorage } from './storage.ts';

export interface MutationState {
  status: 'loading' | 'ready' | 'pending' | 'uncertain';
  error: Error | null;
}

/** One in-memory lane backed by a durable marker. Never retries or replays dispatch. */
export class MutationGuard {
  private current: MutationState = { status: 'loading', error: null };
  private readonly listeners = new Set<() => void>();
  private readonly storage: ClientStorage;
  private readonly key: string;
  private initialization: Promise<void> | null = null;

  constructor(storage: ClientStorage, key: string) {
    this.storage = serializedStorage(storage);
    this.key = key;
  }

  getState = (): MutationState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: MutationState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  initialize = (): Promise<void> => {
    this.initialization ??= this.load();
    return this.initialization;
  };

  private async load(): Promise<void> {
    try {
      const marker = await this.storage.getItem(this.key);
      this.update({ status: marker === null ? 'ready' : 'uncertain', error: null });
    } catch (error) {
      // An unreadable marker is not evidence that the previous command did not execute.
      this.update({
        status: 'uncertain',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  run = async <T>(dispatch: () => Promise<T>, eligible: () => boolean): Promise<T | null> => {
    if (this.current.status !== 'ready' || !eligible()) {
      return null;
    }
    this.update({ status: 'pending', error: null });
    let persisted = false;
    let dispatched = false;
    try {
      await this.storage.setItem(this.key, 'true');
      persisted = true;
      // Async persistence may outlive foreground state, selection, or connection generation.
      if (!eligible()) {
        throw new ApiError('Connection changed before dispatch. Nothing was sent.', 'rejected');
      }
      dispatched = true;
      const result = await dispatch();
      await this.storage.removeItem(this.key);
      this.update({ status: 'ready', error: null });
      return result;
    } catch (error) {
      let uncertain = dispatched && !(error instanceof ApiError && error.outcome === 'rejected');
      if (persisted && !uncertain) {
        try {
          await this.storage.removeItem(this.key);
        } catch {
          uncertain = true;
        }
      }
      this.update({
        status: uncertain ? 'uncertain' : 'ready',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return null;
    }
  };

  review = async (): Promise<void> => {
    if (this.current.status === 'pending' || this.current.status === 'loading') {
      return;
    }
    const previous = this.current;
    this.update({ status: 'pending', error: null });
    try {
      await this.storage.removeItem(this.key);
      this.update({ status: 'ready', error: null });
    } catch (error) {
      this.update({
        status: previous.status,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  };
}
