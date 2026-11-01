/** Test data: the Design Spec sample day, Fri 30 Oct 2026, 11:48. */
import { DEFAULT_PREFS, type CalendarData, type ProtoEvent, type ProtoGoal } from '@calendar/core';

import { buildSnapshot } from './snapshot';
import type { WidgetSnapshot } from './types';

export const NOW = new Date(2026, 9, 30, 11, 48, 0);

export const cats = { 'Deep work': 240, 'Marathon training': 125, Reading: 290, Food: 60, Pets: 170, Family: 28 };

export const goals: ProtoGoal[] = [
  { id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: '', hours: 40, start: '2026-10-06', deadline: '2026-11-27', hue: 240 },
  { id: 'g2', title: 'Marathon training', cat: 'Marathon training', outcome: '', hours: 95, start: '2026-10-06', deadline: '2027-01-04', hue: 125 },
  { id: 'g3', title: 'Reading', cat: 'Reading', outcome: '', hours: 12, start: '2026-10-20', deadline: '2026-11-12', hue: 290 },
];

const ev = (id: string, day: string, cat: string | null, title: string, start: number, end: number, extra: Partial<ProtoEvent> = {}): ProtoEvent => ({
  id, day, cat, title, start, end, ...extra,
});

export const events: ProtoEvent[] = [
  ev('e1', '2026-10-30', 'Deep work', 'Sync layer, part two', 540, 690, { done: true }),
  ev('e3', '2026-10-30', 'Food', 'Lunch', 750, 795, { visibility: 'public' }),
  ev('e4', '2026-10-30', 'Deep work', 'Review offline queue PR', 840, 870),
  ev('e5', '2026-10-30', 'Food', 'Order dog food', 960, 975),
  ev('e6', '2026-10-30', 'Pets', 'Dog walk', 1050, 1090),
  ev('e7', '2026-10-30', 'Marathon training', 'Easy 6k', 1110, 1170),
  ev('e8', '2026-10-30', 'Reading', 'Reading', 1260, 1305),
  ev('t1', '2026-10-31', 'Marathon training', 'Long run', 480, 600),
  ev('t2', '2026-10-31', 'Family', 'Family brunch', 660, 750),
  ev('old', '2026-10-28', 'Food', 'Too old', 600, 660),
  ev('far', '2026-11-20', 'Food', 'Too far', 600, 660),
  ev('allday', '2026-10-30', 'Family', 'Holiday', 0, 1440, { allDay: true }),
];

/** Someone else's Google event, for the initials and no-check cases. */
export const dinner: ProtoEvent = ev('e9', '2026-10-30', 'Family', 'Dinner at Maya’s parents', 1140, 1260, { isMine: false, source: 'google', visibility: 'public' });

export const dataWithDinner: CalendarData = { events: [...events, dinner], cats, goals };

export const data: CalendarData = { events, cats, goals };

/**
 * The extra days the Large carousel shows (WG 1h, 1i): Thu 29 with three goal sessions, two of them
 * done ("2 of 3 done"), and Sat 31 filled out to 4h 55m. Invented, like the sample days in the spec.
 */
export const extraDays: ProtoEvent[] = [
  ev('y1', '2026-10-29', 'Deep work', 'Sync layer, part one', 540, 690, { done: true }),
  ev('y2', '2026-10-29', 'Food', 'Lunch', 750, 795),
  ev('y3', '2026-10-29', 'Marathon training', 'Easy 5k', 1110, 1170, { done: true }),
  ev('y4', '2026-10-29', 'Reading', 'Reading', 1260, 1305),
  ev('t3', '2026-10-31', 'Pets', 'Dog walk', 1050, 1090),
  ev('t4', '2026-10-31', 'Reading', 'Reading', 1260, 1305),
];

export const dataWide: CalendarData = { events: [...events, ...extraDays], cats, goals };

export const user = { id: 'u_8f3c', name: 'Sam' };

export function snapshotAt(now: Date = NOW, over: Partial<{ data: CalendarData; clock: '12h' | '24h'; hidePrivate: boolean }> = {}): WidgetSnapshot {
  const s = buildSnapshot({ data: over.data ?? data, prefs: DEFAULT_PREFS, user, now, clock: over.clock ?? '12h', hidePrivate: over.hidePrivate });
  if (!s) throw new Error('no snapshot');
  return s;
}
