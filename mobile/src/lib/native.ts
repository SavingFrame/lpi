import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { checkRelay } from '../../../src/client/connection-check';
import type { EventSocket } from '../../../src/client/live';
import type { ClientStorage } from '../../../src/client/storage';
import { MobileRelay } from './relay';
import { eventsUrl } from './server';

export const nativeStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
} satisfies ClientStorage;

function openSocket(url: string): EventSocket {
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

export function checkServer(origin: string, signal: AbortSignal): Promise<void> {
  return checkRelay(
    {
      fetch: (path, request) => fetch(new URL(path, origin).href, request),
      requestId: randomUUID,
      openSocket: () => openSocket(eventsUrl(origin)),
    },
    signal,
  );
}

export function createRelay(origin: string): MobileRelay {
  return new MobileRelay(origin, {
    storage: nativeStorage,
    fetch: (url, request) => fetch(url, request),
    requestId: randomUUID,
    openSocket,
  });
}
