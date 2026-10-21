import type { View } from './client-state.js';

export type SessionActivity = 'idle' | 'running' | 'blocked' | 'unknown';

/** Runtime activity is separate from durable completion/read notifications. */
export function sessionActivity(
  connected: boolean,
  state: Record<string, unknown>,
  view: Pick<View, 'running' | 'compacting'>,
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
  return 'idle';
}
