import { record } from './client-state.ts';

export function connectionBoundary(value: unknown): { epoch: string; cursor: number } {
  const raw = record(value);
  if (
    raw.type !== 'connected' ||
    typeof raw.epoch !== 'string' ||
    !raw.epoch ||
    typeof raw.cursor !== 'number' ||
    !Number.isSafeInteger(raw.cursor) ||
    raw.cursor < 0
  ) {
    throw new Error('Invalid connection boundary');
  }
  return { epoch: raw.epoch, cursor: raw.cursor };
}

export interface ServerEvent {
  epoch: string;
  cursor: number;
  sessionId: string;
  generation: number;
  type: string;
  data: unknown;
}
