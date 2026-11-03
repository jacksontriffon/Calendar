/** Reading the snapshot back from shared storage (the Android widget draws from this; tests round-trip it). */
import { KEYS, SNAPSHOT_VERSION, type WidgetSnapshot, type WidgetStorage } from './types';

export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WidgetSnapshot>;
    if (!s || s.v !== SNAPSHOT_VERSION || typeof s.writtenAt !== 'string' || !Array.isArray(s.events) || !s.prefs || !s.tokens) return null;
    return { ...s, goals: Array.isArray(s.goals) ? s.goals : [], cats: s.cats ?? {} } as WidgetSnapshot;
  } catch {
    return null;
  }
}

export interface Loaded {
  snapshot: WidgetSnapshot | null;
}

/** The snapshot (null when signed out). */
export function loadForDraw(storage: Pick<WidgetStorage, 'get'>): Loaded {
  return { snapshot: parseSnapshot(storage.get(KEYS.snapshot)) };
}
