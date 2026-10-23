import { record } from '../shared/client-state.ts';
import { connectionBoundary } from '../shared/events.ts';
import { type ApiEnvironment, RelayApi } from './api.ts';
import type { EventSocket } from './live.ts';

export interface ConnectionCheckEnvironment extends ApiEnvironment {
  openSocket: () => EventSocket;
}

/** One-shot, read-only probe. Never starts a client, retries, or dispatches mutations. */
export async function checkRelay(
  environment: ConnectionCheckEnvironment,
  signal: AbortSignal,
  timeoutMs = 5000,
): Promise<void> {
  const controller = new AbortController();
  let socket: EventSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = (): void => {};
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new Error('Connection check cancelled.'));
      controller.abort();
    };
    timer = setTimeout(() => {
      reject(new Error('Connection check timed out. Check the relay address and network.'));
      controller.abort();
    }, timeoutMs);
  });
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
    }
    const probe = async (): Promise<void> => {
      if (controller.signal.aborted) {
        return;
      }
      const api = new RelayApi(environment);
      try {
        await Promise.all([api.projects(controller.signal), api.sessions(controller.signal)]);
      } catch (error) {
        throw new Error(
          'Could not validate lpi relay responses. Check the relay address (not the Expo dev server), ' +
            `network access, and HTTP/HTTPS policy. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (controller.signal.aborted) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        socket = environment.openSocket();
        socket.onmessage = ({ data }) => {
          try {
            if (typeof data !== 'string') {
              throw new Error('Invalid event frame');
            }
            const raw = record(JSON.parse(data));
            connectionBoundary(raw);
            if (raw.replay !== false) {
              throw new Error('Invalid replay contract');
            }
            resolve();
          } catch {
            reject(new Error('This server did not send a valid lpi event handshake.'));
          }
        };
        socket.onerror = socket.onclose = () =>
          reject(
            new Error('Could not connect to lpi events. Check relay WebSocket/network access.'),
          );
      });
    };
    await Promise.race([cancelled, probe()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }
}
