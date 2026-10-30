/**
 * Weekly series.
 *
 * NOTE: the prototype source this package was extracted from has no
 * recurrence logic (no `repWords`, series or top-up code; the plan's risk
 * table says as much: "the prototype doesn't persist series/rep today"). This
 * module is therefore a new, small design written against the plan's `series`
 * table (`freq='weekly'`, `weekdays`, `start_day`, `until`) rather than a port.
 * The conventions follow the rest of the package: day keys, floating local
 * time, caller-supplied clock and ids, weekdays numbered like JS `getDay()`
 * (0 = Sunday … 6 = Saturday).
 */
import { addDays, DOW, dnum, key, MON } from './time.ts';
import type { ProtoEvent, Series } from './model.ts';

/** The repeating part of an event: what each occurrence looks like. */
export type SeriesTemplate = Pick<ProtoEvent, 'title' | 'cat' | 'start' | 'end'> & Partial<Pick<ProtoEvent, 'allDay' | 'days' | 'visibility'>>;

/** Default number of days ahead a series is kept materialised as events. */
export const SERIES_HORIZON_DAYS = 56;

const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Sorted, de-duplicated weekdays in 0..6; anything else is dropped. */
export const normWeekdays = (list: ReadonlyArray<number>): number[] =>
  Array.from(new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))).sort((a, b) => a - b);

/** Whether the series has an occurrence on a day key. */
export const occursOn = (s: Series, dk: string): boolean => {
  if (dk < s.startDay) return false;
  if (s.until && dk > s.until) return false;
  return s.weekdays.indexOf(dnum(dk).getDay()) >= 0;
};

/** Day keys of every occurrence in `[from, to]` (inclusive), oldest first. */
export const occurrenceDays = (s: Series, from: string, to: string): string[] => {
  const out: string[] = [];
  if (!s.weekdays.length) return out;
  let d = dnum(from < s.startDay ? s.startDay : from);
  const last = s.until && s.until < to ? s.until : to;
  while (key(d) <= last) {
    if (s.weekdays.indexOf(d.getDay()) >= 0) out.push(key(d));
    d = addDays(d, 1);
  }
  return out;
};

/**
 * Concrete events for the occurrences in `[from, to]`. Days in `skip` (for
 * example days the user deleted from the series) are left out.
 */
export const expandSeries = (
  s: Series, t: SeriesTemplate, range: { from: string; to: string }, nextId: () => string, skip?: ReadonlySet<string> | ReadonlyArray<string>,
): ProtoEvent[] => {
  const skipSet = skip instanceof Set ? skip : new Set(skip || []);
  return occurrenceDays(s, range.from, range.to).filter((dk) => !skipSet.has(dk)).map((dk) => {
    const e: ProtoEvent = {
      id: nextId(), day: dk, cat: t.cat, title: t.title,
      start: t.allDay ? 0 : t.start, end: t.allDay ? 1440 : t.end,
      seriesId: s.id,
    };
    if (t.allDay) { e.allDay = true; e.days = t.days || 1; }
    if (t.visibility) e.visibility = t.visibility;
    return e;
  });
};

/**
 * Keep a series materialised: the events to add so that every occurrence from
 * today to today + `horizonDays` exists. Days that already have an event of
 * this series, and days in `skip`, are not duplicated, so it is safe to call
 * on every launch.
 */
export const topUpSeries = (
  s: Series, t: SeriesTemplate, existing: ReadonlyArray<Pick<ProtoEvent, 'day' | 'seriesId'>>, today: Date, nextId: () => string,
  o: { horizonDays?: number; skip?: ReadonlyArray<string> } = {},
): ProtoEvent[] => {
  const have = new Set<string>(existing.filter((e) => e.seriesId === s.id).map((e) => e.day));
  (o.skip || []).forEach((dk) => have.add(dk));
  return expandSeries(s, t, { from: key(today), to: key(addDays(today, o.horizonDays == null ? SERIES_HORIZON_DAYS : o.horizonDays)) }, nextId, have);
};

/** Delete "this and all future" occurrences from `fromDay`: drops those events and ends the series the day before (null if nothing earlier remains). */
export const endSeriesFrom = (
  s: Series, events: ReadonlyArray<ProtoEvent>, fromDay: string,
): { series: Series | null; events: ProtoEvent[] } => {
  const kept = events.filter((e) => !(e.seriesId === s.id && e.day >= fromDay));
  const prior = occurrenceDays(s, s.startDay, key(addDays(dnum(fromDay), -1)));
  return { series: prior.length ? { ...s, until: key(addDays(dnum(fromDay), -1)) } : null, events: kept };
};

/** "Every day" / "Weekdays" / "Weekends" / "Every Tue" / "Every Mon, Wed and Fri", plus " until 6 Dec" when the series ends. */
export const repWords = (s: Pick<Series, 'weekdays' | 'until'>): string => {
  const w = normWeekdays(s.weekdays);
  const has = (...d: number[]) => w.length === d.length && d.every((x) => w.indexOf(x) >= 0);
  let base: string;
  if (!w.length) base = 'Never';
  else if (w.length === 7) base = 'Every day';
  else if (has(1, 2, 3, 4, 5)) base = 'Weekdays';
  else if (has(0, 6)) base = 'Weekends';
  else {
    // Monday first, as the app's weeks start on Monday
    const order = w.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DOW[d]);
    base = 'Every ' + (order.length === 1 ? order[0] : order.slice(0, -1).join(', ') + ' and ' + order[order.length - 1]);
  }
  if (s.until && w.length) {
    const d = dnum(s.until);
    base += ' until ' + d.getDate() + ' ' + MON[d.getMonth()];
  }
  return base;
};

/** Google Calendar `RRULE` for a weekly series: `RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261206`. */
export const toRRule = (s: Pick<Series, 'weekdays' | 'until'>): string => {
  const w = normWeekdays(s.weekdays).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  let r = 'RRULE:FREQ=WEEKLY;BYDAY=' + w.map((d) => RR_DAYS[d]).join(',');
  if (s.until) r += ';UNTIL=' + s.until.replace(/-/g, '');
  return r;
};

/** Parse a simple weekly `RRULE` (FREQ=WEEKLY, BYDAY, UNTIL; no INTERVAL > 1 or COUNT). Null for anything else. */
export const fromRRule = (rule: string): { weekdays: number[]; until: string | null } | null => {
  const body = String(rule).replace(/^RRULE:/i, '');
  const parts: Record<string, string> = {};
  body.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i).toUpperCase()] = p.slice(i + 1); });
  if (parts.FREQ !== 'WEEKLY' || parts.COUNT || (parts.INTERVAL && parts.INTERVAL !== '1')) return null;
  const days = (parts.BYDAY || '').split(',').map((x) => RR_DAYS.indexOf(x.trim().toUpperCase() as typeof RR_DAYS[number])).filter((n) => n >= 0);
  if (!days.length) return null;
  const u = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || '');
  return { weekdays: normWeekdays(days), until: u ? u[1] + '-' + u[2] + '-' + u[3] : null };
};
