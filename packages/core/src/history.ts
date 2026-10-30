/**
 * Change history / undo. Each entry holds a before and after snapshot of the
 * data (events, categories, goals); undo restores `before`. The log lives on
 * the device, newest first, capped at {@link HMAX}.
 */
import { dataSnap, HMAX, sameSnap } from './model.ts';
import type { CalendarData, HistoryEntry, HistoryKind, ProtoEvent } from './model.ts';

/** "h" + base36 clock + base36 random, like the prototype. */
export const historyId = (nowMs: number, random: () => number): string =>
  'h' + nowMs.toString(36) + Math.round(random() * 1e6).toString(36);

/**
 * Build a history entry for a change, or null when nothing actually changed.
 * `before` and `after` are taken as given (pass `dataSnap(...)` results).
 */
export const makeHistoryEntry = (
  label: string, kind: HistoryKind | undefined, before: CalendarData, after: CalendarData, nowMs: number, random: () => number,
): HistoryEntry | null => {
  if (sameSnap(before, after)) return null;
  return { id: historyId(nowMs, random), t: nowMs, label, kind: kind || 'edit', before, after };
};

/** Prepend an entry, newest first, keeping at most HMAX. */
export const pushHistory = (log: ReadonlyArray<HistoryEntry>, entry: HistoryEntry): HistoryEntry[] =>
  [entry].concat(log as HistoryEntry[]).slice(0, HMAX);

/** Drop malformed entries from a stored log and cap it (what loading `aical.hist.v1` did). */
export const sanitizeHistory = (list: unknown): HistoryEntry[] =>
  Array.isArray(list) ? (list as HistoryEntry[]).filter((h) => h && h.id && h.before && h.after).slice(0, HMAX) : [];

export interface RestoreResult {
  /** the data to put back */
  data: CalendarData;
  /** "Reverted · Moved standup" */
  label: string;
  /** history entry recording the revert itself (kind `undo`), or null if it changed nothing */
  entry: HistoryEntry | null;
}

/**
 * Undo an entry: put its `before` snapshot back. Goals are only restored if the
 * entry recorded them (very old entries did not); otherwise the current goals stay.
 * The revert is itself logged.
 */
export const restoreEntry = (
  entry: HistoryEntry, current: CalendarData, nowMs: number, random: () => number,
): RestoreResult => {
  const label = 'Reverted · ' + String(entry.label).replace(/^Reverted · /, '');
  const data: CalendarData = {
    events: entry.before.events.map((e) => Object.assign({}, e)),
    cats: Object.assign({}, entry.before.cats),
    goals: entry.before.goals ? entry.before.goals.map((g) => Object.assign({}, g)) : current.goals,
  };
  const log = makeHistoryEntry(label, 'undo', dataSnap(current), dataSnap(data), nowMs, random);
  return { data, label, entry: log };
};

/** The history label for an edit of one event, by what changed (rename, re-categorise, retime). */
export const editLabel = (before: CalendarData, now: CalendarData, ev: ProtoEvent | null | undefined): string => {
  const b = ev ? before.events.find((e) => e.id === ev.id) : null;
  const a = ev ? now.events.find((e) => e.id === ev.id) : null;
  const name = (a && a.title) || (ev && ev.title) || 'event';
  if (b && a) {
    if (b.title !== a.title) return 'Renamed · ' + name;
    if (b.cat !== a.cat) return name + ' → ' + (a.cat || 'no category');
    if (b.start !== a.start || b.end !== a.end) return 'Retimed · ' + name;
  }
  if (JSON.stringify(before.cats) !== JSON.stringify(now.cats)) return 'Categories updated';
  return 'Edited · ' + name;
};
