/** iOS / Android: MMKV (synchronous, memory-mapped). See `deviceKv.ts` for the contract. */
import { createMMKV } from 'react-native-mmkv';

import type { DeviceKv } from './deviceKv';

export type { DeviceKv } from './deviceKv';
export { createMemoryDeviceKv } from './deviceKv';

let instance: DeviceKv | null = null;

export function getDeviceKv(): DeviceKv {
  if (!instance) {
    const mmkv = createMMKV({ id: 'calendar-device' });
    instance = {
      getString: (k) => mmkv.getString(k),
      set: (k, v) => mmkv.set(k, v),
      remove: (k) => void mmkv.remove(k),
      keys: () => mmkv.getAllKeys(),
    };
  }
  return instance;
}
