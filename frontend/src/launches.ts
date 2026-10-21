import type { Session } from '../../src/shared/sessions.ts';
import { ApiError, type launch } from './api.ts';

interface LaunchState {
  status: 'ready' | 'pending' | 'uncertain';
  error: Error | null;
}

interface LaunchEnvironment {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  dispatch: typeof launch;
  refresh: () => void;
}

/** Tab-wide launch guards. Fresh launches share a key; each saved session has its own key. */
export class LaunchController {
  private readonly states = new Map<string, LaunchState>();
  private readonly listeners = new Set<() => void>();
  private readonly environment: LaunchEnvironment;

  constructor(environment: LaunchEnvironment) {
    this.environment = environment;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (resumeId?: string): LaunchState => {
    const key = `launch-uncertain:${resumeId ?? 'new'}`;
    let state = this.states.get(key);
    if (!state) {
      state = {
        status: this.environment.storage().getItem(key) === 'true' ? 'uncertain' : 'ready',
        error: null,
      };
      this.states.set(key, state);
    }
    return state;
  };

  private update(resumeId: string | undefined, state: LaunchState): void {
    this.states.set(`launch-uncertain:${resumeId ?? 'new'}`, state);
    for (const listener of this.listeners) {
      listener();
    }
  }

  start = async (projectId: string, resumeId?: string): Promise<Session | null> => {
    if (!projectId || this.getState(resumeId).status !== 'ready') {
      return null;
    }
    const key = `launch-uncertain:${resumeId ?? 'new'}`;
    this.update(resumeId, { status: 'pending', error: null });
    let persisted = false;
    let dispatched = false;
    let session: Session | null = null;
    try {
      // Persist before dispatch: remounting or reloading cannot silently authorize another writer.
      this.environment.storage().setItem(key, 'true');
      persisted = true;
      dispatched = true;
      session = await this.environment.dispatch(projectId, resumeId);
      this.environment.storage().removeItem(key);
      this.update(resumeId, { status: 'ready', error: null });
    } catch (error) {
      session = null;
      let uncertain = dispatched && !(error instanceof ApiError && error.outcome === 'rejected');
      if (persisted && !uncertain) {
        try {
          this.environment.storage().removeItem(key);
        } catch {
          uncertain = true;
        }
      }
      this.update(resumeId, {
        status: uncertain ? 'uncertain' : 'ready',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    this.environment.refresh();
    return session;
  };

  review = (resumeId?: string): void => {
    const state = this.getState(resumeId);
    if (state.status === 'pending') {
      return;
    }
    try {
      this.environment.storage().removeItem(`launch-uncertain:${resumeId ?? 'new'}`);
      this.update(resumeId, { status: 'ready', error: null });
    } catch (error) {
      this.update(resumeId, {
        ...state,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  };
}
