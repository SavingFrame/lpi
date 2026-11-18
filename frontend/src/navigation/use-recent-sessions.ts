import { useEffect, useState } from 'react';
import type { InventorySession } from '../../../src/shared/sessions';

/** Snapshot discovery times once; subsequent inventory updates must not reorder recent work. */
export function useRecentSessions(
  sessions: InventorySession[],
  storageKey: string,
  selectedId?: string,
) {
  const [recency, setRecency] = useState<Record<string, number>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.entries(value).filter(
            ([, time]) => typeof time === 'number' && Number.isFinite(time),
          ),
        );
      }
    } catch {
      // Recents remain usable without browser storage.
    }
    return {};
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
    try {
      localStorage.setItem(storageKey, JSON.stringify(recency));
    } catch {
      // In-memory ordering remains usable when storage is unavailable.
    }
  }, [recency, storageKey]);
  return recency;
}
