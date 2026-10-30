/**
 * Hidden events (CA 1.7, EV 05): "Remove" on someone else's event inserts a `hidden_items` row
 * (`source: 'google'`, `external_key` = the Google event id) and the event drops out of every view.
 * Unhide deletes the row. Pure helpers; the store does the I/O.
 */
import type { ProtoEvent } from '@calendar/core';

/** What the store knows about an imported event that `ProtoEvent` doesn't carry (read-only, keyed by event id). */
export interface GoogleEventMeta {
  calendarId: string | null;
  googleEventId: string | null;
  organizerEmail: string | null;
}

export interface HiddenLike {
  source: string;
  external_key: string;
}

export const hiddenKey = (source: string, externalKey: string): string => source + ':' + externalKey;

export const hiddenKeySet = (items: ReadonlyArray<HiddenLike>): Set<string> => new Set(items.map((h) => hiddenKey(h.source, h.external_key)));

/** True when this imported event has been removed from the view. Own (app) events are never hidden. */
export function isHidden(ev: Pick<ProtoEvent, 'id' | 'source'>, meta: Readonly<Record<string, GoogleEventMeta>>, hidden: ReadonlySet<string>): boolean {
  if (ev.source !== 'google' || !hidden.size) return false;
  const gid = meta[ev.id]?.googleEventId;
  return !!gid && hidden.has(hiddenKey('google', gid));
}

/**
 * The events minus the hidden ones. Returns the same array when nothing is hidden, so memoised
 * views don't re-render.
 */
export function filterHidden<T extends Pick<ProtoEvent, 'id' | 'source'>>(
  events: readonly T[],
  meta: Readonly<Record<string, GoogleEventMeta>>,
  hidden: ReadonlySet<string>,
): readonly T[] {
  if (!hidden.size) return events;
  let dropped = false;
  const out = events.filter((e) => {
    const h = isHidden(e, meta, hidden);
    if (h) dropped = true;
    return !h;
  });
  return dropped ? out : events;
}
