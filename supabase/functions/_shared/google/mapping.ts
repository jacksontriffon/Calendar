/**
 * Pure mapping from Google's shapes to the app's rows (import direction).
 *
 * Time model: the app stores floating local time (`day`, `start_min`, `end_min`, minutes past the start
 * day's midnight). A Google `dateTime` is converted to wall-clock time in the user's profile zone
 * (`profiles.tz`); the end is expressed relative to the start day's midnight.
 *
 *  - timed event inside one day: `end_min` = its end minute.
 *  - timed event crossing midnight: `end_min` is past 1440 (22:00 -> 02:00 is 1320 -> 1560).
 *  - timed event longer than 24h: clipped to `start_min + 1440` (the database limit); the app shows a
 *    24-hour block from the start. Multi-day timed events are rare; all-day events carry spans properly.
 *  - zero or negative length (bad data, or a reminder-style event): 15 minutes.
 *  - all-day: `all_day = true`, `start_min = 0`, `end_min = 1440`, `days` = the span (Google's `end.date`
 *    is exclusive), at least 1 and at most 366.
 *  - the wall-clock difference is used, not elapsed time, so an event across a DST change keeps the
 *    hours it shows in Google Calendar.
 */
import { dayDiff, parseGoogleDateTime, shiftDay } from './tz.ts';
import type { AccessRole, CalendarRow, GoogleAclRule, GoogleCalendarListEntry, GoogleEvent, ImportedEventRow } from './types.ts';

export const MIN_EVENT_MINUTES = 15;
export const MAX_ALL_DAY_SPAN = 366;

/** Private extended property our published copies carry, so imports can recognise them. */
export const APP_EVENT_PROP = 'aiCalendarEventId';

const lc = (s: string | undefined | null): string => (s || '').trim().toLowerCase();

/** `is_mine`: the account's own email is the event's creator or organizer. */
export const isMine = (item: Pick<GoogleEvent, 'creator' | 'organizer'>, accountEmail: string): boolean => {
  const me = lc(accountEmail);
  return !!me && (lc(item.creator?.email) === me || lc(item.organizer?.email) === me);
};

/** Cancelled events (deletions), and events the account itself declined, are not shown. */
export const isGone = (item: GoogleEvent, accountEmail: string): boolean => {
  if (item.status === 'cancelled') return true;
  const me = lc(accountEmail);
  return !!item.attendees?.some((a) => (a.self || lc(a.email) === me) && a.responseStatus === 'declined');
};

/** Whether an event is one of our own published copies (so importing it would duplicate it). */
export const isOwnCopy = (item: GoogleEvent, ownExternalIds: ReadonlySet<string>): boolean =>
  ownExternalIds.has(item.id)
  || (!!item.recurringEventId && ownExternalIds.has(item.recurringEventId))
  || !!item.extendedProperties?.private?.[APP_EVENT_PROP];

export interface MapCtx {
  /** the profile's IANA zone */
  tz: string;
  accountEmail: string;
}

export type TimeFields = Pick<ImportedEventRow, 'day' | 'start_min' | 'end_min' | 'all_day' | 'days'>;

/** Day/time fields for a Google start/end pair, or null when the event has no usable start. */
export const mapTimes = (item: Pick<GoogleEvent, 'start' | 'end'>, tz: string): TimeFields | null => {
  const { start, end } = item;
  if (!start) return null;

  if (start.date && !start.dateTime) {
    const endDate = end?.date ?? shiftDay(start.date, 1);
    const span = dayDiff(start.date, endDate);
    const days = Math.min(MAX_ALL_DAY_SPAN, Math.max(1, Number.isFinite(span) ? span : 1));
    return { day: start.date, start_min: 0, end_min: 1440, all_day: true, days };
  }

  if (!start.dateTime) return null;
  const s = parseGoogleDateTime(start.dateTime, start.timeZone, tz);
  let len: number;
  if (end?.dateTime) {
    const e = parseGoogleDateTime(end.dateTime, end.timeZone, tz);
    len = dayDiff(s.day, e.day) * 1440 + e.min - s.min;
  } else {
    len = MIN_EVENT_MINUTES;
  }
  if (!(len > 0)) len = MIN_EVENT_MINUTES;
  if (len > 1440) len = 1440;
  return { day: s.day, start_min: s.min, end_min: s.min + len, all_day: false, days: 1 };
};

/**
 * The `events` row for an imported Google event, or null if it should be skipped (no start, or an
 * event type the calendar does not show: working-location markers).
 */
export const mapGoogleEvent = (
  item: GoogleEvent, ctx: MapCtx & { userId: string; calendarId: string },
): ImportedEventRow | null => {
  if (item.eventType === 'workingLocation') return null;
  const t = mapTimes(item, ctx.tz);
  if (!t) return null;
  return {
    user_id: ctx.userId,
    google_calendar_id: ctx.calendarId,
    google_event_id: item.id,
    source: 'google',
    title: item.summary ?? '',
    ...t,
    etag: item.etag ?? null,
    organizer_email: item.organizer?.email ?? item.creator?.email ?? null,
    is_mine: isMine(item, ctx.accountEmail),
    deleted_at: null,
  };
};

/* ------------------------------------------------------------- calendars */

const WRITE_ROLES: readonly AccessRole[] = ['writer', 'owner'];
export const canWrite = (role: AccessRole): boolean => WRITE_ROLES.includes(role);

const ROLES: readonly AccessRole[] = ['freeBusyReader', 'reader', 'writer', 'owner'];
export const normRole = (r: string | undefined): AccessRole => (ROLES.includes(r as AccessRole) ? (r as AccessRole) : 'reader');

/**
 * Whether Google says a calendar is shared with other people. A calendar the account only has reader
 * or writer access to belongs to someone else, so it is shared. An owned calendar is shared when its
 * ACL has a rule for anyone but the account itself (a person, group, domain or the public).
 */
export const isShared = (role: AccessRole, acl: ReadonlyArray<GoogleAclRule> | null, accountEmail: string): boolean => {
  if (role !== 'owner') return true;
  if (!acl) return false;
  const me = lc(accountEmail);
  return acl.some((r) => r.role !== 'none' && !(r.scope?.type === 'user' && lc(r.scope.value) === me));
};

export interface CalendarFields {
  google_id: string;
  name: string;
  color: string | null;
  access_role: AccessRole;
  is_primary: boolean;
  shared: boolean;
}

export const mapCalendarEntry = (
  e: GoogleCalendarListEntry, acl: ReadonlyArray<GoogleAclRule> | null, accountEmail: string,
): CalendarFields => {
  const role = normRole(e.accessRole);
  return {
    google_id: e.id,
    name: e.summaryOverride || e.summary || e.id,
    color: e.backgroundColor ?? null,
    access_role: role,
    is_primary: !!e.primary,
    shared: isShared(role, acl, accountEmail),
  };
};

/** Defaults for a newly discovered calendar: only the primary is shown, and only the primary can be published to. */
export const newCalendarDefaults = (f: CalendarFields): Pick<CalendarRow, 'show_in_app' | 'can_publish'> => ({
  show_in_app: f.is_primary,
  can_publish: f.is_primary && canWrite(f.access_role),
});
