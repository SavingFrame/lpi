import type { HomeAssistantConfig } from './config.js';
import type { Events } from './events.js';
import type { Sessions } from './sessions.js';
import { type Message, message, record } from './shared/client-state.js';
import { sessionLink } from './shared/session-link.js';
import { hasUnreadCompletion } from './shared/session-read-state.js';
import type { SessionReadStore } from './storage/read-state.js';

function answerPreview(content: Message['content']): string {
  const text =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join(' ');
  const plain = text
    .slice(0, 4096)
    .replace(/^\s*(```|~~~)[^\n]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(`+|\*\*|__|~~)([\s\S]*?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^\n]+?)[*_](?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(plain);
  return characters.length > 200 ? `${characters.slice(0, 199).join('')}…` : plain;
}

/** Best-effort live completion alerts. No replay, history backfill, or automatic retries. */
export class HomeAssistantNotifications {
  private readonly unsubscribe: () => void;
  private readonly pending = new Map<AbortController, ReturnType<typeof setTimeout>>();
  private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly answers = new Map<string, string>();

  constructor(
    config: HomeAssistantConfig,
    events: Events,
    sessions: Pick<Sessions, 'get'>,
    readStates: Pick<SessionReadStore, 'get'>,
    token: string,
    request: typeof fetch = fetch,
    warn: (message: string) => void = console.warn,
  ) {
    if (!token.trim() || /[\r\n]/.test(token)) {
      throw new Error('Set LPI_HA_TOKEN or LPI_HA_CREDENTIALS_FILE on the relay server');
    }
    this.unsubscribe = events.subscribe((event) => {
      if (event.type === 'connection') {
        this.answers.delete(event.sessionId);
        return;
      }
      const type = event.type === 'pi-event' ? record(event.data).type : null;
      if (event.type === 'read-state') {
        const waiting = this.waiting.get(event.sessionId);
        if (waiting !== undefined) {
          // An old read acknowledgment must not cancel a newer unread completion.
          if (!hasUnreadCompletion(readStates.get(event.sessionId))) {
            clearTimeout(waiting);
            this.waiting.delete(event.sessionId);
          }
        }
      }
      if (type !== 'agent_settled' && type !== 'agent_start' && type !== 'message_end') {
        return;
      }
      try {
        const session = sessions.get(event.sessionId);
        if (session.connection !== 'connected' || session.generation !== event.generation) {
          return;
        }
        if (type === 'message_end') {
          const item = message(record(event.data).message);
          if (item.role === 'assistant') {
            this.answers.set(session.id, answerPreview(item.content));
          }
          return;
        }
        clearTimeout(this.waiting.get(session.id));
        this.waiting.delete(session.id);
        if (type === 'agent_start') {
          this.answers.delete(session.id);
          return;
        }
        const preview = this.answers.get(session.id) || 'Agent finished answering';
        this.answers.delete(session.id);
        // Sessions persists this completion synchronously before this subscriber runs.
        const completion = readStates.get(session.id);
        if (!hasUnreadCompletion(completion)) {
          return;
        }
        if (this.waiting.size >= 32) {
          warn('[lpi:notifications] Too many pending alerts; notification skipped');
          return;
        }
        this.waiting.set(
          session.id,
          setTimeout(() => {
            this.waiting.delete(session.id);
            void send(session.id, completion.completionId, preview);
          }, 10_000),
        );
      } catch {
        warn('[lpi:notifications] Could not schedule Home Assistant notification');
      }
    });

    const send = async (
      id: string,
      completionId: string | null,
      preview: string,
    ): Promise<void> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const current = readStates.get(id);
        if (current.completionId !== completionId || !hasUnreadCompletion(current)) {
          return;
        }
        // Bound work during an HA outage. Notifications must never block the native bridge.
        if (this.pending.size >= 8) {
          warn('[lpi:notifications] Home Assistant busy; notification skipped');
          return;
        }
        const session = sessions.get(id);
        const url = sessionLink(session.id);
        timer = setTimeout(() => {
          warn('[lpi:notifications] Home Assistant notification timed out; not retried');
          controller.abort();
        }, 10_000);
        this.pending.set(controller, timer);
        const response = await request(
          new URL(`/api/services/notify/${config.service}`, config.url),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            redirect: 'error',
            signal: controller.signal,
            body: JSON.stringify({
              title: session.title?.replace(/\s+/g, ' ').trim().slice(0, 160) || 'lpi',
              message: preview,
              data: {
                notification_icon: 'mdi:vector-polyline',
                notification_icon_color: '#24333c',
                color: '#b1d4e5',
                url,
                tag: `lpi-${session.id}`,
                actions: [{ action: 'OPEN_LPI', title: 'Open session', uri: url }],
              },
            }),
          },
        );
        // Never log response bodies, URLs, errors, or headers that could contain credentials.
        await response.body?.cancel();
        if (!response.ok) {
          warn(
            `[lpi:notifications] Home Assistant rejected notification (HTTP ${response.status})`,
          );
        }
      } catch {
        if (!controller.signal.aborted) {
          warn('[lpi:notifications] Home Assistant notification failed; not retried');
        }
      } finally {
        clearTimeout(timer);
        this.pending.delete(controller);
      }
    };
  }

  close(): void {
    this.unsubscribe();
    for (const timer of this.waiting.values()) {
      clearTimeout(timer);
    }
    this.waiting.clear();
    for (const [controller, timer] of this.pending) {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
