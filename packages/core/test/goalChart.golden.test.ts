/**
 * Cross-checks the goals chart model against the ORIGINAL prototype's graph code.
 *
 * test/fixtures/golden-chart.json was produced by running the prototype's own `gcBk` / `gcSer` /
 * `gcMax` / `gcLines` / `gcGrid` source on the golden sample data at Fri 30 Oct 2026, see
 * scripts/gen-golden-chart.mjs. One place differs on purpose: in Months mode the prototype maps time
 * to x linearly although months have unequal lengths, so its pace line and dots drift off their
 * columns; the port places them by bucket index + fraction (`timeToX`), so that is asserted separately.
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden-chart.json' with { type: 'json' };
import { CHART_H, deadlineDot, goalChartModel, key, paceLine, sortGoals } from '../src/index.ts';
import type { ChartUnit, ProtoGoal } from '../src/index.ts';
import base from './fixtures/golden.json' with { type: 'json' };
import { nowCtx, revive } from './helpers.ts';

type Run = typeof golden.units.day;
const goals = sortGoals((revive(base) as unknown as { data: { goals: ProtoGoal[]; events: never[] } }).data.goals);
const events = (revive(base) as unknown as { data: { events: never[] } }).data.events;
const ctx = nowCtx();
const units: ChartUnit[] = ['day', 'week', 'month'];

const check = (unit: ChartUnit, list: ProtoGoal[], want: Run) => {
  const m = goalChartModel(list, events, ctx, unit);
  expect(m.buckets.length).toBe(want.n);
  expect(m.visible).toBe(want.vis);
  expect(m.scrollTo).toBe(want.scrollAt);
  expect(m.yMax).toBeCloseTo(want.max, 9);
  expect(m.buckets.map((b) => ({ a: key(b.a), b: key(b.b), label: b.label }))).toEqual(want.buckets);
  expect(m.series.map((s) => s.goalId)).toEqual(want.series.map((s) => s.id));
  m.series.forEach((s, si) => {
    expect(s.target).toBe(want.series[si].target);
    s.cells.forEach((c, i) => {
      const w = want.series[si].cells[i];
      expect({ on: c.on, future: c.future }).toEqual({ on: w.on, future: w.fut });
      expect(c.expected).toBeCloseTo(w.exp, 9);
      expect(c.doneCum).toBeCloseTo(w.h, 9);
    });
  });
  expect(m.grid.map((g) => ({ label: g.label, bottom: Math.round((g.value / m.yMax) * CHART_H) + 'px' }))).toEqual(want.grid);
  return m;
};

units.forEach((unit) => {
  describe('golden chart: ' + unit, () => {
    const want = golden.units[unit] as Run;
    it('buckets, cumulative bars, y max and grid match the prototype (all goals)', () => {
      check(unit, goals, want);
    });
    goals.forEach((g) => {
      it('detail view for ' + g.title, () => {
        check(unit, [g], (golden.detail[unit] as Record<string, Run>)[g.id]);
      });
    });

    it(unit === 'month' ? 'pace line and dots are placed by bucket (deliberately not the prototype\'s linear x)' : 'pace line ends and deadline dots match the prototype', () => {
      const m = goalChartModel(goals, events, ctx, unit);
      const n = m.buckets.length;
      m.series.filter((s) => s.target > 0 && want.lines.length).forEach((s) => {
        const pts = paceLine(s, m.buckets);
        const dot = deadlineDot(s, m.buckets)!;
        const wantDot = want.dots.find((d) => d.id === s.goalId)!;
        const px = (dot.x / n) * 100;
        if (unit !== 'month') {
          expect(px).toBeCloseTo(wantDot.cx, 1);
          const w = want.lines.map((l) => l.split(' ').map((p) => p.split(',').map(Number)));
          const mine = [pts[0], pts[pts.length - 1]].map((p) => [(p.x / n) * 100, 150 - (p.value / m.yMax) * 150]);
          const match = w.find((l) => Math.abs(l[1][0] - mine[1][0]) < 0.06 && Math.abs(l[0][0] - mine[0][0]) < 0.06);
          expect(match, s.title + ' line').toBeTruthy();
          expect(match![0][1]).toBeCloseTo(mine[0][1], 1);
          expect(match![1][1]).toBeCloseTo(mine[1][1], 1);
        } else {
          // the prototype drifts here; the port's dot sits in the column of the deadline (within one column of it)
          expect(Math.abs(px - wantDot.cx)).toBeLessThan(100 / n);
          expect(pts.length).toBeGreaterThanOrEqual(2);
        }
      });
    });
  });
});
