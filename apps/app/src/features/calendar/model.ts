/**
 * Calendar view model: pure builders for the day columns, event segments,
 * lane layout, the all-day band, the sun shading and block metrics. No React,
 * no clock: callers pass `today` / `now`. Ported from the prototype's
 * `days()`, `hourH()`, `renderVals()` and `layout()`.
 */
import {
  DOW, MONL, MON, ZMIN, activeGoals, addDays, clamp, dnum, goalStats, hrs, key, layoutDay, weekKey,
  type LaidOut, type NowCtx, type ProtoEvent, type ProtoGoal,
} from '@calendar/core';

export type Mode = 'day3' | 'week' | 'month';

export const HOURS = 24;
/** Width of the hour-label gutter inside the grid (the prototype's 38px column + 14px left padding). */
export const GUTTER = 38;
export const GRID_PAD_LEFT = 14;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Days shown for the 3-day (centred on `focus`) and week (Monday first) views. */
export function viewDays(mode: 'day3' | 'week', focus: Date): Date[] {
  if (mode === 'week') {
    const start = addDays(focus, -((focus.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [-1, 0, 1].map((i) => addDays(focus, i));
}

/** Previous / next page: 3 days, a week or a month. */
export function stepFocus(mode: Mode, focus: Date, dir: 1 | -1): Date {
  if (mode === 'month') {
    const first = new Date(focus.getFullYear(), focus.getMonth() + dir, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(focus.getDate(), last));
  }
  return addDays(focus, dir * (mode === 'week' ? 7 : 3));
}

/** Whether the page differs from the one that contains today ("Return to today"). */
export function awayFromToday(mode: Mode, focus: Date, today: Date): boolean {
  if (mode === 'month') return focus.getFullYear() !== today.getFullYear() || focus.getMonth() !== today.getMonth();
  if (mode === 'week') return weekKey(focus) !== weekKey(today);
  return key(focus) !== key(today);
}

/** The 6x7 grid of days for a month view, Monday first. */
export function monthGrid(focus: Date): Date[] {
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** "October", "Oct – Nov", with the year when it isn't this year. */
export function titleFor(days: Date[], today: Date): string {
  const c0 = days[0];
  const c1 = days[days.length - 1];
  const thisYr = c1.getFullYear() === today.getFullYear();
  return c0.getMonth() === c1.getMonth()
    ? MONL[c0.getMonth()] + (thisYr ? '' : ' ' + c0.getFullYear())
    : MONL[c0.getMonth()].slice(0, 3) + ' – ' + MONL[c1.getMonth()].slice(0, 3) + (thisYr ? '' : ' ' + c1.getFullYear());
}

export const monthTitle = (focus: Date, today: Date): string =>
  MONL[focus.getMonth()] + (focus.getFullYear() === today.getFullYear() ? '' : ' ' + focus.getFullYear());

/** "11/18h · 1 behind" / "2 goals" / "No goals yet · set one". */
export function goalSummary(goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): { text: string; behind: number } {
  const act = activeGoals(goals, events, ctx);
  if (!act.length) return { text: 'No goals yet · set one', behind: 0 };
  let d = 0;
  let t = 0;
  let behind = 0;
  act.forEach((g) => {
    const s = goalStats(g, events, ctx);
    d += s.done;
    t += s.target;
    if (s.delta < -0.5) behind++;
  });
  return { text: hrs(d) + '/' + hrs(t) + 'h · ' + (behind ? behind + ' behind' : act.length + (act.length === 1 ? ' goal' : ' goals')), behind };
}

/* ---------- vertical scale ---------- */

/**
 * Pixels per hour for a zoom level. At the minimum zoom the whole day fits;
 * otherwise `base * zoom`, clamped (the prototype's `hourH`).
 */
export function hourHeightFor(o: { zoom: number; week: boolean; viewportH: number; startHour?: number }): number {
  const sh = o.startHour ?? 0;
  const base = o.week ? 40 : 58;
  const vh = o.viewportH > 0 ? o.viewportH : 600;
  const fit = Math.max(12, vh - 128) / Math.max(1, HOURS - sh);
  if (Math.abs(o.zoom - ZMIN) < 0.001) return Math.min(fit, 32);
  return clamp(base * o.zoom, Math.min(fit, 32), Math.max(165, vh / 2));
}

/** Hour label stride: every 3rd hour when dense, every 2nd when tight. */
export const labelStep = (hh: number): number => (hh < 24 ? 3 : hh < 34 ? 2 : 1);

export const hourLabel = (h: number): string =>
  h === 0 || h === 24 ? 'midnight' : h === 12 ? 'noon' : (h % 12 === 0 ? 12 : h % 12) + (h > 12 ? 'pm' : 'am');

/** Hours that get a label (and a grid line) at this density, as in the prototype. */
export function visibleHours(hh: number, startHour = 0): number[] {
  const lstep = labelStep(hh);
  const out: number[] = [];
  for (let h = startHour; h <= HOURS; h++) {
    if (lstep > 1 && h !== 0 && h !== 12 && h !== 24 && (h - startHour) % lstep !== 0) continue;
    out.push(h);
  }
  return out;
}

/* ---------- segments and lanes ---------- */

export interface Seg {
  id: string;
  ev: ProtoEvent;
  /** minutes within this day column */
  start: number;
  end: number;
  /** the event's own start / end (end may pass 1440) */
  fullStart: number;
  fullEnd: number;
  /** an event running past midnight shows as a 'first' piece and a 'second' piece the next day */
  part: 'solo' | 'first' | 'second';
}

/** Timed segments in one day column: the day's events plus the tail of yesterday's overnight ones. */
export function daySegs(events: ReadonlyArray<ProtoEvent>, dk: string, prevDk: string): Seg[] {
  const out: Seg[] = [];
  events.forEach((e) => {
    if (e.allDay) return;
    if (e.day === dk) {
      out.push({ id: e.id, ev: e, start: e.start, end: Math.min(e.end, 1440), fullStart: e.start, fullEnd: e.end, part: e.end > 1440 ? 'first' : 'solo' });
    } else if (e.day === prevDk && e.end > 1440) {
      out.push({ id: e.id, ev: e, start: 0, end: e.end - 1440, fullStart: e.start, fullEnd: e.end, part: 'second' });
    }
  });
  return out;
}

const layoutCache = new Map<string, Array<LaidOut<Seg>>>();

/**
 * Lane layout for a day, memoised by the day's event signature so a day whose
 * events did not change keeps the same array (and its columns skip re-rendering).
 */
export function dayLayout(events: ReadonlyArray<ProtoEvent>, dk: string, prevDk: string): Array<LaidOut<Seg>> {
  const segs = daySegs(events, dk, prevDk);
  const sig = dk + '|' + segs.map((s) => [s.id, s.start, s.end, s.part, s.ev.title, s.ev.cat, s.ev.done ? 1 : 0, s.ev.visibility, s.ev.source, s.ev.isMine, s.ev.win ? 1 : 0, s.ev.pauses ? s.ev.pauses.length : 0, s.ev.at].join(':')).join(',');
  const hit = layoutCache.get(sig);
  if (hit) return hit;
  const laid = layoutDay(segs);
  if (layoutCache.size > 300) layoutCache.clear();
  layoutCache.set(sig, laid);
  return laid;
}

/* ---------- all-day band ---------- */

export interface AllDayItem {
  ev: ProtoEvent;
  i0: number;
  i1: number;
  row: number;
  openLeft: boolean;
  openRight: boolean;
}

/** Spanning bars for all-day events, packed into rows (the prototype's all-day band). */
export function packAllDay(events: ReadonlyArray<ProtoEvent>, days: Date[]): { items: AllDayItem[]; rows: number } {
  const idx: Record<string, number> = {};
  days.forEach((d, i) => { idx[key(d)] = i; });
  const items: AllDayItem[] = [];
  events.forEach((e) => {
    if (!e.allDay) return;
    const n = clamp(Math.round(e.days || 1), 1, 60);
    const s0 = dnum(e.day);
    let i0: number | null = null;
    let i1: number | null = null;
    for (let k = 0; k < n; k++) {
      const ix = idx[key(addDays(s0, k))];
      if (ix != null) {
        if (i0 == null) i0 = ix;
        i1 = ix;
      }
    }
    if (i0 == null || i1 == null) return;
    items.push({ ev: e, i0, i1, row: 0, openLeft: idx[e.day] == null, openRight: idx[key(addDays(s0, n - 1))] == null });
  });
  items.sort((a, b) => (a.i0 - b.i0) || ((b.i1 - b.i0) - (a.i1 - a.i0)));
  const rows: AllDayItem[][] = [];
  items.forEach((it) => {
    let rw = 0;
    while (rows[rw] && rows[rw].some((x) => x.i0 <= it.i1 && it.i0 <= x.i1)) rw++;
    (rows[rw] = rows[rw] || []).push(it);
    it.row = rw;
  });
  return { items, rows: rows.length };
}

/* ---------- sun shading ---------- */

export interface ShadeStop { offset: number; color: string; opacity: number }

/** Gradient stops for the night / dusk / daylight shading from sunrise and sunset (minutes). */
export function sunStops(sr: number, ss: number, depth = 0.34, startHour = 0): ShadeStop[] | null {
  if (!(ss > sr)) return null;
  const span = (HOURS - startHour) * 60;
  const pc = (m: number) => clamp((m - startHour * 60) / span, 0, 1);
  const night = (o: number): ShadeStop => ({ offset: o, color: '#000', opacity: depth });
  const dusk = (o: number): ShadeStop => ({ offset: o, color: '#000', opacity: +(depth * 0.42).toFixed(3) });
  const day = (o: number): ShadeStop => ({ offset: o, color: '#fff', opacity: 0.038 });
  return [
    night(0), night(pc(sr - 125)), dusk(pc(sr - 30)), day(pc(sr + 75)),
    day(pc(ss - 75)), dusk(pc(ss + 30)), night(pc(ss + 125)), night(1),
  ];
}

/* ---------- block metrics ---------- */

export interface BlockFlags {
  /** pixel height / width of the block */
  h: number;
  w: number;
  week: boolean;
  dense: boolean;
  part: Seg['part'];
  /** event ended and is still unconfirmed, scheduled ahead of time */
  needsConfirm: boolean;
  hasWin: boolean;
  isPublic: boolean;
  month?: boolean;
}

export interface BlockMetrics {
  minH: number;
  canResize: boolean;
  canTop: boolean;
  canBottom: boolean;
  showCheck: boolean;
  showMeta: boolean;
  showGrip: boolean;
  /** public globe: bottom right, blocks of 40px or more, never in month view */
  showPublicGlyph: boolean;
  titleLines: number;
  titleSize: number;
  titleLine: number;
}

export const minBlockH = (week: boolean, dense: boolean): number => (week ? 15 : dense ? 13 : 22);

/** Everything a block decides from its size: handles, tick, meta line, glyph, title lines. */
export function blockMetrics(f: BlockFlags): BlockMetrics {
  const { h, w, week, dense } = f;
  const small = week || dense;
  const lh = small ? 11 : 13.5;
  const avail = h - (small ? 2 : 4) - 2 - (!week && h >= 40 ? 14 : 0);
  const canResize = h >= 26;
  return {
    minH: minBlockH(week, dense),
    canResize,
    canTop: canResize && f.part !== 'second',
    canBottom: canResize && f.part !== 'first',
    showCheck: f.needsConfirm && h >= 17 && w >= 42 && f.part !== 'first',
    showMeta: !week && h >= 40,
    showGrip: h >= 34 && !week,
    showPublicGlyph: f.isPublic && !f.month && h >= 40,
    titleLines: Math.max(1, Math.floor((avail + 0.6) / lh)),
    titleSize: small ? 10.5 : 12,
    titleLine: lh,
  };
}

/** The "9–10:30" meta text under a title; `worked` appends the tracked time. */
export const metaText = (fullStart: number, fullEnd: number, fmtShort: (m: number) => string, workedLabel?: string): string =>
  fmtShort(fullStart) + '–' + fmtShort(fullEnd) + (workedLabel ? ' · ' + workedLabel : '');

export const dowLabel = (d: Date, week: boolean): string => (week ? DOW[d.getDay()][0] : DOW[d.getDay()]);

export const monthShort = (d: Date): string => MON[d.getMonth()];
