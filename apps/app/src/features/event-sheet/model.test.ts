import { defaultCats, dnum, renameCat, type CalendarData, type ProtoEvent } from '@calendar/core';

import {
  allDayLabel, allDayRange, applyDraft, commitDraft, emptyDraft, isDirty, repeatLabel, retimePatch, seriesCount, sheetLabel,
} from './model';

const ev = (id: string, day: string, extra: Partial<ProtoEvent> = {}): ProtoEvent => ({
  id, day, cat: 'Work', title: 'Standup', start: 570, end: 600, ...extra,
});
const data = (events: ProtoEvent[]): CalendarData => ({ events, cats: defaultCats(), goals: [] });

describe('draft', () => {
  it('applies category edits first, then the event patch', () => {
    const d = data([ev('a', '2026-10-30')]);
    const draft = { patch: { title: 'Sync' }, catOps: [(x: CalendarData) => renameCat(x, 'Work', 'Job')] };
    const out = applyDraft(d, 'a', draft);
    expect(out.events[0]).toMatchObject({ title: 'Sync', cat: 'Job' });
    expect(Object.keys(out.cats)).toContain('Job');
    expect(isDirty(draft)).toBe(true);
    expect(isDirty(emptyDraft())).toBe(false);
  });

  it('a visibility change covers this and all future events of a series', () => {
    const d = data([
      ev('a', '2026-10-26', { seriesId: 's' }),
      ev('b', '2026-10-30', { seriesId: 's' }),
      ev('c', '2026-11-06', { seriesId: 's' }),
      ev('x', '2026-11-06', { seriesId: 'other' }),
    ]);
    const out = commitDraft(d, 'b', { patch: { visibility: 'public' }, catOps: [] });
    const vis = Object.fromEntries(out.events.map((e) => [e.id, e.visibility]));
    expect(vis).toEqual({ a: undefined, b: 'public', c: 'public', x: undefined });
  });

  it('labels the session like the prototype', () => {
    const d = data([ev('a', '2026-10-30')]);
    const label = (patch: Partial<ProtoEvent>) => {
      const draft = { patch, catOps: [] };
      return sheetLabel(d, applyDraft(d, 'a', draft), 'a', draft);
    };
    expect(label({ done: true })).toBe('Done · Standup');
    expect(label({ done: false })).toBe('Unchecked · Standup');
    expect(label({ visibility: 'public' })).toBe('Made public · Standup');
    expect(label({ title: 'Sync' })).toBe('Renamed · Sync');
    expect(label({ cat: 'Food' })).toBe('Standup → Food');
    expect(label({ start: 600, end: 660 })).toBe('Retimed · Standup');
  });
});

describe('time fields', () => {
  it('turns typed times into start / end patches', () => {
    const e = ev('a', '2026-10-30');
    expect(retimePatch(e, 'start', '9:15')).toEqual({ start: 555, end: 600 });
    expect(retimePatch(e, 'end', '9pm')).toEqual({ end: 1260 });
    expect(retimePatch(e, 'end', 'nonsense')).toBeNull();
    // an end at or before the start means the next day
    expect(retimePatch(e, 'end', '9:00')).toEqual({ end: 540 + 1440 });
  });
});

describe('repeat and all-day', () => {
  it('describes the repeat from the series events', () => {
    const e = [
      ev('a', '2026-10-27', { seriesId: 's' }), // Tue
      ev('b', '2026-10-29', { seriesId: 's' }), // Thu
      ev('c', '2026-11-03', { seriesId: 's' }), // Tue
    ];
    expect(repeatLabel(e, e[0])).toBe('Every Tue and Thu');
    expect(seriesCount(e, e[0])).toBe(3);
    expect(repeatLabel(e, ev('z', '2026-10-30'))).toBeNull();
  });

  it('labels all-day spans', () => {
    expect(allDayLabel(1)).toBe('All day');
    expect(allDayLabel(7)).toBe('All week');
    expect(allDayLabel(3)).toBe('All day · 3 days');
    expect(allDayRange({ day: '2026-10-30', days: 3 })).toBe('Oct 30 – Nov 1');
    expect(allDayRange({ day: '2026-10-30', days: 1 })).toBe('Friday, Oct 30');
    expect(dnum('2026-10-30').getDay()).toBe(5);
  });
});
