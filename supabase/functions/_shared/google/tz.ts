/**
 * Time-zone helpers for the Google boundary. The app's times are floating local time (a `YYYY-MM-DD`
 * day plus minutes past midnight); Google's are instants or zoned date-times. Everything here is
 * independent of the runtime's own time zone: day arithmetic is done in UTC, and zone conversion
 * goes through `Intl.DateTimeFormat` with an explicit `timeZone`.
 */

const pad = (n: number): string => (n < 10 ? '0' + n : '' + n);

const parseDay = (day: string): [number, number, number] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) throw new RangeError('bad day key: ' + day);
  return [+m[1], +m[2], +m[3]];
};

/** `YYYY-MM-DD` shifted by `n` calendar days. */
export const shiftDay = (day: string, n: number): string => {
  const [y, m, d] = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
};

/** Whole days from `a` to `b` (`b - a`). */
export const dayDiff = (a: string, b: string): number => {
  const [ay, am, ad] = parseDay(a);
  const [by, bm, bd] = parseDay(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

/** 0 = Sunday .. 6 = Saturday. */
export const weekdayOf = (day: string): number => {
  const [y, m, d] = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** The UTC calendar day of an epoch-ms instant. */
export const utcDay = (ms: number): string => {
  const t = new Date(ms);
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (tz: string): Intl.DateTimeFormat => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
};

/** Whether `tz` is an IANA zone this runtime knows. */
export const isValidTz = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
};

/** `tz` if valid, else 'UTC'. */
export const safeTz = (tz: string | null | undefined): string => (isValidTz(tz) ? tz : 'UTC');

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

const partsAt = (ms: number, tz: string): Parts => {
  const o: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') o[p.type] = +p.value;
  }
  return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
};

/** The wall-clock day and minutes-past-midnight of an instant in `tz` (seconds are dropped). */
export const instantToLocal = (ms: number, tz: string): { day: string; min: number } => {
  const p = partsAt(ms, tz);
  return { day: p.y + '-' + pad(p.mo) + '-' + pad(p.d), min: p.h * 60 + p.mi };
};

/** Offset of `tz` from UTC at an instant, in ms (positive east of UTC). */
export const tzOffsetMs = (ms: number, tz: string): number => {
  const p = partsAt(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
};

/**
 * The instant at which `tz`'s wall clock reads `day` + `min`. For a time inside a spring-forward gap
 * the result is the instant just after the gap; for a repeated autumn hour it is the first one.
 */
export const localToUtcMs = (day: string, min: number, tz: string): number => {
  const [y, m, d] = parseDay(day);
  const wall = Date.UTC(y, m - 1, d, 0, min, 0);
  // The zone's offset a day before and a day after bracket any single transition.
  const before = tzOffsetMs(wall - 86400000, tz);
  const after = tzOffsetMs(wall + 86400000, tz);
  const valid: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const c = wall - off;
    const back = instantToLocal(c, tz);
    if (back.day === day && back.min === min) valid.push(c);
  }
  if (valid.length) return Math.min(...valid);
  return wall - before; // inside a spring-forward gap: the instant just after the gap
};

/** A date-time string with an explicit offset (`Z` or `+hh:mm`). */
export const hasOffset = (dt: string): boolean => /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(dt.slice(10));

/**
 * A Google `dateTime` as the wall-clock day/minute in `tz`. Strings with an offset are instants; a
 * floating string ("2026-10-30T09:00:00") is wall-clock time in `srcTz` (Google's `timeZone` field)
 * and is converted when that differs from `tz`.
 */
export const parseGoogleDateTime = (dt: string, srcTz: string | undefined, tz: string): { day: string; min: number } => {
  if (hasOffset(dt)) {
    const ms = Date.parse(dt);
    if (Number.isNaN(ms)) throw new RangeError('bad dateTime: ' + dt);
    return instantToLocal(ms, tz);
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dt);
  if (!m) throw new RangeError('bad dateTime: ' + dt);
  const wall = { day: m[1], min: +m[2] * 60 + +m[3] };
  const from = isValidTz(srcTz) ? srcTz : tz;
  if (from === tz) return wall;
  return instantToLocal(localToUtcMs(wall.day, wall.min, from), tz);
};

/** `2026-10-30T09:00:00` for a day + minutes; minutes of 1440 or more roll into the next days. */
export const localIso = (day: string, min: number): string => {
  const d = shiftDay(day, Math.floor(min / 1440));
  const mm = ((min % 1440) + 1440) % 1440;
  return d + 'T' + pad(Math.floor(mm / 60)) + ':' + pad(mm % 60) + ':00';
};

/** Compact UTC date-time for RRULE `UNTIL`: `20261207T045959Z`. */
export const utcStamp = (ms: number): string => {
  const t = new Date(ms);
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + 'T' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + 'Z';
};
