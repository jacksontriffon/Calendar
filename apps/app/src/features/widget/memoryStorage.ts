import type { WidgetStorage } from './types';

/** In-memory widget storage: the web stand-in (`storage.ts`) and the tests. `reloads` counts redraw requests. */
export function createMemoryWidgetStorage(initial?: Record<string, string>): WidgetStorage & { dump(): Record<string, string>; reloads: number } {
  const m = new Map<string, string>(Object.entries(initial ?? {}));
  const s = {
    reloads: 0,
    get: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    set: (k: string, v: string) => void m.set(k, v),
    remove: (k: string) => void m.delete(k),
    reload() {
      s.reloads++;
    },
    dump: () => Object.fromEntries(m),
  };
  return s;
}
