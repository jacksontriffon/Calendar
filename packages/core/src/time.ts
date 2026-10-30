/**
 * Date and time helpers, ported from the prototype's top-level helpers.
 *
 * Times in the calendar are *floating local time*: a day is a `YYYY-MM-DD` key
 * and a time of day is minutes past midnight. `Date` objects are only used
 * as calendar arithmetic carriers (constructed from local components), never
 * as instants, and nothing here reads the clock: callers pass `now`/`today`.
 */

export const pad = (n: number): string => (n < 10 ? '0' + n : '' + n);

/** Date -> `YYYY-MM-DD` (local components). */
export const key = (d: Date): string => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/** New date `n` calendar days away, truncated to midnight. */
export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * `YYYY-MM-DD` (or `YYYY/MM/DD`) -> local-midnight Date. The prototype used
 * `new Date(k.replace(/-/g, '/'))`; the explicit parse below gives the same
 * result without relying on engine-specific parsing of that format (Hermes).
 * Anything that is not a plain date falls back to the prototype's behaviour.
 */
export const dnum = (dk: string): Date => {
  const s = String(dk);
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) {
    const d = new Date(2000, 0, 1);
    d.setFullYear(+m[1], +m[2] - 1, +m[3]);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(s.replace(/-/g, '/'));
};

/** Local-midnight Date for a day key, as epoch ms. */
export const dayMs = (day: string): number => dnum(day).getTime();

/** Minutes elapsed between local midnight of `day` and epoch-ms `t`. */
export const minsIn = (day: string, t: number): number => (t - dayMs(day)) / 60000;

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
export const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Round to the nearest 15 minutes. */
export const snap = (m: number): number => Math.round(m / 15) * 15;
export const snapTo = (m: number, step: number): number => Math.round(m / step) * step;

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** 0..1439 minutes (wrapping, negatives allowed) -> "9am", "9:05pm", "12am", "12pm". */
export const fmt = (m: number): string => {
  m = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return h + (mm ? ':' + pad(mm) : '') + ap;
};

/** Like {@link fmt} without the am/pm suffix ("9", "9:05"). */
export const fmtShort = (m: number): string => {
  m = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  h = h % 12;
  if (h === 0) h = 12;
  return h + (mm ? ':' + pad(mm) : '');
};

/** Minutes -> 24h "HH:MM" (wrapping). */
export const hm = (m: number): string => {
  const x = ((m % 1440) + 1440) % 1440;
  return pad(Math.floor(x / 60)) + ':' + pad(x % 60);
};

/**
 * Parse a typed time ("9", "9:30", "9.30", "930", "9pm", "9 30 am") into
 * minutes past midnight, or null when it isn't a valid time.
 */
export const parseHM = (s: string): number | null => {
  const t = String(s).trim().toLowerCase().match(/^(\d{1,2})[:. ]?(\d{2})?\s*(am|pm)?$/);
  if (!t) return null;
  let h = +t[1];
  const mm = t[2] ? +t[2] : 0;
  const ap = t[3];
  if (ap) {
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  }
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
};

/* ---------- zoom ---------- */

export const ZLEVELS = [0.4, 0.6, 1, 1.7, 3, 5.2] as const;
export const ZMIN = ZLEVELS[0];
export const ZMAX = ZLEVELS[ZLEVELS.length - 1];

/** Nearest zoom level. */
export const zNear = (z: number): number =>
  ZLEVELS.reduce<number>((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a), ZLEVELS[0]);

/** Drag/resize snap step (minutes) for a zoom: 5 at the closest zoom, 10 one level below, else 15. */
export const stepFor = (z: number | null | undefined): number => {
  const n = zNear(z || 1);
  return n === ZMAX ? 5 : n === ZLEVELS[ZLEVELS.length - 2] ? 10 : 15;
};

/* ---------- periods (goals used to be scoped day/week/month/…) ---------- */

export type Scope = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const SCOPES: readonly Scope[] = ['day', 'week', 'month', 'quarter', 'year'];
export const SCOPELBL: Record<Scope, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
export const SCOPESHORT: Record<Scope, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Qtr', year: 'Year' };
export const SPANWORD: Record<Scope, string> = { day: 'the day', week: 'the week', month: 'the month', quarter: 'the quarter', year: 'the year' };

/** First day of the period containing `d` (weeks start on Monday). */
export const startOfPeriod = (scope: Scope | string, d: Date): Date => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (scope === 'day') return t;
  if (scope === 'year') return new Date(t.getFullYear(), 0, 1);
  if (scope === 'month') return new Date(t.getFullYear(), t.getMonth(), 1);
  if (scope === 'quarter') return new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
};

/** Exclusive end of the period that starts at `s`. Unknown scopes are weeks. */
export const endOfPeriod = (scope: Scope | string, s: Date): Date => {
  if (scope === 'day') return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
  if (scope === 'year') return new Date(s.getFullYear() + 1, 0, 1);
  if (scope === 'month') return new Date(s.getFullYear(), s.getMonth() + 1, 1);
  if (scope === 'quarter') return new Date(s.getFullYear(), s.getMonth() + 3, 1);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
};

export const periodDays = (scope: Scope | string, s: Date): number =>
  Math.round((endOfPeriod(scope, s).getTime() - s.getTime()) / 86400000);

/** Monday of the week containing `d`, as a day key. */
export const weekKey = (d: Date): string => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return key(m);
};

/** ISO week number of a day key. */
export const weekNum = (dk: string): number => {
  const d = dnum(dk);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const f = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t.getTime() - f.getTime()) / 86400000 - 3 + ((f.getDay() + 6) % 7)) / 7);
};

/** `2026-10-02` -> "2nd Oct" (note September is "Sept"); '' for anything unparseable. */
export const niceDate = (k: string | null | undefined): string => {
  const p = String(k || '').split('-').map(Number);
  if (p.length < 3 || !p[2]) return '';
  const d = p[2];
  const o = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return d + o + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][p[1] - 1];
};

/** Hours -> short number: 1.25 -> "1.3", 0 -> "0", 12.4 -> "12" (one decimal under 10). */
export const hrs = (n: number | string | null | undefined): string => {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  return Math.abs(r) < 10 ? String(r).replace(/\.0$/, '') : String(Math.round(r));
};

/** Hours -> duration label: 0.5 -> "30m", 2 -> "2h", 0.04 -> "5m". */
export const dur = (h: number | string | null | undefined): string => {
  h = Math.max(0, Number(h) || 0);
  return h > 0 && h < 1 ? Math.max(5, Math.round(h * 12) * 5) + 'm' : hrs(h) + 'h';
};

/** Minutes -> "2h 5m" / "45m" (used for the "left today" labels). */
export const fmtDur = (m: number): string => {
  m = Math.round(m);
  const h = Math.floor(m / 60);
  const x = m % 60;
  return h ? h + 'h' + (x ? ' ' + x + 'm' : '') : x + 'm';
};

/** "just now", "5 mins ago", "yesterday", "3 days ago". `now` and `t` are epoch ms. */
export const ago = (t: number, now: number): string => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
};

/** Epoch ms -> minutes past local midnight, from a Date's local components. */
export const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();
