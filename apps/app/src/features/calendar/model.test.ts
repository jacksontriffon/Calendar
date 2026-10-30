import { dnum, key, type ProtoEvent } from '@calendar/core';

import {
  awayFromToday, blockMetrics, dayLayout, daySegs, goalSummary, hourHeightFor, minBlockH, monthGrid, packAllDay,
  stepFocus, sunStops, titleFor, viewDays, visibleHours,
} from './model';

const ev = (id: string, day: string, start: number, end: number, extra: Partial<ProtoEvent> = {}): ProtoEvent => ({
  id, day, cat: 'Work', title: id, start, end, ...extra,
});
const d = (k: string) => dnum(k);

describe('days and paging', () => {
  it('3-day view is centred on the focus day; week starts on Monday', () => {
    expect(viewDays('day3', d('2026-10-30')).map(key)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
    const w = viewDays('week', d('2026-10-30')).map(key);
    expect(w[0]).toBe('2026-10-26');
    expect(w[6]).toBe('2026-11-01');
    // Sunday belongs to the week that started the Monday before
    expect(viewDays('week', d('2026-11-01'))[0]).toEqual(d('2026-10-26'));
  });

  it('steps 3 days, a week or a month', () => {
    expect(key(stepFocus('day3', d('2026-10-30'), 1))).toBe('2026-11-02');
    expect(key(stepFocus('week', d('2026-10-30'), -1))).toBe('2026-10-23');
    expect(key(stepFocus('month', d('2026-01-31'), 1))).toBe('2026-02-28');
  });

  it('knows when it is away from today', () => {
    const today = d('2026-10-30');
    expect(awayFromToday('day3', today, today)).toBe(false);
    expect(awayFromToday('day3', d('2026-10-31'), today)).toBe(true);
    expect(awayFromToday('week', d('2026-10-27'), today)).toBe(false);
    expect(awayFromToday('month', d('2026-10-01'), today)).toBe(false);
    expect(awayFromToday('month', d('2026-11-01'), today)).toBe(true);
  });

  it('titles the month, or a month range, with the year when not this one', () => {
    const today = d('2026-10-30');
    expect(titleFor(viewDays('day3', today), today)).toBe('October');
    expect(titleFor(viewDays('week', d('2026-10-30')), today)).toBe('Oct – Nov');
    expect(titleFor(viewDays('day3', d('2027-02-10')), today)).toBe('February 2027');
  });

  it('month grid is 6 weeks from the Monday on or before the 1st', () => {
    const g = monthGrid(d('2026-10-15'));
    expect(g).toHaveLength(42);
    expect(key(g[0])).toBe('2026-09-28');
  });
});

describe('scale', () => {
  it('fits the whole day at minimum zoom and scales otherwise', () => {
    expect(hourHeightFor({ zoom: 0.4, week: false, viewportH: 600 })).toBeLessThanOrEqual(32);
    expect(hourHeightFor({ zoom: 1, week: false, viewportH: 600 })).toBe(58);
    expect(hourHeightFor({ zoom: 1, week: true, viewportH: 600 })).toBe(40);
    expect(hourHeightFor({ zoom: 5.2, week: false, viewportH: 600 })).toBe(300);
  });

  it('thins the hour labels when dense', () => {
    expect(visibleHours(58)).toHaveLength(25);
    expect(visibleHours(20)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
    expect(visibleHours(30)).toContain(12);
  });
});

describe('segments and layout', () => {
  it('splits an overnight event into a first and a second part', () => {
    const e = [ev('a', '2026-10-30', 1380, 1500)];
    const s0 = daySegs(e, '2026-10-30', '2026-10-29');
    expect(s0[0]).toMatchObject({ part: 'first', start: 1380, end: 1440, fullEnd: 1500 });
    const s1 = daySegs(e, '2026-10-31', '2026-10-30');
    expect(s1[0]).toMatchObject({ part: 'second', start: 0, end: 60 });
  });

  it('lays overlapping events side by side and reuses an unchanged day', () => {
    const e = [ev('a', '2026-10-30', 540, 600), ev('b', '2026-10-30', 570, 630), ev('c', '2026-10-30', 700, 720)];
    const l = dayLayout(e, '2026-10-30', '2026-10-29');
    const byId = Object.fromEntries(l.map((x) => [x.ev.id, x]));
    expect(byId.a.w).toBe(0.5);
    expect(byId.b.x).toBe(0.5);
    expect(byId.c.w).toBe(1);
    expect(dayLayout([...e], '2026-10-30', '2026-10-29')).toBe(l);
  });
});

describe('all-day band', () => {
  it('packs spanning bars into rows and marks open ends', () => {
    const days = viewDays('week', d('2026-10-30'));
    const evs = [
      ev('wk', '2026-10-26', 0, 1440, { allDay: true, days: 7 }),
      ev('trip', '2026-10-28', 0, 1440, { allDay: true, days: 3 }),
      ev('long', '2026-10-30', 0, 1440, { allDay: true, days: 10 }),
      ev('out', '2026-12-01', 0, 1440, { allDay: true, days: 1 }),
    ];
    const { items, rows } = packAllDay(evs, days);
    expect(items.map((i) => i.ev.id)).toEqual(['wk', 'trip', 'long']);
    expect(rows).toBe(3);
    expect(items[2]).toMatchObject({ i0: 4, i1: 6, openRight: true, openLeft: false });
  });
});

describe('sun shading', () => {
  it('builds ordered stops, and none when sunset is before sunrise', () => {
    const s = sunStops(398, 1163)!;
    expect(s).toHaveLength(8);
    expect(s.map((x) => x.offset)).toEqual([...s.map((x) => x.offset)].sort((a, b) => a - b));
    expect(s[0].opacity).toBeCloseTo(0.34);
    expect(sunStops(1163, 398)).toBeNull();
  });
});

describe('block metrics', () => {
  const base = { h: 60, w: 100, week: false, dense: false, part: 'solo' as const, needsConfirm: false, hasWin: false, isPublic: true };

  it('shows the public glyph only on blocks of 40px or more, never in month view', () => {
    expect(blockMetrics(base).showPublicGlyph).toBe(true);
    expect(blockMetrics({ ...base, h: 39 }).showPublicGlyph).toBe(false);
    expect(blockMetrics({ ...base, month: true }).showPublicGlyph).toBe(false);
    expect(blockMetrics({ ...base, isPublic: false }).showPublicGlyph).toBe(false);
  });

  it('only offers the tick on elapsed, wide and tall enough blocks', () => {
    expect(blockMetrics({ ...base, needsConfirm: true }).showCheck).toBe(true);
    expect(blockMetrics({ ...base, needsConfirm: true, w: 40 }).showCheck).toBe(false);
    expect(blockMetrics({ ...base, needsConfirm: true, h: 16 }).showCheck).toBe(false);
    expect(blockMetrics({ ...base, needsConfirm: true, part: 'first' }).showCheck).toBe(false);
  });

  it('handles resize only on blocks of 26px or more, and not across a midnight split', () => {
    expect(blockMetrics({ ...base, h: 25 }).canResize).toBe(false);
    expect(blockMetrics({ ...base, part: 'first' })).toMatchObject({ canTop: true, canBottom: false });
    expect(blockMetrics({ ...base, part: 'second' })).toMatchObject({ canTop: false, canBottom: true });
    expect(minBlockH(true, false)).toBe(15);
    expect(minBlockH(false, true)).toBe(13);
  });

  it('fits the title lines to the height', () => {
    expect(blockMetrics({ ...base, h: 22 }).titleLines).toBe(1);
    expect(blockMetrics({ ...base, h: 120 }).titleLines).toBeGreaterThan(3);
  });
});

describe('goal summary', () => {
  it('says there are no goals', () => {
    expect(goalSummary([], [], { today: d('2026-10-30'), nowMin: 600 }).text).toMatch(/No goals yet/);
  });

  it('sums hours done over the target and counts goals behind', () => {
    const today = d('2026-10-30');
    const goals = [{ id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: '', hours: 20, start: '2026-10-20', deadline: '2026-11-10', hue: 240 }];
    const events = [ev('s1', '2026-10-28', 540, 660, { cat: 'Deep work', done: true })];
    const r = goalSummary(goals, events, { today, nowMin: 600 });
    expect(r.text).toMatch(/^2\/20h · /);
    expect(r.behind).toBe(1);
  });
});
