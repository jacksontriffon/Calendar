/**
 * A small synchronous key-value store for per-device settings and caches that
 * are not part of the synced calendar data (the widget's snapshot on Android,
 * which mark-done ops the app already applied, "hide private titles", ...).
 *
 * Metro picks `deviceKv.native.ts` (MMKV) on iOS and Android; this file is the
 * web build and the fallback for tests: `localStorage`, or memory when storage
 * is blocked (private windows, static rendering). Every read and write is
 * wrapped, so a missing or full store never throws into the caller.
 *
 * Values are strings (store JSON yourself). Keep keys short and namespaced,
 * e.g. `widget.snapshot.v1`. Other features can adopt this instead of
 * reaching for MMKV or localStorage directly.
 */
import { createMemoryDeviceKv, type DeviceKv } from './deviceKvMemory';

export { createMemoryDeviceKv, type DeviceKv };

const PREFIX = 'calendar:device:';

function createLocalStorageKv(): DeviceKv {
  const fallback = createMemoryDeviceKv();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    getString(k) {
      try {
        const v = ls()?.getItem(PREFIX + k);
        return v == null ? fallback.getString(k) : v;
      } catch {
        return fallback.getString(k);
      }
    },
    set(k, v) {
      try {
        const s = ls();
        if (s) {
          s.setItem(PREFIX + k, v);
          return;
        }
      } catch {
        // quota or blocked: keep it in memory for this session
      }
      fallback.set(k, v);
    },
    remove(k) {
      try {
        ls()?.removeItem(PREFIX + k);
      } catch {
        // ignore
      }
      fallback.remove(k);
    },
    keys() {
      const out = new Set(fallback.keys());
      try {
        const s = ls();
        if (s) {
          for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k && k.startsWith(PREFIX)) out.add(k.slice(PREFIX.length));
          }
        }
      } catch {
        // ignore
      }
      return [...out];
    },
  };
}

let instance: DeviceKv | null = null;

/** The device store. Created on first use, so importing this file costs nothing. */
export function getDeviceKv(): DeviceKv {
  return (instance ??= createLocalStorageKv());
}
