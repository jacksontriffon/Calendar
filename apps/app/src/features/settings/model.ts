/** Pure helpers for Settings: History rows, sun settings and the daylight note. */
import { ACCENT, REGIONS, ago, fmt, pad, parseHM, regionByKey, text, type HistoryEntry, type SunPrefs } from '@calendar/core';

export interface HistoryRow {
  id: string;
  label: string;
  tag: '' | 'Claude' | 'Offline' | 'Reverted';
  meta: string;
  dot: string;
}

const PREFIX = /^(Claude|Offline parse|Note|Reverted)\s*·\s*/i;

/** The History list rows: label without its source prefix, a source tag, "5 mins ago" and the kind dot. */
export function historyRows(log: ReadonlyArray<HistoryEntry>, nowMs: number): HistoryRow[] {
  return log.map((h) => {
    const label = String(h.label).replace(PREFIX, '').replace(PREFIX, '');
    const tag = /^claude/i.test(h.label) ? 'Claude' : /^offline parse/i.test(h.label) ? 'Offline' : h.kind === 'undo' ? 'Reverted' : '';
    const dot = h.kind === 'claude' ? ACCENT : h.kind === 'delete' ? '#e8745f' : h.kind === 'undo' ? text(0.5) : text(0.24);
    return { id: h.id, label, tag, meta: ago(h.t, nowMs), dot };
  });
}

/** A region's sun times as prefs. */
export function sunForRegion(k: string): SunPrefs | null {
  const r = regionByKey(k);
  return r ? { region: r.k, sunrise: r.sr, sunset: r.ss } : null;
}

/** Typing a sunrise or sunset time: the new sun prefs (region becomes "Custom"), or null when it doesn't parse. */
export function sunWithTime(sun: SunPrefs, which: 'sunrise' | 'sunset', typed: string): SunPrefs | null {
  const m = parseHM(typed);
  return m == null ? null : { ...sun, [which]: m, region: 'Custom' };
}

/** "Daylight 6:38am – 7:23pm · 12h 45m of light". */
export function daylightNote(sun: SunPrefs): string {
  const { sunrise: sr, sunset: ss } = sun;
  return ss > sr
    ? 'Daylight ' + fmt(sr) + ' – ' + fmt(ss) + ' · ' + Math.floor((ss - sr) / 60) + 'h ' + pad((ss - sr) % 60) + 'm of light'
    : 'Sunset must come after sunrise.';
}

export const regionLabel = (k: string): string => regionByKey(k)?.label ?? (k === 'Custom' ? 'Custom' : k);
export const REGION_LIST = REGIONS;
