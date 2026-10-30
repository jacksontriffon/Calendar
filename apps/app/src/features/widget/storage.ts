/**
 * Shared widget storage, web and fallback: widgets do not exist on the web
 * build, so this is a quiet in-memory stand-in and `reload` does nothing.
 * Metro picks `storage.ios.ts` (App Group) and `storage.android.ts` (MMKV).
 */
import type { WidgetStorage } from './types';

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

/** The widget storage for this platform (none on the web). */
export const widgetStorage: WidgetStorage = createMemoryWidgetStorage();

/** True where a widget exists to feed (iOS and Android). */
export const widgetsSupported = false;
