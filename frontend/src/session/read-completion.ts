import { hasUnreadCompletion } from '../../../src/shared/session-read-state.ts';
import type { Snapshot } from '../../../src/shared/snapshots.ts';

/** Select only the loaded completion, never a newer inventory notification. */
export function completionToView(
  snapshot: Pick<Snapshot, 'session' | 'readState'> | null,
  conditions: { synchronized: boolean; following: boolean; visible: boolean },
): { id: string; completionId: string } | null {
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
