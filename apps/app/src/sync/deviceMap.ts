/**
 * Pure mapping for the phone-calendar bridge: OS calendars and events -> the app's shapes, our events
 * -> what gets written to the phone, duplicate hiding, fingerprints. No React, no native modules,
 * no clock.
 */
import { addDays, dnum, hexToOklab, key as dayKey, type ProtoEvent } from '@calendar/core';

import { calendarKey, digest, hiddenKey, itemId } from './deviceHash';
import type {
  DeviceCalendarFlags,
  DeviceCalendarInfo,
  DeviceEvent,
  DeviceEventWrite,
  DevicePlatform,
  GoogleCalendarRef,
  RawCalendar,
  RawEvent,
} from './deviceTypes';

/** Words in the notes of an event WE wrote to a phone calendar; reading skips such events so they don't show twice. */
export const OWN_COPY_MARKER = 'calendar-app:';

/** Rolling read window around today, in days. */
export const WINDOW_BACK_DAYS = 14;
export const WINDOW_AHEAD_DAYS = 60;
/** The window never grows past this many days either side of today, however far the user scrolls. */
export const WINDOW_MAX_DAYS = 400;

export const DEFAULT_FLAGS: DeviceCalendarFlags = { showInApp: true, canPublish: false };

/* ---------- calendars ---------- */

const norm = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase();

/**
 * Phone calendars with their keys and device-local flags. Two calendars with the same account and
 * name get different keys (numbered by OS id, so the numbering is stable).
 */
export function buildCalendars(raw: readonly RawCalendar[], flags: Readonly<Record<string, DeviceCalendarFlags>>): DeviceCalendarInfo[] {
  const seen = new Map<string, number>();
  const nth = new Map<string, number>();
  [...raw].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((c) => {
    const base = norm(c.account) + '|' + norm(c.title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    nth.set(c.id, n);
  });
  return raw.map((c) => {
    const key = calendarKey(c.account, c.title, nth.get(c.id) ?? 0);
    const readOnly = !c.allowsModifications;
    const f = flags[key] ?? DEFAULT_FLAGS;
    return {
      key,
      id: c.id,
      name: c.title || 'Calendar',
      color: c.color,
      account: c.account || 'On this phone',
      readOnly,
      showInApp: f.showInApp,
      canPublish: !readOnly && f.canPublish,
    };
  });
}

/**
 * CA 4.5: phone calendars that duplicate a connected Google calendar. Matched on the account (the
 * phone's account name or, for Google's own primary calendar, its title, against the connected
 * Google account's email) and on the calendar name. Returns their keys and the Google accounts that
 * caused it, for the "already connected" note.
 */
export function findDuplicates(
  cals: readonly (DeviceCalendarInfo & { internalName?: string | null })[],
  google: readonly GoogleCalendarRef[],
): { keys: Set<string>; accounts: string[] } {
  const keys = new Set<string>();
  const accounts = new Set<string>();
  cals.forEach((c) => {
    const names = [norm(c.name), norm(c.internalName)].filter(Boolean);
    const acct = norm(c.account);
    for (const g of google) {
      const email = norm(g.accountEmail);
      if (!email) continue;
      const accountMatch = acct === email || names.includes(email);
      if (!accountMatch) continue;
      const nameMatch = names.includes(norm(g.name)) || names.includes(email);
      if (nameMatch) {
        keys.add(c.key);
        accounts.add(g.accountEmail);
        break;
      }
    }
  });
  return { keys, accounts: [...accounts] };
}

/* ---------- colours ---------- */

/** Hue (degrees, OKLCH) of a `#rrggbb` colour, for the calendar's colour swatch (`paint` snaps it to the palette). */
export function hueOfColor(hex: string | null | undefined): number {
  if (!hex || !/^#?[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(hex.trim())) return 30;
  const h = hex.trim().replace('#', '');
  const six = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [, a, b] = hexToOklab('#' + six);
  const deg = (Math.atan2(b, a) * 180) / Math.PI;
  return Math.round((deg + 360) % 360);
}

/* ---------- reading ---------- */

const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));
const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
const ymdUtc = (d: Date): string => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const localIndex = (d: Date): number => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
const utcIndex = (d: Date): number => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);

/** Whether `raw` is a copy of one of OUR events (written by `toWrite`), here or on another device. */
export const isOwnCopy = (raw: Pick<RawEvent, 'notes'>): boolean => String(raw.notes ?? '').includes(OWN_COPY_MARKER);

/**
 * One OS event -> the read-only item the calendar view shows. Floating local time: the day and the
 * minutes are the phone's wall clock, whatever zone the event was made in. All-day events are spans
 * of days (Android stores them as UTC midnights, iOS as local ones). Anything longer than a day
 * becomes an all-day span, since the app's events run at most 24 hours.
 */
export function mapEvent(raw: RawEvent, cal: DeviceCalendarInfo, platform: DevicePlatform, ownerAccount?: string | null): DeviceEvent | null {
  const s = toDate(raw.startDate);
  const e = toDate(raw.endDate);
  if (Number.isNaN(s.getTime())) return null;
  const end = Number.isNaN(e.getTime()) || e.getTime() < s.getTime() ? s : e;

  let day: string;
  let start = 0;
  let endMin = 1440;
  let allDay = raw.allDay;
  let days = 1;

  if (raw.allDay) {
    const utc = platform === 'android';
    // End is exclusive on Android (next midnight) and inclusive-ish on iOS (23:59:59); stepping back a second handles both.
    const last = end.getTime() > s.getTime() ? new Date(end.getTime() - 1000) : s;
    day = utc ? ymdUtc(s) : dayKey(s);
    days = Math.max(1, (utc ? utcIndex(last) - utcIndex(s) : localIndex(last) - localIndex(s)) + 1);
  } else {
    day = dayKey(s);
    start = s.getHours() * 60 + s.getMinutes();
    const dd = localIndex(end) - localIndex(s);
    endMin = dd * 1440 + end.getHours() * 60 + end.getMinutes();
    if (endMin <= start) endMin = start + 15;
    if (endMin > start + 1440) {
      // Longer than a day: show it as the days it touches.
      allDay = true;
      days = Math.max(1, dd + (end.getHours() * 60 + end.getMinutes() === 0 ? 0 : 1));
      start = 0;
      endMin = 1440;
    }
  }
  days = Math.min(60, days);

  const mineByOrganizer =
    raw.organizerIsCurrentUser === false
      ? false
      : raw.organizerEmail && ownerAccount
        ? norm(raw.organizerEmail) === norm(ownerAccount)
        : true;

  return {
    id: itemId(cal.id, raw.id, s.toISOString()),
    hiddenKey: hiddenKey(cal.id, raw.id),
    calendarKey: cal.key,
    calendarName: cal.name,
    color: cal.color,
    account: cal.account,
    title: (raw.title || '').trim() || '(No title)',
    day,
    start,
    end: endMin,
    allDay,
    days: allDay ? days : 1,
    isMine: !cal.readOnly && mineByOrganizer,
    readOnlyCalendar: cal.readOnly,
    location: raw.location ? String(raw.location) : null,
  };
}

/** The category name a phone event carries in the calendar view; the view resolves its colour through `deviceCats`. */
export const deviceCatName = (calendarKeyValue: string): string => 'phone:' + calendarKeyValue;

/** Category map entries (name -> hue) for the phone calendars, so blocks take their calendar's colour. */
export function deviceCats(cals: readonly DeviceCalendarInfo[]): Record<string, number> {
  const out: Record<string, number> = {};
  cals.forEach((c) => {
    out[deviceCatName(c.key)] = hueOfColor(c.color);
  });
  return out;
}

/** The calendar view's event for a phone event: read-only, `source: 'device'`, floating local time. */
export function toProtoEvent(d: DeviceEvent): ProtoEvent {
  const out: ProtoEvent = {
    id: d.id,
    day: d.day,
    cat: deviceCatName(d.calendarKey),
    title: d.title,
    start: d.start,
    end: d.end,
    source: 'device',
    isMine: d.isMine,
  };
  if (d.allDay) {
    out.allDay = true;
    out.days = d.days;
  }
  return out;
}

/* ---------- the rolling window ---------- */

export interface ReadWindow {
  from: Date;
  to: Date;
}

/** Today -14 days to today +60 days (local midnights), widened to cover `extra` (the part of the calendar being looked at). */
export function windowFor(today: Date, extra?: ReadWindow | null): ReadWindow {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let from = addDays(t0, -WINDOW_BACK_DAYS);
  let to = addDays(t0, WINDOW_AHEAD_DAYS);
  if (extra) {
    if (extra.from < from) from = extra.from;
    if (extra.to > to) to = extra.to;
  }
  const minFrom = addDays(t0, -WINDOW_MAX_DAYS);
  const maxTo = addDays(t0, WINDOW_MAX_DAYS);
  return { from: from < minFrom ? minFrom : from, to: to > maxTo ? maxTo : to };
}

export const sameWindow = (a: ReadWindow, b: ReadWindow): boolean => a.from.getTime() === b.from.getTime() && a.to.getTime() === b.to.getTime();

/* ---------- publishing ---------- */

/** Only our own, public events go to a phone calendar (never Google imports, never someone else's). */
export const isPublishable = (e: Pick<ProtoEvent, 'visibility' | 'source' | 'isMine'>): boolean =>
  e.visibility === 'public' && (e.source === undefined || e.source === 'app') && e.isMine !== false;

/** Change detection for a published event: everything that is written to the phone. */
export const fingerprintOf = (e: Pick<ProtoEvent, 'title' | 'day' | 'start' | 'end' | 'allDay' | 'days'>): string =>
  digest('fp', JSON.stringify([e.title, e.day, e.start, e.end, !!e.allDay, e.allDay ? e.days ?? 1 : 1])).slice(0, 24);

/** What gets written to the OS for one of our events. */
export function toWrite(e: ProtoEvent, platform: DevicePlatform, timeZone: string): DeviceEventWrite {
  const d0 = dnum(e.day);
  const y = d0.getFullYear();
  const m = d0.getMonth();
  const d = d0.getDate();
  const notes = 'Added by Calendar\n' + OWN_COPY_MARKER + e.id;
  if (e.allDay) {
    const n = Math.max(1, Math.min(60, Math.round(e.days || 1)));
    if (platform === 'android') {
      return { title: e.title, allDay: true, timeZone: 'UTC', notes, startDate: new Date(Date.UTC(y, m, d)), endDate: new Date(Date.UTC(y, m, d + n)) };
    }
    return { title: e.title, allDay: true, timeZone, notes, startDate: new Date(y, m, d), endDate: new Date(y, m, d + n, 0, 0, -1) };
  }
  return {
    title: e.title,
    allDay: false,
    timeZone,
    notes,
    startDate: new Date(y, m, d, 0, e.start),
    endDate: new Date(y, m, d, 0, e.end),
  };
}

/** `${eventId}|${calendarKey}` */
export const targetKey = (eventId: string, calKey: string): string => eventId + '|' + calKey;

export const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
