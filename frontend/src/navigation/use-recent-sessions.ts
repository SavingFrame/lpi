import { useEffect, useState } from 'react';
import type { InventorySession } from '../../../src/shared/sessions';
import { workspaceRelays } from '../client/controllers';
import { workspaceKey } from '../client/workspace-inventory';

/** Snapshot discovery times once; subsequent inventory updates must not reorder recent work. */
export function useRecentSessions(sessions: InventorySession[], selectedId?: string) {
  const [recency, setRecency] = useState<Record<string, number>>(() => {
    const result: Record<string, number> = {};
    for (const { profileId, client } of workspaceRelays) {
      try {
        const raw: unknown = JSON.parse(
          localStorage.getItem(`lpi:sidebar:${client.origin}:recent`) ?? '{}',
        );
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [id, time] of Object.entries(raw)) {
            if (typeof time === 'number' && Number.isFinite(time)) {
              result[workspaceKey(profileId, id)] = time;
            }
          }
        }
      } catch {
        // Ignore unreadable recents for this relay.
      }
    }
    return result;
  });
  useEffect(() => {
    setRecency((current) => {
      const missing = sessions.filter((session) => !Object.hasOwn(current, session.id));
      if (missing.length === 0) {
        return current;
      }
      return {
        ...current,
        ...Object.fromEntries(
          missing.map((session) => [
            session.id,
            Date.parse(session.updatedAt ?? session.createdAt) || 0,
          ]),
        ),
      };
    });
  }, [sessions]);
  useEffect(() => {
    if (selectedId) {
      setRecency((current) => ({ ...current, [selectedId]: Date.now() }));
    }
  }, [selectedId]);
  useEffect(() => {
    for (const { profileId, client } of workspaceRelays) {
      const prefix = workspaceKey(profileId, '');
      const entries = Object.entries(recency)
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, time]) => [id.slice(prefix.length), time]);
      try {
        localStorage.setItem(
          `lpi:sidebar:${client.origin}:recent`,
          JSON.stringify(Object.fromEntries(entries)),
        );
      } catch {
        // In-memory ordering remains usable when storage is unavailable.
      }
    }
  }, [recency]);
  return recency;
}
