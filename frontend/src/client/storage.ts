import type { ClientStorage } from '../../../src/client/storage.ts';

export const browserStorage: ClientStorage = {
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => sessionStorage.removeItem(key),
};
