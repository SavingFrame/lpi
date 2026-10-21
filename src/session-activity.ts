import type { View } from './client-state.js';

export type SessionActivity = 'idle' | 'running' | 'blocked' | 'finished' | 'unknown';

/** Completion is observed in this bridge connection, never inferred from saved history. */
export function sessionActivity(
  connected: boolean,
  state: Record<string, unknown>,
  view: Pick<View, 'running' | 'compacting'>,
  finished: boolean,
): SessionActivity {
  if (!connected) {
    return 'unknown';
  }
  if (state.pendingDialog != null) {
    return 'blocked';
  }
  if (view.running || view.compacting || state.isStreaming === true) {
    return 'running';
  }
  if (state.hasPendingMessages === true) {
    return 'idle';
  }
  return finished ? 'finished' : 'idle';
}
