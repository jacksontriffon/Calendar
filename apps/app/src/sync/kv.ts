/**
 * Key-value helpers shared by every platform: an in-memory store (tests,
 * server rendering, storage that failed to open) and per-user scoping.
 */
import type { KeyValueStore } from './types';

export function createMemoryKv(initial?: Record<string, string>): KeyValueStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async getItem(k) {
      return m.has(k) ? (m.get(k) as string) : null;
    },
    async setItem(k, v) {
      m.set(k, v);
    },
    async removeItem(k) {
      m.delete(k);
    },
    async keys() {
      return [...m.keys()];
    },
    dump: () => Object.fromEntries(m),
  };
}

/** Everything one signed-in user stores lives under this prefix. */
export const userPrefix = (userId: string): string => `calendar:v1:user:${userId}:`;

/** A view of `base` where every key is prefixed; `keys()` returns only this prefix's keys, unprefixed. */
export function scopedStore(base: KeyValueStore, prefix: string): KeyValueStore {
  return {
    getItem: (k) => base.getItem(prefix + k),
    setItem: (k, v) => base.setItem(prefix + k, v),
    removeItem: (k) => base.removeItem(prefix + k),
    async keys() {
      return (await base.keys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
  };
}
