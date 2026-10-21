import type { Session } from '../shared/sessions.ts';
import type { RelayApi } from './api.ts';
import { MutationGuard, type MutationState } from './mutation-guard.ts';
import { type ClientStorage, clientStorageKey } from './storage.ts';

export interface LaunchEnvironment {
  server: string;
  storage: ClientStorage;
  dispatch: RelayApi['launch'];
  eligible: () => boolean;
  refresh: () => void;
}

/** Fresh launches share a lane; saved-session resumes have individual lanes. */
export class LaunchController {
  private readonly guards = new Map<string, MutationGuard>();
  private readonly listeners = new Set<() => void>();
  private readonly environment: LaunchEnvironment;

  constructor(environment: LaunchEnvironment) {
    this.environment = environment;
  }

  private guard(resumeId?: string): MutationGuard {
    const key = clientStorageKey(this.environment.server, 'launch', resumeId ?? 'new');
    let guard = this.guards.get(key);
    if (!guard) {
      guard = new MutationGuard(this.environment.storage, key);
      guard.subscribe(() => {
        for (const listener of this.listeners) {
          listener();
        }
      });
      this.guards.set(key, guard);
    }
    return guard;
  }

  initialize = (resumeId?: string): Promise<void> => this.guard(resumeId).initialize();
  getState = (resumeId?: string): MutationState => this.guard(resumeId).getState();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start = async (projectId: string, resumeId?: string): Promise<Session | null> => {
    if (!projectId || this.getState(resumeId).status !== 'ready' || !this.environment.eligible()) {
      return null;
    }
    const session = await this.guard(resumeId).run(
      () => this.environment.dispatch(projectId, resumeId),
      this.environment.eligible,
    );
    this.environment.refresh();
    return session;
  };

  review = async (resumeId?: string): Promise<void> => {
    if (this.environment.eligible()) {
      await this.guard(resumeId).review();
    }
  };
}
