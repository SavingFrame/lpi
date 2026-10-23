import { record } from '../shared/client-state.ts';
import type { DesktopNotification } from '../shared/desktop.ts';
import type { ServerEvent } from '../shared/events.ts';

interface Activity {
  generation: number;
  failed: boolean;
  notice: string | null;
  response: string;
}

/** Live events only. Snapshots and read acknowledgments must never generate alerts. */
export class SessionNotifications {
  private readonly sessions = new Map<string, Activity>();

  reset = (): void => this.sessions.clear();

  accept(event: ServerEvent): Pick<DesktopNotification, 'kind' | 'body'> | null {
    let state = this.sessions.get(event.sessionId);
    if (state && event.generation < state.generation) {
      return null;
    }
    if (!state || event.generation !== state.generation || event.type === 'connection') {
      state = { generation: event.generation, failed: false, notice: null, response: '' };
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
      return changed ? { kind: 'input', body: '' } : null;
    }
    if (data.type === 'agent_start') {
      state.failed = false;
      state.response = '';
    }
    if (data.type === 'message_end') {
      const message = record(data.message);
      if (message.role === 'assistant') {
        const content = message.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content
                  .map((block: unknown) => {
                    const item = record(block);
                    return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
                  })
                  .join('\n')
              : '';
        state.response = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      }
      if (message.role === 'assistant' && message.stopReason === 'error') {
        const first = !state.failed;
        state.failed = true;
        return first ? { kind: 'error', body: '' } : null;
      }
      if (message.role === 'assistant' && message.stopReason === 'aborted') {
        state.failed = true;
      }
    }
    if (data.type === 'compaction_end' && typeof data.errorMessage === 'string') {
      state.failed = true;
      return { kind: 'error', body: '' };
    }
    return data.type === 'agent_settled' && !state.failed
      ? { kind: 'finished', body: state.response }
      : null;
  }
}
