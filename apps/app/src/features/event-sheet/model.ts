/**
 * Pure helpers for the event sheet: the draft (event field patch + category
 * edits) applied on top of the live data, the History label for it, series
 * info and the time text fields. Everything else is core.
 */
import {
  DOWL, addDays, dnum, editEvent, editLabel, hm, repWords, retimeFromText,
  type CalendarData, type ProtoEvent, type Series, type Visibility,
} from '@calendar/core';

export type CatOp = (d: CalendarData) => CalendarData;

export interface Draft {
  /** event fields edited in the sheet */
  patch: Partial<ProtoEvent>;
  /** category rename / delete / add / colour edits, applied in order before the patch */
  catOps: CatOp[];
}

export const emptyDraft = (): Draft => ({ patch: {}, catOps: [] });
export const isDirty = (d: Draft): boolean => Object.keys(d.patch).length > 0 || d.catOps.length > 0;

/** The data as the sheet shows it: live data, then the category edits, then the event patch. */
export function applyDraft(data: CalendarData, id: string, d: Draft): CalendarData {
  let out = data;
  d.catOps.forEach((op) => { out = op(out); });
  return Object.keys(d.patch).length ? editEvent(out, id, d.patch) : out;
}

/**
 * Apply the draft for committing. A visibility change on a repeating event
 * covers this and all future events of the series (EV 03: no "all future" pill).
 */
export function commitDraft(data: CalendarData, id: string, d: Draft): CalendarData {
  let out = applyDraft(data, id, d);
  const ev = data.events.find((e) => e.id === id);
  if (ev && ev.seriesId && d.patch.visibility && d.patch.visibility !== ev.visibility) {
    const v: Visibility = d.patch.visibility;
    out = {
      ...out,
      events: out.events.map((e) => (e.seriesId === ev.seriesId && e.day > ev.day ? { ...e, visibility: v } : e)),
    };
  }
  return out;
}

/** History label for a sheet session: "Done · X", or the prototype's rename / re-categorise / retime label. */
export function sheetLabel(before: CalendarData, after: CalendarData, id: string, d: Draft): string {
  const ev = before.events.find((e) => e.id === id);
  const keys = Object.keys(d.patch);
  const name = (after.events.find((e) => e.id === id) || ev)?.title || 'event';
  if (keys.length === 1 && keys[0] === 'done' && !d.catOps.length) return (d.patch.done ? 'Done · ' : 'Unchecked · ') + name;
  if (keys.length === 1 && keys[0] === 'visibility' && !d.catOps.length) return (d.patch.visibility === 'public' ? 'Made public · ' : 'Made private · ') + name;
  return editLabel(before, after, ev);
}

/**
 * "Every Tue" for a repeating event: from its `series` row when the store has
 * one (weekdays and end date), else from the weekdays of the events sharing its series id.
 */
export function repeatLabel(series: readonly Series[], events: readonly ProtoEvent[], ev: ProtoEvent): string | null {
  if (!ev.seriesId) return null;
  const row = series.find((s) => s.id === ev.seriesId);
  if (row) return repWords(row);
  const days = new Set<number>();
  events.forEach((e) => { if (e.seriesId === ev.seriesId) days.add(dnum(e.day).getDay()); });
  if (!days.size) days.add(dnum(ev.day).getDay());
  return repWords({ weekdays: Array.from(days), until: null });
}

export const seriesCount = (events: readonly ProtoEvent[], ev: ProtoEvent): number =>
  ev.seriesId ? events.filter((e) => e.seriesId === ev.seriesId).length : 0;

/** "Thursday" for the day an event ends on (an overnight event shows its end day). */
export const dayName = (ev: Pick<ProtoEvent, 'day' | 'end'>): string =>
  DOWL[addDays(dnum(ev.day), ev.end > 1440 ? 1 : 0).getDay()];

/** The text a time field shows: 24 h "09:30". */
export const timeText = (m: number): string => hm(m);

/** A typed start / end time as an event patch (null when it doesn't parse). */
export function retimePatch(ev: Pick<ProtoEvent, 'start' | 'end'>, which: 'start' | 'end', text: string): Partial<ProtoEvent> | null {
  const r = retimeFromText(ev, which, text);
  return r ? (which === 'start' ? { start: r.start, end: r.end } : { end: r.end }) : null;
}

/** All-day span label: "All day", "All week", "All day · 3 days". */
export const allDayLabel = (days: number): string => (days === 7 ? 'All week' : days === 1 ? 'All day' : 'All day · ' + days + ' days');

export const allDayRange = (ev: Pick<ProtoEvent, 'day' | 'days'>): string => {
  const a = dnum(ev.day);
  const n = ev.days || 1;
  const b = addDays(a, n - 1);
  const f = (x: Date) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()] + ' ' + x.getDate();
  return n === 1 ? DOWL[a.getDay()] + ', ' + f(a) : f(a) + ' – ' + f(b);
};
