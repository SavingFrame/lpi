/** Implementations may use synchronous browser storage or asynchronous native storage. */
export interface ClientStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

const adapters = new WeakMap<ClientStorage, ClientStorage>();

/** A remount must not read an empty marker while an earlier async write is still pending. */
export function serializedStorage(storage: ClientStorage): ClientStorage {
  const existing = adapters.get(storage);
  if (existing) {
    return existing;
  }
  const pending = new Map<string, Promise<unknown>>();
  const enqueue = <T>(key: string, operation: () => T | Promise<T>): Promise<T> => {
    const previous = pending.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    pending.set(key, result);
    const cleanup = (): void => {
      if (pending.get(key) === result) {
        pending.delete(key);
      }
    };
    void result.then(cleanup, cleanup);
    return result;
  };
  const adapter: ClientStorage = {
    getItem: (key) => enqueue(key, () => storage.getItem(key)),
    setItem: (key, value) => enqueue(key, () => storage.setItem(key, value)),
    removeItem: (key) => enqueue(key, () => storage.removeItem(key)),
  };
  adapters.set(storage, adapter);
  return adapter;
}

/** Scope persisted state to one configured relay, never to the currently selected server. */
export function clientStorageKey(server: string, kind: string, id: string): string {
  return `pim:${encodeURIComponent(server)}:${kind}:${encodeURIComponent(id)}`;
}
