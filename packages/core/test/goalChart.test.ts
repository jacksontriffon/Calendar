import { describe, expect, it } from 'vitest';
import {
  addDays, barPx, chartGrid, deadlineDot, dnum, estimateTextWidth, gapPx, goalChartModel, key, paceLine, placeEndLabels, sortGoals,
  timeToX, weekKey, xToTime,
} from '../src/index.ts';
import type { ChartUnit, EndDotInput, ProtoEvent } from '../src/index.ts';
import { NOW_MS, TODAY, dd, ev, goal, nowCtx } from './helpers.ts';

const ctx = nowCtx();
const done = (id: string, day: string, cat: string, mins = 60, over: Partial<ProtoEvent> = {}) =>
  ev(id, day, cat, cat + ' session', 540, 540 + mins, { done: true, ...over });

describe('buckets', () => {
  it('weeks start on the same Monday as weekKey, with a screenful at least', () => {
    const m = goalChartModel([], [], ctx, 'week');
    m.buckets.forEach((b) => expect(key(b.a)).toBe(weekKey(b.a)));
    expect(m.buckets.length).toBeGreaterThanOrEqual(8);
    expect(m.buckets.filter((b) => b.isNow).length).toBe(1);
    expect(key(m.buckets[m.nowIndex].a)).toBe('2026-10-26');
  });

  it('days start the day before today at the earliest and today is a bucket', () => {
    const m = goalChartModel([], [], ctx, 'day');
    expect(key(m.buckets[0].a)).toBe(dd(-1));
    expect(key(m.buckets[m.nowIndex].a)).toBe(dd(0));
    expect(m.buckets.length).toBeGreaterThanOrEqual(7);
    expect(m.scrollTo).toBe(0);
  });

  it('covers one bucket before the earliest start to one after the latest deadline', () => {
    const g = goal({ id: 'g', title: 'G', start: '2026-09-01', deadline: '2026-12-20' });
    const m = goalChartModel([g], [], ctx, 'week');
    expect(key(m.buckets[0].a)).toBe('2026-08-24'); // week of 1 Sep is Mon 31 Aug, one before
    const last = m.buckets[m.buckets.length - 1];
    expect(last.a.getTime()).toBeGreaterThan(dnum('2026-12-20').getTime());
    expect(last.a.getTime()).toBeLessThanOrEqual(dnum('2026-12-28').getTime());
  });

  it('scrolls so the current bucket is the third column when history exists', () => {
    const g = goal({ id: 'g', title: 'G', start: '2026-08-01', deadline: '2026-12-20' });
    const m = goalChartModel([g], [], ctx, 'week');
    expect(m.nowIndex - m.scrollTo).toBe(2);
  });

  it('months: first of the month, crossing a year boundary, labels carry the year', () => {
    const g = goal({ id: 'g', title: 'G', start: '2026-10-20', deadline: '2027-03-10' });
    const m = goalChartModel([g], [], ctx, 'month');
    expect(key(m.buckets[0].a)).toBe('2026-09-01');
    expect(m.buckets.map((b) => b.label).slice(0, 6)).toEqual(["Sep '26", 'Oct', 'Nov', 'Dec', "Jan '27", 'Feb']);
    expect(m.buckets[m.buckets.length - 1].a.getMonth()).toBe(3); // April, one after March
    m.buckets.forEach((b) => expect(b.a.getDate()).toBe(1));
  });

  it('months: February in a leap year is 29 days', () => {
    const g = goal({ id: 'g', title: 'G', start: '2027-12-15', deadline: '2028-03-31' });
    const m = goalChartModel([g], [], nowCtx({ today: new Date(2027, 11, 20) }), 'month');
    const feb = m.buckets.find((b) => b.a.getMonth() === 1 && b.a.getFullYear() === 2028)!;
    expect(Math.round((feb.b.getTime() - feb.a.getTime()) / 86400000)).toBe(29);
  });

  it('day and week labels', () => {
    const g = goal({ id: 'g', title: 'G', start: '2026-10-28', deadline: '2026-11-10' });
    const d = goalChartModel([g], [], ctx, 'day');
    expect(d.buckets[0].label).toBe('27 Oct');
    expect(d.buckets.find((b) => key(b.a) === '2026-11-01')!.label).toBe('1 Nov');
    expect(d.buckets.find((b) => key(b.a) === '2026-10-31')!.label).toBe('S');
    const w = goalChartModel([g], [], ctx, 'week');
    expect(w.buckets[0].label).toBe('19 Oct');
    expect(w.buckets.find((b) => key(b.a) === '2026-11-02')!.label).toBe('2 Nov');
    expect(w.buckets.find((b) => key(b.a) === '2026-11-09')!.label).toBe('9');
  });

  it('caps the range', () => {
    const g = goal({ id: 'g', title: 'G', start: '2020-01-01', deadline: '2040-01-01' });
    expect(goalChartModel([g], [], ctx, 'day').buckets.length).toBe(400);
    expect(goalChartModel([g], [], ctx, 'week').buckets.length).toBe(160);
    expect(goalChartModel([g], [], ctx, 'month').buckets.length).toBe(60);
  });

  it('a DST change does not shift day or week buckets off midnight', () => {
    // clocks change on 1 Nov 2026 in the US, 25 Oct in the EU: buckets are built by calendar days
    const m = goalChartModel([goal({ id: 'g', title: 'G', start: '2026-10-20', deadline: '2026-11-20' })], [], ctx, 'day');
    m.buckets.forEach((b) => { expect(b.a.getHours()).toBe(0); expect(b.b.getHours()).toBe(0); });
    const w = goalChartModel([goal({ id: 'g', title: 'G', start: '2026-10-20', deadline: '2026-11-20' })], [], ctx, 'week');
    w.buckets.forEach((b) => { expect(b.a.getHours()).toBe(0); expect(b.a.getDay()).toBe(1); });
  });
});

describe('series: cumulative bars', () => {
  const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 30, start: dd(-10), deadline: dd(20) });
  const events = [
    done('a', dd(-9), 'Run'), done('b', dd(-8), 'Run', 90), done('c', dd(-1), 'Run'),
    ev('x', dd(-2), 'Run', 'Run later', 540, 600), // booked, not done
    done('y', dd(-3), 'Other'), // different category
    done('z', dd(-30), 'Run'), // before the goal
  ];

  it('counts only done hours, as a running total from the goal start', () => {
    const s = goalChartModel([g], events, ctx, 'day').series[0];
    const m = goalChartModel([g], events, ctx, 'day');
    const at = (k: number) => s.cells[m.buckets.findIndex((b) => key(b.a) === dd(k))];
    expect(at(-10).doneCum).toBe(0);
    expect(at(-9).doneCum).toBe(1);
    expect(at(-8).doneCum).toBeCloseTo(2.5);
    expect(at(-2).doneCum).toBeCloseTo(2.5); // the booked-but-not-done session adds nothing
    expect(at(-1).doneCum).toBeCloseTo(3.5);
    expect(at(0).doneCum).toBeCloseTo(3.5);
  });

  it('weekly bucket totals include everything up to the bucket end', () => {
    const m = goalChartModel([g], events, ctx, 'week');
    const s = m.series[0];
    expect(s.cells[m.nowIndex].doneCum).toBeCloseTo(3.5);
    expect(s.cells[m.nowIndex - 1].doneCum).toBeCloseTo(2.5); // week of 19 Oct
  });

  it('future buckets are empty and buckets outside the span are off', () => {
    const m = goalChartModel([g], events, ctx, 'day');
    const s = m.series[0];
    m.buckets.forEach((b, i) => {
      const c = s.cells[i];
      if (b.a.getTime() > TODAY.getTime()) { expect(c.future).toBe(true); expect(c.doneCum).toBe(0); }
      if (key(b.a) < dd(-10) || key(b.a) > dd(20)) { expect(c.on).toBe(false); expect(c.expected).toBe(0); expect(c.doneCum).toBe(0); }
    });
    expect(s.cells[m.buckets.findIndex((b) => key(b.a) === dd(-11))].on).toBe(false);
    expect(s.cells[m.buckets.findIndex((b) => key(b.a) === dd(20))].on).toBe(true);
  });

  it('a running timer counts as done', () => {
    const running = ev('t', dd(0), 'Run', 'Run now', 540, 600); // not ticked off
    const c = nowCtx({ timer: { tm: { id: 't' } as never, nowMs: NOW_MS } });
    const m = goalChartModel([g], [running], c, 'day');
    expect(m.series[0].cells[m.nowIndex].doneCum).toBe(1);
    const m2 = goalChartModel([g], [running], ctx, 'day');
    expect(m2.series[0].cells[m2.nowIndex].doneCum).toBe(0);
  });

  it('expected is the pace at the bucket end, reaching the target by the deadline', () => {
    const m = goalChartModel([g], events, ctx, 'day');
    const s = m.series[0];
    const i = m.buckets.findIndex((b) => key(b.a) === dd(-1));
    expect(s.cells[i].expected).toBeCloseTo(30 * (10 / 31));
    expect(s.cells[m.buckets.findIndex((b) => key(b.a) === dd(20))].expected).toBeCloseTo(30);
    expect(s.expectedAt(dnum(dd(-10)).getTime())).toBe(0);
    expect(s.expectedAt(addDays(dnum(dd(20)), 1).getTime())).toBeCloseTo(30);
    expect(s.expectedAt(addDays(dnum(dd(40)), 1).getTime())).toBeCloseTo(30);
  });

  it('end label text', () => {
    const s = goalChartModel([g], events, ctx, 'week').series[0];
    expect(s.prog).toBe('3.5/30h · 12%');
    expect(s.pace.num.startsWith('−')).toBe(true);
  });
});

describe('behind gap', () => {
  const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 31, start: dd(-10), deadline: dd(20) }); // 1h a day
  it('only the current bucket, only when behind', () => {
    const m = goalChartModel([g], [done('a', dd(-9), 'Run')], ctx, 'week');
    const cells = m.series[0].cells;
    cells.forEach((c, i) => { if (i !== m.nowIndex) expect(c.behind).toBe(0); });
    // expected by 14:20 today: 10 days + 14:20/24h of 31h over 31 days
    expect(cells[m.nowIndex].behind).toBeCloseTo(10 + 860 / 1440 - 1, 5);
  });
  it('none when ahead', () => {
    const lots = Array.from({ length: 10 }, (_, i) => done('d' + i, dd(-10 + i), 'Run', 120));
    const m = goalChartModel([g], lots, ctx, 'week');
    expect(m.series[0].cells[m.nowIndex].behind).toBe(0);
  });
  it('none for a goal that has not started or has ended', () => {
    const later = goal({ id: 'l', title: 'L', cat: 'L', hours: 5, start: dd(3), deadline: dd(9) });
    const old = goal({ id: 'o', title: 'O', cat: 'O', hours: 5, start: dd(-20), deadline: dd(-5) });
    const m = goalChartModel([later, old], [], ctx, 'day');
    m.series.forEach((s) => s.cells.forEach((c) => expect(c.behind).toBe(0)));
  });
  it('pixel sizes: bars are at least 5px, gaps at least 4px', () => {
    expect(barPx(0, 10)).toBe(0);
    expect(barPx(0.01, 10)).toBe(5);
    expect(barPx(5, 10)).toBe(75);
    expect(gapPx(0, 10)).toBe(0);
    expect(gapPx(0.01, 10)).toBe(4);
  });
});

describe('y max and grid', () => {
  const one = (hours: number, over = {}) => goalChartModel([goal({ id: 'g', title: 'G', hours, start: dd(-5), deadline: dd(10), ...over })], [], ctx, 'week');
  it('12% headroom over the target', () => {
    expect(one(40).yMax).toBeCloseTo(44.8);
  });
  it('at least 0.5, even with no goals or a tiny one', () => {
    expect(goalChartModel([], [], ctx, 'week').yMax).toBe(0.5);
    expect(one(0).yMax).toBe(0.5);
    expect(one(0.5).yMax).toBe(0.56);
  });
  it('done hours above the target raise it', () => {
    const lots = Array.from({ length: 5 }, (_, i) => done('d' + i, dd(-4 + i), 'G', 600));
    const m = goalChartModel([goal({ id: 'g', title: 'G', cat: 'G', hours: 10, start: dd(-5), deadline: dd(10) })], lots, ctx, 'week');
    expect(m.yMax).toBeCloseTo(50 * 1.12);
  });
  it('grid step is the first that gives at most five lines', () => {
    expect(chartGrid(0.5).map((l) => l.value)).toEqual([0.25]);
    expect(chartGrid(0.56).map((l) => l.value)).toEqual([0.25, 0.5]);
    expect(chartGrid(0.56).map((l) => l.label)).toEqual(['0.3h', '0.5h']); // hrs() rounds to one decimal, as the prototype's labels do
    expect(chartGrid(5).map((l) => l.label)).toEqual(['1h', '2h', '3h', '4h']);
    expect(chartGrid(44.8).map((l) => l.label)).toEqual(['10h', '20h', '30h', '40h']);
    expect(chartGrid(600 * 1.12).map((l) => l.label)).toEqual(['200h', '400h', '600h']);
    expect(chartGrid(600 * 1.12 * 10).map((l) => l.value).length).toBeLessThanOrEqual(7); // beyond the table the step is 1000
    chartGrid(0.5).forEach((l) => expect(l.value).toBeLessThan(0.5));
  });
  it('detail view rescales to the focused goal', () => {
    const big = goal({ id: 'b', title: 'Big', hours: 600, start: dd(-5), deadline: dd(10) });
    const small = goal({ id: 's', title: 'Small', hours: 5, start: dd(-5), deadline: dd(10) });
    expect(goalChartModel([big, small], [], ctx, 'week').yMax).toBeCloseTo(672);
    expect(goalChartModel([small], [], ctx, 'week').yMax).toBeCloseTo(5.6);
  });
});

describe('timeToX', () => {
  const m = goalChartModel([goal({ id: 'g', title: 'G', start: '2026-09-10', deadline: '2027-01-20' })], [], ctx, 'month');
  const B = m.buckets;
  it('is the bucket index plus the fraction through that bucket', () => {
    expect(timeToX(B[1].a.getTime(), B)).toBe(1);
    expect(timeToX(B[2].a.getTime(), B)).toBe(2);
    // 15 Oct 12:00 is about half way through October (31 days): not 0.5 of a 28-day February
    const oct = B.findIndex((b) => b.a.getMonth() === 9);
    const mid = (B[oct].a.getTime() + B[oct].b.getTime()) / 2;
    expect(timeToX(mid, B)).toBeCloseTo(oct + 0.5, 10);
  });
  it('unequal months: one day is a different width in February than in March', () => {
    const feb = B.find((b) => b.a.getMonth() === 1 && b.a.getFullYear() === 2027)!;
    const g2 = goalChartModel([goal({ id: 'g', title: 'G', start: '2027-01-10', deadline: '2027-04-20' })], [], ctx, 'month').buckets;
    const f = g2.findIndex((b) => b.a.getMonth() === 1), mar = g2.findIndex((b) => b.a.getMonth() === 2);
    const dayW = (i: number) => timeToX(addDays(g2[i].a, 1).getTime(), g2) - i;
    expect(dayW(f)).toBeCloseTo(1 / 28, 6);
    expect(dayW(mar)).toBeCloseTo(1 / 31, 6);
    expect(feb).toBeTruthy();
  });
  it('clamps outside the range and inverts', () => {
    expect(timeToX(0, B)).toBe(0);
    expect(timeToX(Date.UTC(2100, 0, 1), B)).toBe(B.length);
    [0, 0.25, 1.5, 3.9, B.length - 0.1].forEach((x) => expect(timeToX(xToTime(x, B), B)).toBeCloseTo(x, 6));
  });
  it('weeks are even', () => {
    const w = goalChartModel([goal({ id: 'g', title: 'G', start: dd(-30), deadline: dd(30) })], [], ctx, 'week').buckets;
    expect(timeToX(addDays(w[3].a, 3).getTime(), w)).toBeCloseTo(3 + 3 / 7, 6);
  });
});

describe('pace line and deadline dot', () => {
  const unitCases: ChartUnit[] = ['day', 'week', 'month'];
  unitCases.forEach((unit) => {
    it(unit + ': the line at each column centre equals the pace at that column end', () => {
      const m = goalChartModel([goal({ id: 'g', title: 'G', hours: 60, start: '2026-09-17', deadline: '2027-02-12' })], [], ctx, unit);
      const s = m.series[0];
      const pts = paceLine(s, m.buckets);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      const at = (x: number) => {
        for (let i = 0; i < pts.length - 1; i++) {
          if (x >= pts[i].x - 1e-9 && x <= pts[i + 1].x + 1e-9) {
            const f = pts[i + 1].x === pts[i].x ? 0 : (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
            return pts[i].value + f * (pts[i + 1].value - pts[i].value);
          }
        }
        return null;
      };
      m.buckets.forEach((_, i) => {
        if (!s.cells[i].on) return;
        const v = at(i + 0.5);
        if (v != null) expect(v).toBeCloseTo(s.cells[i].expected, 6);
      });
    });
  });

  it('starts at the goal start and ends at the target on the deadline', () => {
    const m = goalChartModel([goal({ id: 'g', title: 'G', hours: 40, start: '2026-10-20', deadline: '2026-12-15' })], [], ctx, 'week');
    const pts = paceLine(m.series[0], m.buckets);
    expect(pts[0].value).toBe(0);
    expect(pts[pts.length - 1].value).toBeCloseTo(40);
    expect(pts[pts.length - 1].x).toBeCloseTo(deadlineDot(m.series[0], m.buckets)!.x, 10);
  });

  it('months: the dot is on the column the deadline falls in', () => {
    const m = goalChartModel([goal({ id: 'g', title: 'G', hours: 40, start: '2026-10-20', deadline: '2027-02-28' })], [], ctx, 'month');
    const dot = deadlineDot(m.series[0], m.buckets)!;
    // deadline is the end of 28 Feb = the end of February: right at a column's end, so the centre of that column
    const feb = m.buckets.findIndex((b) => b.a.getMonth() === 1);
    expect(dot.x).toBeCloseTo(feb + 0.5, 10);
    expect(dot.value).toBe(40);
  });

  it('months: a mid-month deadline is placed by day, not by a straight time line', () => {
    const m = goalChartModel([goal({ id: 'g', title: 'G', hours: 40, start: '2026-10-20', deadline: '2027-02-14' })], [], ctx, 'month');
    const dot = deadlineDot(m.series[0], m.buckets)!;
    const feb = m.buckets.findIndex((b) => b.a.getMonth() === 1);
    expect(dot.x).toBeCloseTo(feb + 14 / 28 - 0.5, 10); // 14 of 28 days through February
  });

  it('nothing for a goal without hours', () => {
    const m = goalChartModel([goal({ id: 'g', title: 'G', hours: 0 })], [], ctx, 'week');
    expect(paceLine(m.series[0], m.buckets)).toEqual([]);
    expect(deadlineDot(m.series[0], m.buckets)).toBeNull();
  });
});

describe('placeEndLabels', () => {
  const fixed = (t: string, px: number) => t.length * px * 0.5; // a fixed-width fake
  const dot = (id: string, px: number, py: number): EndDotInput => ({ goalId: id, px, py, title: 'Goal ' + id, prog: '12/40h · 30%', pace: '−3h' });
  const box = (p: { left: number; top: number; width: number }) => ({ l: p.left, r: p.left + p.width, t: p.top, b: p.top + 27 });
  const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  it('puts a lone label to the right of its dot', () => {
    const [p] = placeEndLabels([dot('a', 100, 60)], fixed);
    expect(p.left).toBe(109);
    expect(p.top).toBe(60 - 13.5);
  });

  it('two goals ending the same day do not overlap, nor sit on each other\'s dot', () => {
    const ds = [dot('a', 200, 40), dot('b', 200, 40), dot('c', 60, 100)];
    const ps = placeEndLabels(ds, fixed);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(hit(box(ps[i]), box(ps[j]))).toBe(false);
    ps.forEach((p, i) => expect(hit(box(p), { l: ds[i].px - 7, r: ds[i].px + 7, t: ds[i].py - 7, b: ds[i].py + 7 })).toBe(false));
  });

  it('keeps labels inside the plot vertically', () => {
    const ps = placeEndLabels([dot('a', 50, 2), dot('b', 80, 149), dot('c', 120, 0), dot('d', 120, 150)], fixed, 150);
    ps.forEach((p) => { expect(p.top).toBeGreaterThanOrEqual(-8); expect(p.top + 27).toBeLessThanOrEqual(150 + 0.001); });
  });

  it('returns results in input order and caps the width', () => {
    const ds = [dot('a', 10, 50), { ...dot('b', 300, 80), title: 'x'.repeat(200) }];
    const ps = placeEndLabels(ds, fixed);
    expect(ps.map((p) => p.goalId)).toEqual(['a', 'b']);
    expect(ps[1].width).toBe(150 + 6);
  });

  it('the estimator gives widths that grow with text and weight', () => {
    expect(estimateTextWidth('Marathon', 10.5, 700)).toBeGreaterThan(estimateTextWidth('Run', 10.5, 700));
    expect(estimateTextWidth('Marathon', 10, 700)).toBeGreaterThan(estimateTextWidth('Marathon', 10, 400));
    expect(estimateTextWidth('', 10, 400)).toBe(0);
  });
});

describe('sortGoals feeds the series order', () => {
  it('series follow the order given', () => {
    const a = goal({ id: 'a', title: 'A', deadline: dd(30) }), b = goal({ id: 'b', title: 'B', deadline: dd(5) });
    expect(goalChartModel(sortGoals([a, b]), [], ctx, 'week').series.map((s) => s.goalId)).toEqual(['b', 'a']);
  });
});
