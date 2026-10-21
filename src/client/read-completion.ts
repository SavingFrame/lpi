import { hasUnreadCompletion } from '../shared/session-read-state.ts';
import type { Snapshot } from '../shared/snapshots.ts';
import type { RelayApi } from './api.ts';

export interface ReadConditions {
  synchronized: boolean;
  following: boolean;
  visible: boolean;
}

export interface CompletionTarget {
  id: string;
  completionId: string;
}

/** Select only the loaded completion, never a newer inventory notification. */
export function completionToView(
  snapshot: Pick<Snapshot, 'session' | 'readState'> | null,
  conditions: ReadConditions,
): CompletionTarget | null {
  if (
    !snapshot ||
    !conditions.synchronized ||
    !conditions.following ||
    !conditions.visible ||
    !hasUnreadCompletion(snapshot.readState) ||
    !snapshot.readState.completionId
  ) {
    return null;
  }
  return { id: snapshot.session.id, completionId: snapshot.readState.completionId };
}

export interface ReadCompletionState {
  target: CompletionTarget | null;
  pending: boolean;
  error: Error | null;
}

interface ReadEnvironment {
  target: () => CompletionTarget | null;
  dispatch: RelayApi['markViewed'];
  refresh: () => void;
}

/** Attempts each eligible completion once; failures require explicit, still-eligible retry. */
export class ReadCompletions {
  private current: ReadCompletionState = { target: null, pending: false, error: null };
  private readonly attempts = new Map<string, { pending: boolean; error: Error | null }>();
  private readonly listeners = new Set<() => void>();
  private readonly environment: ReadEnvironment;

  constructor(environment: ReadEnvironment) {
    this.environment = environment;
  }

  getState = (): ReadCompletionState => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(target: CompletionTarget | null): void {
    const attempt = target ? this.attempts.get(`${target.id}:${target.completionId}`) : undefined;
    if (
      this.current.target?.id === target?.id &&
      this.current.target?.completionId === target?.completionId &&
      this.current.pending === (attempt?.pending ?? false) &&
      this.current.error === (attempt?.error ?? null)
    ) {
      return;
    }
    this.current = {
      target,
      pending: attempt?.pending ?? false,
      error: attempt?.error ?? null,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  synchronize = async (): Promise<void> => {
    const target = this.environment.target();
    this.update(target);
    if (target && !this.attempts.has(`${target.id}:${target.completionId}`)) {
      await this.send(target);
    }
  };

  retry = async (): Promise<void> => {
    const target = this.environment.target();
    this.update(target);
    if (target && this.attempts.get(`${target.id}:${target.completionId}`)?.error) {
      await this.send(target);
    }
  };

  private async send(target: CompletionTarget): Promise<void> {
    const key = `${target.id}:${target.completionId}`;
    this.attempts.set(key, { pending: true, error: null });
    this.update(target);
    try {
      await this.environment.dispatch(target.id, target.completionId);
      this.attempts.set(key, { pending: false, error: null });
      this.environment.refresh();
    } catch (error) {
      this.attempts.set(key, {
        pending: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    // A late result never replaces a newer loaded completion or hidden/background state.
    this.update(this.environment.target());
  }
}
