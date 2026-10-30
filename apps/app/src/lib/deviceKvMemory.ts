/** The device KV contract and its in-memory implementation (tests, and the fallback when storage is unavailable). */
export interface DeviceKv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** An in-memory store (tests, and the fallback when storage is unavailable). */
export function createMemoryDeviceKv(initial?: Record<string, string>): DeviceKv {
  const m = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getString: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}
