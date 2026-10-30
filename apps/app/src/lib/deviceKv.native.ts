/** iOS / Android: MMKV (synchronous, memory-mapped). See `deviceKv.ts` for the contract. */
import { createMMKV } from 'react-native-mmkv';

import { createMemoryDeviceKv, type DeviceKv } from './deviceKvMemory';

export { createMemoryDeviceKv, type DeviceKv };

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
