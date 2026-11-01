/**
 * Goals sheet chart model (pure: no DOM, no Node). Ported from the prototype's
 * `gcBk` / `gcSer` / `gcMax` / `gcGrid` / `gcDots` code, with one deliberate
 * difference: the prototype maps time to x with a single straight line across
 * the whole range, but every column is the same width. Days and weeks are
 * equal length so that is fine there; months are 28-31 days, so in Months mode
 * its pace line and deadline dots drift off their columns. Here time is mapped
 * piecewise instead: bucket index plus the fraction of the way through that
 * bucket (`timeToX`), and the pace line gets a vertex at every bucket end.
 *
 * Bars are cumulative: hours *done* from the goal's start to the bucket's end.
 */
import { addDays, clamp, dnum, DOW, hrs, MON, weekKey } from './time.ts';
import type { ProtoEvent, ProtoGoal } from './model.ts';
import { goalHours, goalRate, goalSpan, goalStats, paceOf } from './goals.ts';
import type { NowCtx, PaceInfo } from './goals.ts';

export type ChartUnit = 'day' | 'week' | 'month';

export const CHART_VISIBLE: Record<ChartUnit, number> = { day: 7, week: 8, month: 6 };
export const CHART_CAP: Record<ChartUnit, number> = { day: 400, week: 160, month: 60 };
/** Plot height in px. */
export const CHART_H = 150;
/** Candidate grid steps, in hours. */
export const GRID_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500] as const;

export interface ChartBucket {
  a: Date;
  b: Date;
  label: string;
  /** today falls in this bucket */
  isNow: boolean;
}

export interface ChartCell {
  /** the goal's span overlaps this bucket */
  on: boolean;
  /** the bucket starts after today */
  future: boolean;
  /** hours done from the goal's start to the bucket's end (0 when off or future) */
  doneCum: number;
  /** ideal-pace hours at the bucket's end (0 when off) */
  expected: number;
  /** hours the goal is behind pace right now: only in the current bucket, else 0 */
  behind: number;
}

export interface ChartSeries {
  goalId: string;
  title: string;
  hue: number;
  target: number;
  cells: ChartCell[];
  spanStart: Date;
  spanEnd: Date;
  /** ideal-pace hours at time `t` (epoch ms): linear from start to deadline, clamped */
  expectedAt: (t: number) => number;
  /** hours done over the whole span */
  done: number;
  /** "24/70h · 34%" */
  prog: string;
  pace: PaceInfo;
}

export interface ChartGridLine {
  value: number;
  label: string;
}

export interface ChartModel {
  unit: ChartUnit;
  buckets: ChartBucket[];
  series: ChartSeries[];
  yMax: number;
  grid: ChartGridLine[];
  /** buckets that fit on screen at once */
  visible: number;
  /** bucket index to scroll to on open / unit change (the current bucket is 2nd or 3rd column) */
  scrollTo: number;
  /** index of the current bucket, or -1 if it is outside the range (cap hit) */
  nowIndex: number;
}

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Y max: 12% headroom over the largest expected or done value, at least 0.5h. */
export const chartYMax = (series: ReadonlyArray<ChartSeries>): number =>
  Math.max(0.5, series.reduce((m, x) => x.cells.reduce((mm, c) => Math.max(mm, c.expected, c.doneCum), m), 0) * 1.12);

/** Horizontal gridlines at a "nice" step: the first that gives at most five lines. */
export const chartGrid = (yMax: number): ChartGridLine[] => {
  const step = GRID_STEPS.find((v) => yMax / v <= 5) || 1000;
  const out: ChartGridLine[] = [];
  for (let v = step; v < yMax; v += step) out.push({ value: v, label: hrs(v) + 'h' });
  return out;
};

const bucketList = (unit: ChartUnit, goals: ReadonlyArray<ProtoGoal>, today: Date): { buckets: ChartBucket[]; first: number } => {
  const vis = CHART_VISIBLE[unit], mo = unit === 'month', step = unit === 'day' ? 1 : 7;
  const base = unit === 'day' ? midnight(today) : mo ? new Date(today.getFullYear(), today.getMonth(), 1) : dnum(weekKey(today));
  const idx = (d: Date): number => mo
    ? (d.getFullYear() - base.getFullYear()) * 12 + d.getMonth() - base.getMonth()
    : Math.floor(Math.round((midnight(d).getTime() - base.getTime()) / 86400000) / step);
  const spans = goals.map((g) => goalSpan(g, today));
  const lo = spans.reduce((m, s) => (s.s0.getTime() < m.getTime() ? s.s0 : m), today);
  const hi = spans.reduce((m, s) => (s.s1.getTime() > m.getTime() ? s.s1 : m), today);
  const first = Math.min(idx(lo) - 1, -1);
  const last = Math.max(idx(new Date(hi.getTime() - 1)) + 1, first + vis - 1, vis - 3);
  const n = Math.min(last - first + 1, CHART_CAP[unit]);
  const t0 = today.getTime();
  const buckets = Array.from({ length: n }, (_, i): ChartBucket => {
    let a: Date, b: Date, label: string;
    if (mo) {
      a = new Date(base.getFullYear(), base.getMonth() + first + i, 1);
      b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
      label = MON[a.getMonth()] + (i === 0 || a.getMonth() === 0 ? " '" + String(a.getFullYear()).slice(2) : '');
    } else {
      a = addDays(base, (first + i) * step);
      b = addDays(a, step);
      label = unit === 'day'
        ? (a.getDate() === 1 || i === 0 ? a.getDate() + ' ' + MON[a.getMonth()] : DOW[a.getDay()].charAt(0))
        : a.getDate() + (i === 0 || a.getDate() <= 7 ? ' ' + MON[a.getMonth()] : '');
    }
    return { a, b, label, isNow: t0 >= a.getTime() && t0 < b.getTime() };
  });
  return { buckets, first };
};

/**
 * The chart for a list of goals (pass just one for the detail view; y max is then
 * rescaled to it). Goals should already be in display order (`sortGoals`).
 */
export const goalChartModel = (
  goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx, unit: ChartUnit,
): ChartModel => {
  const today = ctx.today, t0 = today.getTime();
  const nowMs = ctx.nowMs ?? t0 + ctx.nowMin * 60000;
  const { buckets, first } = bucketList(unit, goals, today);
  const series = goals.map((g): ChartSeries => {
    const sp = goalSpan(g, today), R = goalRate(g, today), span = sp.s1.getTime() - sp.s0.getTime();
    const expectedAt = (t: number): number => R.target * clamp((t - sp.s0.getTime()) / span, 0, 1);
    const cells = buckets.map((b): ChartCell => {
      const on = b.a.getTime() < sp.s1.getTime() && b.b.getTime() > sp.s0.getTime();
      const future = b.a.getTime() > t0;
      const end = b.b.getTime() > sp.s1.getTime() ? sp.s1 : b.b;
      const doneCum = on && !future ? goalHours(g, sp.s0, end, events, true, ctx.timer) : 0;
      const behind = b.isNow && on && !future && R.target > 0 ? Math.max(0, expectedAt(nowMs) - doneCum) : 0;
      return { on, future, doneCum, expected: on ? expectedAt(end.getTime()) : 0, behind };
    });
    const st = goalStats(g, events, ctx);
    const pct = R.target ? Math.round((st.done / R.target) * 100) : 0;
    return {
      goalId: g.id, title: g.title, hue: g.hue, target: R.target, cells, spanStart: sp.s0, spanEnd: sp.s1, expectedAt,
      done: st.done, prog: hrs(st.done) + '/' + hrs(R.target) + 'h · ' + pct + '%', pace: paceOf(g, events, ctx),
    };
  });
  const yMax = chartYMax(series);
  return {
    unit, buckets, series, yMax, grid: chartGrid(yMax),
    visible: CHART_VISIBLE[unit], scrollTo: Math.max(0, -first - 2), nowIndex: buckets.findIndex((b) => b.isNow),
  };
};

/**
 * Time (epoch ms) to bucket coordinates: the bucket's index plus the fraction of
 * the way through it, so columns of unequal length (months) still line up.
 * Before the first bucket is 0, after the last is `buckets.length`.
 */
export const timeToX = (t: number, buckets: ReadonlyArray<Pick<ChartBucket, 'a' | 'b'>>): number => {
  const n = buckets.length;
  if (!n || t <= buckets[0].a.getTime()) return 0;
  if (t >= buckets[n - 1].b.getTime()) return n;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (buckets[mid].a.getTime() <= t) lo = mid; else hi = mid - 1;
  }
  const a = buckets[lo].a.getTime(), b = buckets[lo].b.getTime();
  return lo + (t - a) / (b - a);
};

/** Inverse of `timeToX` (epoch ms). */
export const xToTime = (x: number, buckets: ReadonlyArray<Pick<ChartBucket, 'a' | 'b'>>): number => {
  const n = buckets.length;
  if (!n) return 0;
  if (x <= 0) return buckets[0].a.getTime();
  if (x >= n) return buckets[n - 1].b.getTime();
  const i = Math.floor(x), a = buckets[i].a.getTime(), b = buckets[i].b.getTime();
  return a + (x - i) * (b - a);
};

export interface PacePoint {
  /** position in bucket coordinates (0 = left edge of the first column, n = right edge of the last) */
  x: number;
  /** ideal hours */
  value: number;
}

/**
 * The dotted ideal-pace line. Shifted half a bucket left so its value at a column's
 * centre is the pace at that column's end, which is what the cumulative bar shows.
 * It has a vertex at every bucket end it crosses, since time is not linear in x
 * when buckets differ in length. Empty when the goal has no hours or is off-screen.
 */
export const paceLine = (s: Pick<ChartSeries, 'target' | 'spanStart' | 'spanEnd' | 'expectedAt'>, buckets: ReadonlyArray<ChartBucket>): PacePoint[] => {
  const n = buckets.length;
  if (!n || !(s.target > 0)) return [];
  const tL = Math.max(s.spanStart.getTime(), xToTime(0.5, buckets));
  const tR = Math.min(s.spanEnd.getTime(), buckets[n - 1].b.getTime());
  if (!(tR > tL)) return [];
  const pt = (t: number): PacePoint => ({ x: timeToX(t, buckets) - 0.5, value: s.expectedAt(t) });
  const out = [pt(tL)];
  for (let i = 0; i < n; i++) {
    const e = buckets[i].b.getTime();
    if (e > tL && e < tR) out.push(pt(e));
  }
  out.push(pt(tR));
  return out;
};

/** Where a goal's deadline dot sits, in bucket coordinates (null when it is outside the range). */
export const deadlineDot = (s: Pick<ChartSeries, 'target' | 'spanEnd'>, buckets: ReadonlyArray<ChartBucket>): PacePoint | null => {
  if (!buckets.length || !(s.target > 0)) return null;
  const x = timeToX(s.spanEnd.getTime(), buckets) - 0.5;
  return x < 0 || x > buckets.length ? null : { x, value: s.target };
};

/** Bar height in px: at least 5 for any hours done. */
export const barPx = (hours: number, yMax: number, plotH: number = CHART_H): number =>
  hours > 0 ? Math.max(5, Math.round((hours / yMax) * plotH)) : 0;

/** Behind-gap height in px: at least 4 when there is a gap. */
export const gapPx = (behind: number, yMax: number, plotH: number = CHART_H): number =>
  behind > 0 ? Math.max(4, Math.round((behind / yMax) * plotH)) : 0;

/* ---------- end labels ---------- */

/** Text width in px for a string at a font size and weight. Injected so core stays DOM-free. */
export type TextMeasure = (text: string, px: number, weight: number) => number;

/**
 * A rough width estimate from a per-character table, good enough for placing labels
 * where the real font can't be measured (React Native). Not pixel exact.
 */
export const estimateTextWidth: TextMeasure = (text, px, weight) => {
  let em = 0;
  for (const ch of text) {
    if ('iljI.,:;\'|!`'.includes(ch)) em += 0.28;
    else if (ch === ' ' || ch === '-' || ch === '(' || ch === ')' || ch === '/' || ch === 't' || ch === 'f' || ch === 'r') em += 0.34;
    else if ('mwMW@%'.includes(ch)) em += 0.86;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else if (ch >= '0' && ch <= '9') em += 0.57;
    else if (ch.charCodeAt(0) > 0x2e80) em += 1;
    else em += 0.52;
  }
  return em * px * (weight >= 600 ? 1.06 : 1);
};

export interface EndDotInput {
  goalId: string;
  /** dot centre in plot pixels */
  px: number;
  py: number;
  title: string;
  /** "24/70h · 34%" */
  prog: string;
  /** "−9.7h" */
  pace: string;
}

export interface PlacedLabel {
  goalId: string;
  left: number;
  top: number;
  width: number;
}

export const LABEL_H = 27;
export const LABEL_MAX_W = 150;

/**
 * Collision-avoiding placement for the deadline labels. Goals are laid out right to
 * left; each tries five spots around its dot (right-middle, above-right, below-right,
 * higher, lower) and takes the one with the least overlap with dots and already
 * placed labels, then the least distance. Labels are kept vertically inside
 * `[-8, plotH - LABEL_H]`. Results are in input order.
 */
export const placeEndLabels = (dots: ReadonlyArray<EndDotInput>, measure: TextMeasure, plotH: number = CHART_H): PlacedLabel[] => {
  type Box = { l: number; r: number; t: number; b: number };
  const LH = LABEL_H, G = 9;
  const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const ov = (a: Box, b: Box) => (hit(a, b) ? (Math.min(a.r, b.r) - Math.max(a.l, b.l)) * (Math.min(a.b, b.b) - Math.max(a.t, b.t)) : 0);
  const sized = dots.map((d) => ({
    d,
    w: Math.ceil(Math.min(LABEL_MAX_W, Math.max(measure(d.title, 10.5, 700), measure(d.prog, 10, 400) + 5 + measure(d.pace, 10, 600)) * 1.06)) + 6,
  }));
  const obst: Box[] = dots.map((d) => ({ l: d.px - 7, r: d.px + 7, t: d.py - 7, b: d.py + 7 }));
  const placed: Box[] = [];
  const out = new Map<string, PlacedLabel>();
  sized.slice().sort((a, b) => b.d.px - a.d.px).forEach(({ d, w }) => {
    const x = d.px, y = d.py;
    const cands: Array<[number, number]> = [
      [x + G, y - LH / 2], [x + 6, y - LH - 5], [x + 6, y + 5], [x + G, y - LH * 1.5 - 4], [x + G, y + LH / 2 + 4],
    ];
    let best: { s: number; box: Box } | null = null;
    cands.forEach(([l, t0], ci) => {
      const t = clamp(t0, -8, plotH - LH);
      const box: Box = { l, r: l + w, t, b: t + LH };
      let s = Math.abs(t - t0) * 4 + ci;
      obst.forEach((o) => { s += ov(box, o) * 50; });
      placed.forEach((o) => { s += ov(box, o) * 50; });
      if (!best || s < best.s) best = { s, box };
    });
    const box = (best as unknown as { box: Box }).box;
    placed.push(box);
    out.set(d.goalId, { goalId: d.goalId, left: box.l, top: box.t, width: w });
  });
  return dots.map((d) => out.get(d.goalId) as PlacedLabel);
};
