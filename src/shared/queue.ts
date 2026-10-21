import { record } from './client-state.ts';

/** Text-only view of Pi's actual session queue, never a second delivery queue. */
export interface PendingQueue {
  revision: string;
  steering: string[];
  followUp: string[];
}

export function pendingQueue(value: unknown): PendingQueue | null {
  if (value == null) {
    return null;
  }
  const raw = record(value);
  if (
    typeof raw.revision !== 'string' ||
    !raw.revision ||
    !Array.isArray(raw.steering) ||
    !raw.steering.every((item): item is string => typeof item === 'string') ||
    !Array.isArray(raw.followUp) ||
    !raw.followUp.every((item): item is string => typeof item === 'string')
  ) {
    throw new Error('Invalid pending queue');
  }
  return { revision: raw.revision, steering: raw.steering, followUp: raw.followUp };
}
