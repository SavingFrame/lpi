import type { EventSocket } from '../../../src/client/live.ts';

export type { LiveState } from '../../../src/client/live.ts';

export function openEventSocket(url: URL): EventSocket {
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
}
