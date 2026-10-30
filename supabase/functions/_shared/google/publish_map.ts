/**
 * Pure mapping from an app event to the Google event we publish, and the fingerprint that decides
 * whether a published copy needs patching.
 *
 * The privacy invariant lives here and in publish.ts: nothing that is not a live, public, app-owned
 * event can be turned into a Google payload. `buildGoogleEvent` throws {@link PrivateEventError}
 * for anything else, and every write to Google goes through it.
 */
import { toRRule } from '@calendar/core';
import { APP_EVENT_PROP } from './mapping.ts';
import { localIso, localToUtcMs, shiftDay, utcStamp } from './tz.ts';
import type { AppEvent, GoogleDateTime, SeriesInfo } from './types.ts';

export class PrivateEventError extends Error {
  constructor(eventId: string, why: string) {
    super(`refusing to send event ${eventId} to Google: ${why}`);
    this.name = 'PrivateEventError';
  }
}

/** Throws unless the event may be sent to Google: public, live and created in the app. */
export const assertPublishable = (ev: Pick<AppEvent, 'id' | 'visibility' | 'deleted_at' | 'source'>): void => {
  if (ev.visibility !== 'public') throw new PrivateEventError(ev.id, 'it is not public');
  if (ev.deleted_at) throw new PrivateEventError(ev.id, 'it is deleted');
  if (ev.source !== 'app') throw new PrivateEventError(ev.id, 'it was imported from Google');
};

/**
 * `RRULE` line for a weekly series published as one Google event. Core's `toRRule` writes a date
 * `UNTIL`, which is right for all-day events; for timed events RFC 5545 wants a UTC date-time, so
 * `UNTIL` becomes the end of that last day in the user's zone. An `until` before the first
 * occurrence is dropped (Google rejects such a rule).
 */
export const rruleFor = (series: Pick<SeriesInfo, 'weekdays' | 'until'>, o: { firstDay: string; allDay: boolean; tz: string }): string => {
  const until = series.until && series.until >= o.firstDay ? series.until : null;
  const rule = toRRule({ weekdays: series.weekdays, until });
  if (!until || o.allDay) return rule;
  const endOfDay = localToUtcMs(shiftDay(until, 1), 0, o.tz) - 1000;
  return rule.replace(/;UNTIL=\d{8}$/, ';UNTIL=' + utcStamp(endOfDay));
};

export interface BuildOpts {
  /** the profile's IANA zone (already validated) */
  tz: string;
  /** weekly series: publish as one event with this RRULE line, starting at this event */
  rrule?: string;
}

/** What we send to Google for a published event (the `id` is added by the caller when creating). */
export interface GoogleEventBody {
  summary: string;
  start: GoogleDateTime;
  end: GoogleDateTime;
  recurrence?: string[];
  extendedProperties: { private: Record<string, string> };
}

/** The Google event body for an app event. */
export const buildGoogleEvent = (ev: AppEvent, o: BuildOpts): GoogleEventBody => {
  assertPublishable(ev);
  const body: GoogleEventBody = {
    summary: ev.title,
    start: ev.all_day ? { date: ev.day } : { dateTime: localIso(ev.day, ev.start_min), timeZone: o.tz },
    end: ev.all_day
      ? { date: shiftDay(ev.day, Math.max(1, ev.days)) }
      : { dateTime: localIso(ev.day, ev.end_min), timeZone: o.tz },
    extendedProperties: { private: { [APP_EVENT_PROP]: ev.id } },
  };
  if (o.rrule) body.recurrence = [o.rrule];
  return body;
};

const toHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export const sha256Hex = async (s: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** Hash of everything that is visible on Google: title, times, all-day span, recurrence and zone. */
export const fingerprintOf = (ev: AppEvent, o: BuildOpts): Promise<string> =>
  sha256Hex(JSON.stringify([ev.title, ev.day, ev.start_min, ev.end_min, ev.all_day, ev.all_day ? ev.days : 1, o.rrule ?? null, o.tz]));

/** Google event ids: 5-1024 chars of a-v and 0-9. 32 random hex digits qualify. */
export const newGoogleEventId = (): string => crypto.randomUUID().replace(/-/g, '');
