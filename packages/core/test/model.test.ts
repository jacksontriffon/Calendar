import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, catIdLookup, catNameLookup, catsToRows, dataSnap, eventSnap, eventToRow, goalToRow, hydrateSaved, makeIdGen, maxEventNum,
  normalizeGoals, rowToEvent, rowToGoal, rowToSeries, rowsToCats, sameSnap, seriesToRow, sunLabels, REGIONS, regionForTz,
} from '../src/index.ts';
import type { CategoryRow, EventRow, GoalRow, ProtoEvent, ProtoGoal, Series } from '../src/index.ts';
import { TODAY, dd, ev, goal } from './helpers.ts';

describe('snapshots', () => {
  it('eventSnap fills defaults and drops transient fields', () => {
    const e: ProtoEvent = { id: 'e1', day: '2026-10-30', cat: 'Work', title: 'T', start: 60, end: 120, at: 123, pauses: [], winAsked: true };
    expect(eventSnap(e)).toEqual({ id: 'e1', day: '2026-10-30', cat: 'Work', title: 'T', start: 60, end: 120, allDay: false, days: 1, done: false, pauses: undefined, win: undefined });
    expect(eventSnap(e, true).winAsked).toBe(true);
  });
  it('dataSnap copies; sameSnap compares by value', () => {
    const d = { events: [ev('e1', '2026-10-30', 'Work', 'T', 60, 120)], cats: { Work: 255 }, goals: [goal({ id: 'g1', title: 'G' })] };
    const s = dataSnap(d);
    expect(sameSnap(s, dataSnap(d))).toBe(true);
    s.cats.Work = 1;
    expect(d.cats.Work).toBe(255);
    expect(sameSnap(s, dataSnap(d))).toBe(false);
  });
});

describe('ids', () => {
  it('maxEventNum reads the numeric part', () => {
    expect(maxEventNum([])).toBe(0);
    expect(maxEventNum([{ id: 'e3' }, { id: 'e41' }, { id: 'x7' }])).toBe(41);
  });
  it('makeIdGen continues after the highest existing id', () => {
    const next = makeIdGen([{ id: 'e5' }, { id: 'e9' }]);
    expect([next(), next()]).toEqual(['e10', 'e11']);
    expect(makeIdGen([], 100)()).toBe('e101');
  });
});

describe('hydrateSaved (loading the aical.v1 blob)', () => {
  it('defaults when nothing is saved', () => {
    const h = hydrateSaved(null, TODAY);
    expect(h.prefs).toEqual(DEFAULT_PREFS);
    expect(h.events).toBeUndefined();
  });
  it('takes only well-formed fields', () => {
    const h = hydrateSaved({ view: 'week', font: 'mono', zoom: 1.3, events: 'nope', cats: {}, sun: { region: 'Tokyo', sunrise: 320, sunset: 1070 } }, TODAY);
    expect(h.prefs.view).toBe('week');
    expect(h.prefs.font).toBe('mono');
    expect(h.prefs.zoom).toBe(1); // snapped to the nearest level
    expect(h.prefs.sun).toEqual({ region: 'Tokyo', sunrise: 320, sunset: 1070 });
    expect(h.events).toBeUndefined();
    expect(h.cats).toBeUndefined();
    expect(hydrateSaved({ view: 'month' }, TODAY).prefs.view).toBe('day3');
    expect(hydrateSaved({ zoom: -1 }, TODAY).prefs.zoom).toBe(1);
    expect(hydrateSaved({ zoom: 99 }, TODAY).prefs.zoom).toBe(5.2);
  });
  it('AI toggles are reconciled', () => {
    expect(hydrateSaved({ ai: { on: false } }, TODAY).prefs.ai).toEqual({ on: false, model: 'offline', ask: true, checkin: true });
    expect(hydrateSaved({ ai: { model: 'offline' } }, TODAY).prefs.ai.on).toBe(false);
    expect(hydrateSaved({ ai: { model: 'sonnet', ask: false, checkin: false } }, TODAY).prefs.ai).toEqual({ on: true, model: 'sonnet', ask: false, checkin: false });
    expect(hydrateSaved({ ai: { model: 'gpt' } }, TODAY).prefs.ai.model).toBe('haiku');
  });
  it('legacy goals get their defaults (scope -> deadline, start today, hue 47)', () => {
    const g = normalizeGoals([{ id: 'g1', title: 'Read', scope: 'week' }, { id: '', title: 'x' }, null, { id: 'g2', title: 'Y', start: '2026-10-01', scope: 'month' }], TODAY);
    expect(g).toHaveLength(2);
    expect(g[0]).toEqual({ id: 'g1', title: 'Read', cat: 'Read', hours: 0, hue: 47, outcome: '', start: '2026-10-30', deadline: '2026-11-05' });
    expect(g[1].deadline).toBe('2026-10-31');
    expect('scope' in g[1]).toBe(false);
  });
});

describe('row mappers', () => {
  const cats: CategoryRow[] = [
    { id: 'c-work', user_id: 'u', name: 'Work', hue: 255, default_visibility: 'private', default_targets: [] },
    { id: 'c-novel', user_id: 'u', name: 'Novel', hue: 125, default_visibility: 'public', default_targets: ['t1'] },
  ];
  const catId = catIdLookup(cats), catName = catNameLookup(cats);

  it('category lookups', () => {
    expect(catId('Work')).toBe('c-work');
    expect(catId('Nope')).toBeNull();
    expect(catId(null)).toBeNull();
    expect(catName('c-novel')).toBe('Novel');
    expect(catName(undefined)).toBeNull();
  });

  it('timed event <-> row', () => {
    const e: ProtoEvent = { id: 'e12', day: '2026-10-30', cat: 'Work', title: 'Standup', start: 570, end: 585, done: true, pauses: [[575, 578]], win: { text: 'Shipped', at: 5 }, winAsked: true };
    const row = eventToRow(e, { userId: 'u', catId, id: 'uuid-1', legacyId: 'e12', updatedAt: '2026-10-30T12:00:00Z' });
    expect(row).toMatchObject({
      id: 'uuid-1', user_id: 'u', title: 'Standup', category_id: 'c-work', day: '2026-10-30', start_min: 570, end_min: 585, all_day: false, days: 1,
      done: true, pauses: [[575, 578]], win: { text: 'Shipped', at: 5 }, series_id: null, visibility: 'private', source: 'app', is_mine: true,
      legacy_id: 'e12', deleted_at: null, win_asked: true,
    });
    const back = rowToEvent(row, catName);
    expect(back).toMatchObject({ id: 'uuid-1', day: '2026-10-30', cat: 'Work', title: 'Standup', start: 570, end: 585, allDay: false, days: 1, done: true, pauses: [[575, 578]], winAsked: true });
    expect(back.win).toEqual({ text: 'Shipped', at: 5 });
  });

  it('all-day events keep 0/1440 and days', () => {
    const e: ProtoEvent = { id: 'e1', day: '2026-11-02', cat: 'Novel', title: 'Trip', start: 0, end: 1440, allDay: true, days: 3 };
    const row = eventToRow(e, { userId: 'u', catId, updatedAt: 'x' });
    expect([row.all_day, row.days, row.start_min, row.end_min, row.id]).toEqual([true, 3, 0, 1440, 'e1']);
    expect(rowToEvent(row, catName)).toMatchObject({ allDay: true, days: 3, start: 0, end: 1440 });
  });

  it('events overnight and visibility/series survive', () => {
    const e: ProtoEvent = { id: 'e1', day: '2026-10-30', cat: null, title: 'Sleep', start: 1320, end: 1920, visibility: 'public', seriesId: 's1', isMine: false, source: 'google' };
    const row = eventToRow(e, { userId: 'u', catId, updatedAt: 'x' });
    expect([row.category_id, row.end_min, row.visibility, row.series_id, row.is_mine, row.source]).toEqual([null, 1920, 'public', 's1', false, 'google']);
    expect(rowToEvent(row, catName)).toMatchObject({ cat: null, end: 1920, visibility: 'public', seriesId: 's1', isMine: false, source: 'google' });
  });

  it('created_at becomes the prototype `at`', () => {
    const row = { ...eventToRow(ev('e1', '2026-10-30', 'Work', 't', 1, 2), { userId: 'u', catId, updatedAt: 'x' }), created_at: '2026-10-30T10:00:00.000Z' } as EventRow;
    expect(rowToEvent(row, catName).at).toBe(Date.parse('2026-10-30T10:00:00.000Z'));
  });

  it('categories <-> rows keep order, hue and any existing editor settings', () => {
    let n = 0;
    const rows = catsToRows({ Work: 255, Novel: 125, Pets: 166 }, 'u', () => 'new-' + ++n, cats);
    expect(rows.map((r) => [r.id, r.name, r.hue, r.default_visibility])).toEqual([['c-work', 'Work', 255, 'private'], ['c-novel', 'Novel', 125, 'public'], ['new-1', 'Pets', 166, 'private']]);
    expect(rows[1].default_targets).toEqual(['t1']);
    expect(rowsToCats(rows)).toEqual({ Work: 255, Novel: 125, Pets: 166 });
  });

  it('goals <-> rows', () => {
    const g: ProtoGoal = { id: 'g1', title: 'Novel', cat: 'Novel', outcome: 'Finish', hours: 40, start: '2026-10-01', deadline: '2026-12-06', hue: 125, at: Date.parse('2026-10-01T09:00:00Z') };
    const row = goalToRow(g, { userId: 'u', catId });
    expect(row).toMatchObject({ id: 'g1', title: 'Novel', outcome: 'Finish', deadline: '2026-12-06', hours: 40, hue: 125, category_id: 'c-novel', start_date: '2026-10-01', created_at: '2026-10-01T09:00:00.000Z' });
    expect(rowToGoal(row as GoalRow, catName)).toEqual(g);
    expect(rowToGoal({ ...row, category_id: null } as GoalRow, catName).cat).toBe('Novel'); // falls back to the title
    expect(goalToRow({ ...g, hours: -3 }, { userId: 'u', catId }).hours).toBe(0);
  });

  it('series <-> rows', () => {
    const s: Series = { id: 's1', freq: 'weekly', weekdays: [1, 3, 5], startDay: dd(0), until: null };
    const row = seriesToRow(s, 'u');
    expect(row).toEqual({ id: 's1', user_id: 'u', freq: 'weekly', weekdays: [1, 3, 5], start_day: dd(0), until: null });
    expect(rowToSeries(row)).toEqual(s);
    expect(row.weekdays).not.toBe(s.weekdays);
  });
});

describe('regions and sun', () => {
  it('regionForTz', () => {
    expect(regionForTz('Europe/London')?.k).toBe('London');
    expect(regionForTz('Nowhere/Land')).toBeNull();
    expect(regionForTz(undefined)).toBeNull();
    expect(REGIONS).toHaveLength(18);
  });
  it('sunLabels', () => expect(sunLabels({ region: 'London', sunrise: 398, sunset: 1163 })).toEqual({ sunrise: '06:38', sunset: '19:23' }));
});
