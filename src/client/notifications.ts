import { record } from '../shared/client-state.ts';
import type { DesktopNotification } from '../shared/desktop.ts';
import type { ServerEvent } from '../shared/events.ts';

interface Activity {
  generation: number;
  failed: boolean;
  notice: string | null;
}

/** Live events only. Snapshots and read acknowledgments must never generate alerts. */
export class SessionNotifications {
  private readonly sessions = new Map<string, Activity>();

  reset = (): void => this.sessions.clear();

  accept(event: ServerEvent): DesktopNotification['kind'] | null {
    let state = this.sessions.get(event.sessionId);
    if (state && event.generation < state.generation) {
      return null;
    }
    if (!state || event.generation !== state.generation || event.type === 'connection') {
      state = { generation: event.generation, failed: false, notice: null };
      this.sessions.delete(event.sessionId);
      this.sessions.set(event.sessionId, state);
      if (this.sessions.size > 64) {
        const oldest = this.sessions.keys().next().value;
        if (oldest !== undefined) {
          this.sessions.delete(oldest);
        }
      }
    }
    if (event.type !== 'pi-event' && event.type !== 'bridge-status') {
      return null;
    }
    const data = record(event.data);
    if (event.type === 'bridge-status' || data.type === 'extension_support') {
      const notice = typeof data.notice === 'string' && data.notice ? data.notice : null;
      const changed = notice !== null && notice !== state.notice;
      state.notice = notice;
      return changed ? 'input' : null;
    }
    if (data.type === 'agent_start') {
      state.failed = false;
    }
    if (data.type === 'message_end') {
      const message = record(data.message);
      if (message.role === 'assistant' && message.stopReason === 'error') {
        const first = !state.failed;
        state.failed = true;
        return first ? 'error' : null;
      }
      if (message.role === 'assistant' && message.stopReason === 'aborted') {
        state.failed = true;
      }
    }
    if (data.type === 'compaction_end' && typeof data.errorMessage === 'string') {
      state.failed = true;
      return 'error';
    }
    return data.type === 'agent_settled' && !state.failed ? 'finished' : null;
  }
}
