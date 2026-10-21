import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import type { EventSocket } from '../../../src/client/live';
import type { ClientStorage } from '../../../src/client/storage';
import { MobileRelay } from './relay';

export const nativeStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
} satisfies ClientStorage;

export const serverPreferenceKey = 'pim:mobile:server';

export function createRelay(origin: string): MobileRelay {
  return new MobileRelay(origin, {
    storage: nativeStorage,
    fetch: (url, request) => fetch(url, request),
    requestId: randomUUID,
    openSocket: (url) => {
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
  });
}
