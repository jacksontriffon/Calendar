/** Reading the snapshot back from shared storage (the Android widget draws from this; tests round-trip it). */
import { readOps } from './queue';
import { KEYS, SNAPSHOT_VERSION, type DoneOp, type WidgetSnapshot, type WidgetStorage } from './types';

export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WidgetSnapshot>;
    if (!s || s.v !== SNAPSHOT_VERSION || typeof s.writtenAt !== 'string' || !Array.isArray(s.events) || !s.prefs || !s.tokens) return null;
    return { ...s, goals: Array.isArray(s.goals) ? s.goals : [], ops: Array.isArray(s.ops) ? s.ops : [], cats: s.cats ?? {} } as WidgetSnapshot;
  } catch {
    return null;
  }
}

export interface Loaded {
  snapshot: WidgetSnapshot | null;
  ops: DoneOp[];
}

/** The snapshot (null when signed out) and the queued checks to draw on top of it. */
export function loadForDraw(storage: Pick<WidgetStorage, 'get'>): Loaded {
  const snapshot = parseSnapshot(storage.get(KEYS.snapshot));
  return { snapshot, ops: snapshot ? readOps(storage) : [] };
}
