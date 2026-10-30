/** iOS / Android: MMKV (synchronous, memory-mapped), wrapped in the async interface. */
import { createMMKV } from 'react-native-mmkv';

import type { KeyValueStore } from './types';

export function createDeviceStore(): KeyValueStore {
  const mmkv = createMMKV({ id: 'calendar-sync' });
  return {
    async getItem(k) {
      return mmkv.getString(k) ?? null;
    },
    async setItem(k, v) {
      mmkv.set(k, v);
    },
    async removeItem(k) {
      mmkv.remove(k);
    },
    async keys() {
      return mmkv.getAllKeys();
    },
  };
}
