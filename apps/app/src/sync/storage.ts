/**
 * Device storage for the sync cache. This file is the fallback (memory) used
 * by tests and tooling; Metro picks `storage.native.ts` (MMKV) on iOS and
 * Android and `storage.web.ts` (IndexedDB) on web.
 */
import { createMemoryKv } from './kv';
import type { KeyValueStore } from './types';

export function createDeviceStore(): KeyValueStore {
  return createMemoryKv();
}
