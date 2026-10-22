import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SessionReadState } from '../shared/session-read-state.js';

/** Relay UI metadata only. Never opens or modifies a Pi conversation file. */
export class SessionReadStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS session_read_state (
        session_id TEXT PRIMARY KEY,
        completion_id TEXT NOT NULL,
        viewed_completion_id TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_archive_state (
        session_id TEXT PRIMARY KEY
      ) STRICT;
    `);
  }

  get(sessionId: string): SessionReadState {
    const row = this.database
      .prepare(`
      SELECT completion_id, viewed_completion_id FROM session_read_state WHERE session_id = ?
    `)
      .get(sessionId);
    return {
      completionId: typeof row?.completion_id === 'string' ? row.completion_id : null,
      viewedCompletionId:
        typeof row?.viewed_completion_id === 'string' ? row.viewed_completion_id : null,
    };
  }

  complete(sessionId: string): SessionReadState {
    this.database
      .prepare(`
      INSERT INTO session_read_state (session_id, completion_id) VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET completion_id = excluded.completion_id
    `)
      .run(sessionId, randomUUID());
    return this.get(sessionId);
  }

  markViewed(sessionId: string, completionId: string): SessionReadState {
    // Compare and set: an old device cannot acknowledge a newer completion or regress read state.
    this.database
      .prepare(`
      UPDATE session_read_state SET viewed_completion_id = completion_id
      WHERE session_id = ? AND completion_id = ?
    `)
      .run(sessionId, completionId);
    return this.get(sessionId);
  }

  isArchived(sessionId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM session_archive_state WHERE session_id = ?')
        .get(sessionId) !== undefined
    );
  }

  setArchived(sessionId: string, archived: boolean): void {
    this.database
      .prepare(
        archived
          ? 'INSERT OR IGNORE INTO session_archive_state (session_id) VALUES (?)'
          : 'DELETE FROM session_archive_state WHERE session_id = ?',
      )
      .run(sessionId);
  }

  close(): void {
    this.database.close();
  }
}
