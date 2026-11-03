/**
 * Hidden events (CA 1.7, EV 05): "Remove" on someone else's event inserts a `hidden_items` row
 * (`source: 'google'`) and the event drops out of every view. Unhide deletes the row. Pure helpers;
 * the store does the I/O.
 *
 * Google imports repeating events as separate instances (`singleEvents`), each with its own id of the
 * form `<seriesId>_<original start>`. The `external_key` says how much to hide:
 *   `<instance id>`            this event only
 *   `from:<seriesId>:<day>`    this event and every later one (instances on or after `day`)
 *   `series:<seriesId>`        every instance, past and future
 */
import type { ProtoEvent } from '@calendar/core';

import type { HideScope } from '@/lib/hideScope';

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

/** Instance ids end in the original start: `_20261103T170000Z` (timed) or `_20261103` (all day). */
const INSTANCE_ID = /^(.+)_\d{8}(?:T\d{6}Z?)?$/;

/** The series id of a repeating event's instance id, or null for a one-off event. */
export function googleSeriesId(googleEventId: string | null | undefined): string | null {
  const m = googleEventId ? INSTANCE_ID.exec(googleEventId) : null;
  return m ? m[1] : null;
}

/** Whether Remove has a scope to ask about (the event is one instance of a repeating series). */
export const isRepeating = (googleEventId: string | null | undefined): boolean => googleSeriesId(googleEventId) !== null;

/** The `hidden_items.external_key` that removes an imported event with `scope`; `day` is the event's own. */
export function googleHideKey(scope: HideScope, googleEventId: string, day: string): string {
  const series = googleSeriesId(googleEventId);
  if (!series || scope === 'this') return googleEventId;
  return scope === 'all' ? 'series:' + series : 'from:' + series + ':' + day;
}

export interface ParsedGoogleKey {
  scope: HideScope;
  /** the series id (`scope` all / following) or the instance id (`this`) */
  id: string;
  /** following: the first hidden day */
  from?: string;
}

export function parseGoogleHideKey(key: string): ParsedGoogleKey {
  if (key.startsWith('series:')) return { scope: 'all', id: key.slice(7) };
  const m = /^from:(.+):(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? { scope: 'following', id: m[1], from: m[2] } : { scope: 'this', id: key };
}

export const hiddenKeySet = (items: readonly HiddenLike[]): Set<string> => new Set(items.map((h) => hiddenKey(h.source, h.external_key)));

const cutoffCache = new WeakMap<ReadonlySet<string>, ReadonlyMap<string, string>>();

/** series id -> earliest `from:` day in the hidden set (cached per set, so views stay O(1) per event). */
function followingCutoffs(hidden: ReadonlySet<string>): ReadonlyMap<string, string> {
  let out = cutoffCache.get(hidden);
  if (!out) {
    const m = new Map<string, string>();
    const prefix = hiddenKey('google', '');
    hidden.forEach((k) => {
      if (!k.startsWith(prefix)) return;
      const p = parseGoogleHideKey(k.slice(prefix.length));
      if (p.scope === 'following' && p.from && (!m.has(p.id) || p.from < m.get(p.id)!)) m.set(p.id, p.from);
    });
    out = m;
    cutoffCache.set(hidden, out);
  }
  return out;
}

/** True when this imported event has been removed from the view. Own (app) events are never hidden. */
export function isHidden(ev: Pick<ProtoEvent, 'id' | 'source' | 'day'>, meta: Readonly<Record<string, GoogleEventMeta>>, hidden: ReadonlySet<string>): boolean {
  if (ev.source !== 'google' || !hidden.size) return false;
  const gid = meta[ev.id]?.googleEventId;
  if (!gid) return false;
  if (hidden.has(hiddenKey('google', gid))) return true;
  const series = googleSeriesId(gid);
  if (!series) return false;
  if (hidden.has(hiddenKey('google', 'series:' + series))) return true;
  const from = followingCutoffs(hidden).get(series);
  return from !== undefined && ev.day >= from;
}

/**
 * The events minus the hidden ones. Returns the same array when nothing is hidden, so memoised
 * views don't re-render.
 */
export function filterHidden<T extends Pick<ProtoEvent, 'id' | 'source' | 'day'>>(
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
