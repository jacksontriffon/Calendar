/**
 * Development-only sample week (the prototype's constructor data), loaded into
 * the store when `__DEV__` and `EXPO_PUBLIC_DEV_SEED=1`. It goes in through
 * `getStore().commit`, so it works with whatever store implementation is
 * installed. It only seeds an empty calendar and never runs in release builds.
 */
import { addDays, defaultCats, key, type CalendarData, type ProtoEvent, type ProtoGoal } from '@calendar/core';

import { getStore } from '@/store';

export function devSeedEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_DEV_SEED === '1';
}

/** The prototype's sample data, relative to `today`, plus a few rows that exercise the EV 04 / EV 05 marks. */
export function sampleData(today: Date, newId: () => string, nowMs = Date.now()): CalendarData {
  const dd = (n: number) => key(addDays(today, n));
  const ev = (day: string, cat: string, title: string, start: number, end: number, extra: Partial<ProtoEvent> = {}): ProtoEvent =>
    ({ id: newId(), day, cat, title, start, end, ...extra });
  const done = { done: true };
  const events: ProtoEvent[] = [
    ev(dd(-17), 'Marathon training', 'Tempo 6k', 1080, 1125, done),
    ev(dd(-16), 'Deep work', 'Sync spec', 540, 720, done),
    ev(dd(-15), 'Deep work', 'Sync spec review', 570, 660, done),
    ev(dd(-14), 'Marathon training', 'Long run', 480, 570, done),
    ev(dd(-12), 'Marathon training', 'Easy 6k', 1050, 1095, done),
    ev(dd(-10), 'Deep work', 'Prototype conflict handling', 540, 750, done),
    ev(dd(-9), 'Deep work', 'Conflict handling, part two', 540, 690, done),
    ev(dd(-8), 'Deep work', 'Tests for the merge path', 780, 900, done),
    ev(dd(-7), 'Marathon training', 'Long run', 480, 590, done),
    ev(dd(-6), 'Deep work', 'Offline queue', 540, 690, done),
    ev(dd(-5), 'Marathon training', 'Intervals', 1080, 1135, done),
    ev(dd(-3), 'Deep work', 'Schema migration', 570, 750, done),
    ev(dd(-3), 'Marathon training', 'Intervals', 1080, 1140, done),
    ev(dd(-3), 'Reading', 'Reading', 1275, 1320, done),
    ev(dd(-2), 'Deep work', 'Migration, part two', 540, 720, done),
    ev(dd(-2), 'Reading', 'Reading', 1260, 1310, done),
    ev(dd(-1), 'Health', 'Morning pages', 450, 480),
    ev(dd(-1), 'Deep work', 'Rewrite the sync layer', 540, 690, done),
    ev(dd(-1), 'Social', 'Lunch with Dan', 750, 795),
    ev(dd(-1), 'Marathon training', 'Easy 8k', 1050, 1110, done),
    ev(dd(-1), 'Reading', 'Reading', 1260, 1305, done),
    ev(dd(0), 'Food', 'Coffee + plan the day', 480, 505),
    ev(dd(0), 'Deep work', 'Sync layer, part two', 540, 690),
    ev(dd(0), 'Pets', 'Dog walk', 1050, 1090),
    ev(dd(1), 'Marathon training', 'Long run', 480, 600),
    ev(dd(1), 'Family', 'Family brunch', 660, 750, { visibility: 'public' }),
    /* extras: overlap, a short block, someone else's event, another calendar, an all-day bar */
    ev(dd(0), 'Work', 'Standup', 570, 585),
    ev(dd(0), 'Work', 'Review with the team', 600, 690, { visibility: 'public' }),
    ev(dd(0), 'Social', 'Lunch with Dan', 750, 810, { source: 'google' }),
    ev(dd(1), 'Social', 'Dinner at Maya’s', 1110, 1200, { isMine: false, source: 'google' }),
    ev(dd(2), 'Work', 'Planning', 600, 660),
    ev(dd(1), 'Family', 'Half term', 0, 1440, { allDay: true, days: 3 }),
    ev(dd(-1), 'Work', 'Offsite', 0, 1440, { allDay: true, days: 2 }),
  ];
  const goal = (id: string, title: string, outcome: string, hours: number, start: number, deadline: number, hue: number): ProtoGoal =>
    ({ id, title, cat: title, outcome, hours, start: dd(start), deadline: dd(deadline), hue, at: nowMs });
  return {
    events,
    cats: Object.assign(defaultCats(), { 'Deep work': 240, 'Marathon training': 125, Reading: 290 }),
    goals: [
      goal('g1', 'Deep work', 'Ship the sync layer rewrite', 70, -20, 25, 240),
      goal('g2', 'Marathon training', 'Run a sub-4 hour marathon', 95, -24, 66, 125),
      goal('g3', 'Reading', 'Finish four books', 14, -4, 13, 290),
    ],
  };
}

/** Load the sample week into an empty store (dev builds with EXPO_PUBLIC_DEV_SEED=1 only). */
export function maybeSeedDev(): void {
  if (!devSeedEnabled()) return;
  const store = getStore();
  const s = store.getState();
  if (s.data.events.length || s.data.goals.length) return;
  const t = new Date();
  store.commit(sampleData(new Date(t.getFullYear(), t.getMonth(), t.getDate()), store.newId), 'Dev seed', 'sync');
}
