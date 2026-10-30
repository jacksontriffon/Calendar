import { describe, expect, it } from 'vitest';
import {
  SERIES_HORIZON_DAYS, endSeriesFrom, expandSeries, fromRRule, makeIdGen, normWeekdays, occurrenceDays, occursOn, repWords, toRRule, topUpSeries,
} from '../src/index.ts';
import type { ProtoEvent, Series } from '../src/index.ts';
import { TODAY, TODAY_KEY, dd } from './helpers.ts';

// NOTE: recurrence is not in the prototype; these tests pin down the new module's behaviour.
const MWF: Series = { id: 's1', freq: 'weekly', weekdays: [1, 3, 5], startDay: '2026-10-26', until: null }; // Mon Wed Fri from Mon 26 Oct
const tpl = { title: 'Gym', cat: 'Health', start: 420, end: 480 };

describe('weekdays', () => {
  it('normWeekdays sorts, de-duplicates and drops junk', () => {
    expect(normWeekdays([5, 1, 1, 3, 7, -1, 2.5, 0])).toEqual([0, 1, 3, 5]);
    expect(normWeekdays([])).toEqual([]);
  });
});

describe('occursOn / occurrenceDays', () => {
  it('follows the weekdays from the start day', () => {
    expect(occursOn(MWF, '2026-10-26')).toBe(true); // Mon
    expect(occursOn(MWF, '2026-10-27')).toBe(false); // Tue
    expect(occursOn(MWF, '2026-10-30')).toBe(true); // Fri
    expect(occursOn(MWF, '2026-10-24')).toBe(false); // before the start (a Saturday anyway)
    expect(occursOn(MWF, '2026-10-23')).toBe(false); // Friday before the start
  });
  it('honours until (inclusive)', () => {
    const s = { ...MWF, until: '2026-11-04' };
    expect(occursOn(s, '2026-11-04')).toBe(true); // Wed
    expect(occursOn(s, '2026-11-06')).toBe(false);
    expect(occurrenceDays(s, '2026-10-26', '2026-12-31')).toEqual(['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02', '2026-11-04']);
  });
  it('lists days in a range, crossing the month and year', () => {
    expect(occurrenceDays(MWF, '2026-10-26', '2026-11-04')).toEqual(['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02', '2026-11-04']);
    expect(occurrenceDays(MWF, '2026-12-28', '2027-01-04')).toEqual(['2026-12-28', '2026-12-30', '2027-01-01', '2027-01-04']);
  });
  it('a range that starts before the series starts begins at the start day', () => {
    expect(occurrenceDays(MWF, '2026-10-01', '2026-10-28')).toEqual(['2026-10-26', '2026-10-28']);
  });
  it('empty weekdays or an empty range', () => {
    expect(occurrenceDays({ ...MWF, weekdays: [] }, '2026-10-26', '2026-12-01')).toEqual([]);
    expect(occurrenceDays(MWF, '2026-11-05', '2026-11-04')).toEqual([]);
  });
  it('a leap day', () => expect(occurrenceDays({ ...MWF, weekdays: [4], startDay: '2024-01-01' }, '2024-02-27', '2024-03-01')).toEqual(['2024-02-29']));
});

describe('expandSeries', () => {
  it('makes one event per occurrence, tied to the series', () => {
    const evs = expandSeries(MWF, tpl, { from: '2026-10-26', to: '2026-11-01' }, makeIdGen([]));
    expect(evs).toEqual([
      { id: 'e1', day: '2026-10-26', cat: 'Health', title: 'Gym', start: 420, end: 480, seriesId: 's1' },
      { id: 'e2', day: '2026-10-28', cat: 'Health', title: 'Gym', start: 420, end: 480, seriesId: 's1' },
      { id: 'e3', day: '2026-10-30', cat: 'Health', title: 'Gym', start: 420, end: 480, seriesId: 's1' },
    ]);
  });
  it('all-day templates and visibility carry over', () => {
    const evs = expandSeries(MWF, { title: 'Trip', cat: null, start: 5, end: 6, allDay: true, days: 2, visibility: 'public' }, { from: '2026-10-26', to: '2026-10-26' }, makeIdGen([]));
    expect(evs).toEqual([{ id: 'e1', day: '2026-10-26', cat: null, title: 'Trip', start: 0, end: 1440, allDay: true, days: 2, seriesId: 's1', visibility: 'public' }]);
  });
  it('skips days the user removed', () => {
    const evs = expandSeries(MWF, tpl, { from: '2026-10-26', to: '2026-11-01' }, makeIdGen([]), ['2026-10-28']);
    expect(evs.map((e) => e.day)).toEqual(['2026-10-26', '2026-10-30']);
    expect(expandSeries(MWF, tpl, { from: '2026-10-26', to: '2026-11-01' }, makeIdGen([]), new Set(['2026-10-26'])).map((e) => e.day)).toEqual(['2026-10-28', '2026-10-30']);
  });
  it('overnight templates keep end past 1440', () => {
    expect(expandSeries(MWF, { title: 'Sleep', cat: 'Health', start: 1320, end: 1920 }, { from: '2026-10-26', to: '2026-10-26' }, makeIdGen([]))[0]).toMatchObject({ start: 1320, end: 1920 });
  });
});

describe('topUpSeries', () => {
  it('materialises from today to the horizon', () => {
    const evs = topUpSeries(MWF, tpl, [], TODAY, makeIdGen([]));
    expect(evs[0].day).toBe(TODAY_KEY); // Fri 30 Oct is a Friday
    const last = evs[evs.length - 1].day;
    expect(last <= dd(SERIES_HORIZON_DAYS)).toBe(true);
    expect(evs).toHaveLength(25); // Fri today + 8 full weeks of Mon/Wed/Fri up to Fri 25 Dec
  });
  it('is idempotent: existing occurrences are not duplicated', () => {
    const first = topUpSeries(MWF, tpl, [], TODAY, makeIdGen([]), { horizonDays: 14 });
    const again = topUpSeries(MWF, tpl, first, TODAY, makeIdGen(first), { horizonDays: 14 });
    expect(again).toEqual([]);
    const more = topUpSeries(MWF, tpl, first, TODAY, makeIdGen(first), { horizonDays: 21 });
    expect(more.map((e) => e.day)).toEqual(['2026-11-16', '2026-11-18', '2026-11-20'].filter((d) => d <= dd(21)));
  });
  it("only counts the series' own events, and honours skip", () => {
    const other: Pick<ProtoEvent, 'day' | 'seriesId'>[] = [{ day: TODAY_KEY, seriesId: 'other' }];
    expect(topUpSeries(MWF, tpl, other, TODAY, makeIdGen([]), { horizonDays: 7 })[0].day).toBe(TODAY_KEY);
    expect(topUpSeries(MWF, tpl, [], TODAY, makeIdGen([]), { horizonDays: 7, skip: [TODAY_KEY] })[0].day).toBe('2026-11-02');
  });
  it('stops at until', () => {
    const s = { ...MWF, until: '2026-11-02' };
    expect(topUpSeries(s, tpl, [], TODAY, makeIdGen([])).map((e) => e.day)).toEqual([TODAY_KEY, '2026-11-02']);
  });
  it('a series that has not started yet begins at its start day', () => {
    const s = { ...MWF, startDay: '2026-11-09' };
    expect(topUpSeries(s, tpl, [], TODAY, makeIdGen([]), { horizonDays: 14 })[0].day).toBe('2026-11-09');
  });
});

describe('endSeriesFrom (delete this and all future)', () => {
  const events: ProtoEvent[] = expandSeries(MWF, tpl, { from: '2026-10-26', to: '2026-11-13' }, makeIdGen([]));
  it('drops this and later occurrences and ends the series the day before', () => {
    const r = endSeriesFrom(MWF, events, '2026-11-02');
    expect(r.events.map((e) => e.day)).toEqual(['2026-10-26', '2026-10-28', '2026-10-30']);
    expect(r.series).toEqual({ ...MWF, until: '2026-11-01' });
  });
  it('deleting the first occurrence deletes the whole series', () => {
    const r = endSeriesFrom(MWF, events, '2026-10-26');
    expect(r.series).toBeNull();
    expect(r.events).toEqual([]);
  });
  it('leaves other series and one-off events alone', () => {
    const mixed: ProtoEvent[] = [...events, { id: 'x', day: '2026-11-04', cat: 'Work', title: 'One-off', start: 1, end: 2 }, { id: 'y', day: '2026-11-04', cat: 'Work', title: 'Other', start: 1, end: 2, seriesId: 'other' }];
    expect(endSeriesFrom(MWF, mixed, '2026-11-02').events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'x', 'y']);
  });
});

describe('repWords', () => {
  const w = (weekdays: number[], until: string | null = null) => repWords({ weekdays, until });
  it('plain cases', () => {
    expect(w([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(w([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(w([0, 6])).toBe('Weekends');
    expect(w([2])).toBe('Every Tue');
    expect(w([1, 3])).toBe('Every Mon and Wed');
    expect(w([1, 3, 5])).toBe('Every Mon, Wed and Fri');
    expect(w([])).toBe('Never');
  });
  it('weeks are listed Monday first, even with Sunday', () => {
    expect(w([0, 1, 3])).toBe('Every Mon, Wed and Sun');
    expect(w([6, 5])).toBe('Every Fri and Sat');
  });
  it('input order and duplicates do not matter', () => expect(w([5, 1, 3, 3])).toBe('Every Mon, Wed and Fri'));
  it('with an end date', () => {
    expect(w([1, 3, 5], '2026-12-06')).toBe('Every Mon, Wed and Fri until 6 Dec');
    expect(w([1, 2, 3, 4, 5], '2027-01-31')).toBe('Weekdays until 31 Jan');
  });
});

describe('RRULE', () => {
  it('toRRule', () => {
    expect(toRRule({ weekdays: [5, 1, 3], until: null })).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(toRRule({ weekdays: [0, 6], until: '2026-12-06' })).toBe('RRULE:FREQ=WEEKLY;BYDAY=SA,SU;UNTIL=20261206');
  });
  it('fromRRule round-trips and rejects what it cannot represent', () => {
    expect(fromRRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')).toEqual({ weekdays: [1, 3, 5], until: null });
    expect(fromRRule('FREQ=WEEKLY;BYDAY=SA,SU;UNTIL=20261206T000000Z')).toEqual({ weekdays: [0, 6], until: '2026-12-06' });
    expect(fromRRule(toRRule({ weekdays: [2, 4], until: '2027-02-01' }))).toEqual({ weekdays: [2, 4], until: '2027-02-01' });
    expect(fromRRule('RRULE:FREQ=DAILY')).toBeNull();
    expect(fromRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBeNull();
    expect(fromRRule('RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO')).toBeNull();
    expect(fromRRule('RRULE:FREQ=WEEKLY')).toBeNull();
    expect(fromRRule('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU')).toEqual({ weekdays: [2], until: null });
  });
});
