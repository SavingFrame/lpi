import { type EventSocket, LiveSession as SharedLiveSession } from '../../src/client/live.ts';
import { inspect } from './api.ts';
import { relayServer } from './connection.ts';

export type { LiveState } from '../../src/client/live.ts';

/** Browser addressing and socket events stay outside the shared synchronization policy. */
export class LiveSession extends SharedLiveSession {
  constructor(invalidate: (refreshTrees?: boolean, sessionId?: string) => void) {
    super(
      {
        inspect,
        openSocket: () => {
          const url = new URL('/events', relayServer ?? window.location.href);
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
          const native = new WebSocket(url);
          const socket: EventSocket = {
            get readyState() {
              return native.readyState;
            },
            onmessage: null,
            onerror: null,
            onclose: null,
            close: () => native.close(),
          };
          native.onmessage = (event) => socket.onmessage?.({ data: event.data });
          native.onerror = () => socket.onerror?.();
          native.onclose = () => socket.onclose?.();
          return socket;
        },
      },
      invalidate,
    );
  }
}
