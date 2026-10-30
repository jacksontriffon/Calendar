/**
 * What the calendar view layers on top of the synced events, read-only and keyed by event id so the
 * sync layer needn't carry it:
 *
 *  - hidden events (Remove on someone else's event) are filtered out of every view;
 *  - imported Google events have no category (open question 4, chosen default) and are painted in
 *    their Google calendar's colour;
 *  - block marks (EV 04): the "on another calendar" dot in that colour, the owner's initials on
 *    someone else's event, and the public glyph's state with its target count.
 */
import type { CalendarData, Paint, ProtoEvent } from '@calendar/core';
import type { EventTarget } from '@calendar/db';
import { useCallback, useMemo } from 'react';

import { paintFromHex } from './colors';
import { useCalendarsSelector, useHiddenKeySet, useStoreSlice } from './data';
import { filterHidden } from './hidden';
import { NO_OVERLAY, deriveOverlay, type EventOverlay } from './overlayModel';
import type { CalendarsState } from './store';

export { NO_OVERLAY, deriveOverlay, type EventOverlay, type GlyphState } from './overlayModel';

/* ---------------- hooks ---------------- */

const byEvent = new WeakMap<EventTarget[], Map<string, EventTarget[]>>();
function indexTargets(list: EventTarget[]): Map<string, EventTarget[]> {
  let m = byEvent.get(list);
  if (!m) {
    m = new Map();
    list.forEach((t) => {
      const a = m!.get(t.event_id);
      if (a) a.push(t);
      else m!.set(t.event_id, [t]);
    });
    byEvent.set(list, m);
  }
  return m;
}

/** The calendar data with hidden events removed (use it in place of `useCalendarData()` in views). */
export function useVisibleData(data: CalendarData): CalendarData {
  const meta = useCalendarsSelector((s: CalendarsState) => s.meta);
  const hidden = useHiddenKeySet();
  return useMemo(() => {
    const events = filterHidden(data.events, meta, hidden);
    return events === data.events ? data : { ...data, events: events as ProtoEvent[] };
  }, [data, meta, hidden]);
}

/**
 * Marks and colours for one event block. Cheap for the app's own events (no lookups). Doesn't load
 * the data itself: `useVisibleData` (once, in the screen) does.
 */
export function useEventOverlay(ev: ProtoEvent): EventOverlay {
  const id = ev.id;
  const needs = ev.source === 'google' || ev.isMine === false || ev.visibility === 'public';
  const meta = useStoreSlice((s: CalendarsState) => (needs ? s.meta[id] ?? null : null));
  const calendars = useStoreSlice((s: CalendarsState) => s.calendars);
  const targets = useStoreSlice((s: CalendarsState) => (needs ? indexTargets(s.targets).get(id) : undefined));
  const op = useStoreSlice((s: CalendarsState) => (needs ? s.ops[id] ?? null : null));
  return useMemo(
    () => (needs ? deriveOverlay(ev, meta, calendars, targets, op) : NO_OVERLAY),
    [needs, ev, meta, calendars, targets, op],
  );
}

/** A function giving an event its imported-calendar colours (null = its category's), for list-style views. */
export function usePaintResolver(): (ev: Pick<ProtoEvent, 'id' | 'source' | 'cat'>) => Paint | null {
  const meta = useCalendarsSelector((s: CalendarsState) => s.meta);
  const calendars = useCalendarsSelector((s: CalendarsState) => s.calendars);
  return useCallback(
    (ev) => {
      if (ev.source !== 'google' || ev.cat) return null;
      const cal = calendars.find((c) => c.id === meta[ev.id]?.calendarId);
      return paintFromHex(cal?.color);
    },
    [meta, calendars],
  );
}
