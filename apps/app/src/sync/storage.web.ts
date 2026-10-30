/**
 * Web: IndexedDB (one object store of string values). Falls back to memory when
 * IndexedDB is missing or refuses to open (static rendering, some private
 * windows), so the app still works for the session.
 */
import { createMemoryKv } from './kv';
import type { KeyValueStore } from './types';

const DB_NAME = 'calendar-sync';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

export function createDeviceStore(): KeyValueStore {
  if (typeof indexedDB === 'undefined') return createMemoryKv();
  const fallback = createMemoryKv();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const db = () =>
    (dbPromise ??= openDb().catch((e) => {
      console.warn('[sync] IndexedDB unavailable, keeping data in memory only', e);
      return null;
    }));
  const store = async (mode: IDBTransactionMode) => {
    const d = await db();
    return d ? d.transaction(STORE, mode).objectStore(STORE) : null;
  };
  return {
    async getItem(k) {
      const s = await store('readonly');
      if (!s) return fallback.getItem(k);
      const v = await wrap(s.get(k));
      return typeof v === 'string' ? v : null;
    },
    async setItem(k, v) {
      const s = await store('readwrite');
      if (!s) return fallback.setItem(k, v);
      await wrap(s.put(v, k));
    },
    async removeItem(k) {
      const s = await store('readwrite');
      if (!s) return fallback.removeItem(k);
      await wrap(s.delete(k));
    },
    async keys() {
      const s = await store('readonly');
      if (!s) return fallback.keys();
      return (await wrap(s.getAllKeys())).map(String);
    },
  };
}
