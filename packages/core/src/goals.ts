/**
 * Goal maths. In the prototype these were methods reading `this.state`; here
 * every function takes its inputs (events, goals, today, nowMin, timer) explicitly.
 *
 * A goal spreads `hours` evenly from the day it was set to the end of its
 * deadline day. Only sessions in the goal's category (or linked/titled after
 * it) that are marked done count towards it.
 */
import { addDays, clamp, dnum, dur, endOfPeriod, fmtDur, hrs, key, MON, weekKey } from './time.ts';
import { SPARE, spareHue } from './categories.ts';
import type { CatMap } from './categories.ts';
import type { ProtoEvent, ProtoGoal } from './model.ts';
import { isTiming, workedMins } from './timer.ts';
import type { TimerCtx } from './timer.ts';
import { PACE } from './tokens.ts';

/** What "now" is, supplied by the caller. */
export interface NowCtx {
  /** local midnight of today */
  today: Date;
  /** minutes past midnight right now */
  nowMin: number;
  /** epoch ms right now (needed for a running timer / pending checks) */
  nowMs?: number;
  /** the running timer, if any */
  timer?: TimerCtx | null;
}

const DAY_MS = 86400000;

export const goalById = (goals: ReadonlyArray<ProtoGoal> | null | undefined, id: string | null | undefined): ProtoGoal | null =>
  (goals || []).find((g) => g.id === id) || null;

/** A goal runs from the day it was set to the end of its deadline day. */
export const goalSpan = (g: ProtoGoal, today: Date): { s0: Date; s1: Date } => {
  const s0 = dnum(g.start || key(today));
  let s1 = g.deadline ? addDays(dnum(g.deadline), 1) : endOfPeriod(g.scope || 'week', s0);
  if (!(s1.getTime() > s0.getTime())) s1 = addDays(s0, 1);
  return { s0, s1 };
};

const norm = (s: unknown): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** An event counts toward a goal if it is in the goal's category, linked by id, or titled after the goal. */
export const evInGoal = (e: ProtoEvent | null | undefined, g: ProtoGoal | null | undefined): boolean => {
  if (!e || !g) return false;
  if (e.goalId === g.id || e.cat === g.cat) return true;
  const t = norm(e.title);
  if (t.length < 4) return false;
  return [norm(g.title), norm(g.cat)].some((x) => x && (x === t || x.indexOf(t + ' ') === 0));
};

/** The first goal an event counts toward. */
export const goalOf = (e: ProtoEvent, goals: ReadonlyArray<ProtoGoal> | null | undefined): ProtoGoal | null =>
  (goals || []).find((g) => evInGoal(e, g)) || null;

/** Hours of work for a goal on one day, relative to the goal's *total* hours (the prototype's per-day pill). */
export const dayGoalStat = (
  g: ProtoGoal, dk: string, events: ReadonlyArray<ProtoEvent>, timer?: TimerCtx | null,
): { done: number; target: number; pct: number } => {
  let h = 0;
  events.forEach((e) => {
    if (e.allDay || e.day !== dk || !evInGoal(e, g)) return;
    h += workedMins(e, null, timer) / 60;
  });
  const target = Math.max(0, Number(g.hours) || 0);
  return { done: h, target, pct: target ? clamp(h / target, 0, 1) : 0 };
};

/** Hours worked on a goal in `[a, b)`; `doneOnly` skips sessions not yet done (a running timer counts as done). */
export const goalHours = (
  g: ProtoGoal, a: Date, b: Date, events: ReadonlyArray<ProtoEvent>, doneOnly?: boolean, timer?: TimerCtx | null,
): number => {
  let h = 0;
  events.forEach((e) => {
    if (e.allDay || (doneOnly && !e.done && !isTiming(e, timer)) || !evInGoal(e, g)) return;
    const d = dnum(e.day);
    if (d.getTime() < a.getTime() || d.getTime() >= b.getTime()) return;
    h += workedMins(e, null, timer) / 60;
  });
  return h;
};

export interface GoalRate {
  /** days in the goal's span (at least 1) */
  total: number;
  /** hours estimate */
  target: number;
  perDay: number;
  perWeek: number;
  /** pace is shown per day for goals of three weeks or less, else per week */
  unit: 'day' | 'week';
  per: number;
  /** "45m a day" / "5h a week" */
  label: string;
}

/** Fixed pace: the estimate spread evenly from the day it was set to the deadline. */
export const goalRate = (g: ProtoGoal, today: Date): GoalRate => {
  const sp = goalSpan(g, today);
  const total = Math.max(1, Math.round((sp.s1.getTime() - sp.s0.getTime()) / DAY_MS));
  const target = Math.max(0, Number(g.hours) || 0);
  const perDay = target / total, perWeek = perDay * 7;
  const unit = total <= 21 ? 'day' : 'week';
  return { total, target, perDay, perWeek, unit, per: unit === 'day' ? perDay : perWeek, label: unit === 'day' ? dur(perDay) + ' a day' : dur(perWeek) + ' a week' };
};

/**
 * A number that changes whenever the hours booked/done against a goal change
 * (done hours weigh 1000x so a tick-off registers even when the total is flat).
 * Used to pulse goals whose progress moved.
 */
export const goalLoad = (g: ProtoGoal, events: ReadonlyArray<ProtoEvent>, today: Date, timer?: TimerCtx | null): number => {
  const sp = goalSpan(g, today);
  return goalHours(g, sp.s0, sp.s1, events, false, timer) + 1000 * goalHours(g, sp.s0, sp.s1, events, true, timer);
};

/** Ids of goals whose load differs between two event lists. */
export const changedGoalIds = (
  goals: ReadonlyArray<ProtoGoal>, prev: ReadonlyArray<ProtoEvent>, next: ReadonlyArray<ProtoEvent>, today: Date, timer?: TimerCtx | null,
): string[] =>
  goals.filter((g) => Math.abs(goalLoad(g, next, today, timer) - goalLoad(g, prev, today, timer)) > 0.001).map((g) => g.id);

export interface GoalStats {
  target: number;
  /** hours done (ticked off or being timed) */
  done: number;
  /** hours booked but not yet done */
  booked: number;
  /** sessions counted */
  count: number;
  total: number;
  elapsed: number;
  daysLeft: number;
  remain: number;
  /** fraction of the span elapsed (0..1) */
  frac: number;
  s0: Date;
  s1: Date;
  /** today is within the span */
  active: boolean;
  rate: GoalRate;
  pct: number;
  bookedPct: number;
  expected: number;
  /** done minus expected, in hours: negative is behind */
  delta: number;
  perDay: number;
  perWeek: number;
}

export const goalStats = (g: ProtoGoal, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): GoalStats => {
  const today = ctx.today;
  const sp = goalSpan(g, today), s0 = sp.s0, s1 = sp.s1, R = goalRate(g, today);
  let done = 0, booked = 0, n = 0;
  events.forEach((e) => {
    if (e.allDay || !evInGoal(e, g)) return;
    const d = dnum(e.day);
    if (d.getTime() < s0.getTime() || d.getTime() >= s1.getTime()) return;
    const h = workedMins(e, null, ctx.timer) / 60;
    if (!h) return;
    n++;
    if (e.done || isTiming(e, ctx.timer)) done += h; else booked += h;
  });
  const target = R.target, total = R.total, t = today.getTime();
  const elapsed = clamp(Math.round((t - s0.getTime()) / DAY_MS), 0, total);
  const inPeriod = t >= s0.getTime() && t < s1.getTime();
  const frac = t < s0.getTime() ? 0 : clamp((elapsed + (inPeriod ? ctx.nowMin / 1440 : 1)) / total, 0, 1);
  const daysLeft = Math.max(0, total - elapsed);
  const remain = Math.max(0, target - done);
  return {
    target, done, booked, count: n, total, elapsed, daysLeft, remain, frac, s0, s1, active: inPeriod, rate: R,
    pct: target ? clamp(done / target, 0, 1) : 0,
    bookedPct: target ? clamp((done + booked) / target, 0, 1) : 0,
    expected: target * frac,
    delta: done - target * frac,
    perDay: R.perDay, perWeek: R.perWeek,
  };
};

/** "On pace" / "2h behind" / "Target met" / "No hours set". */
export const goalPace = (_g: ProtoGoal, s: GoalStats): string => {
  if (!s.target) return 'No hours set';
  if (s.done >= s.target) return 'Target met';
  if (Math.abs(s.delta) < 0.25) return 'On pace';
  return hrs(Math.abs(s.delta)) + 'h ' + (s.delta > 0 ? 'ahead' : 'behind');
};

/** Deadline as "6 Dec" (plus the year when it isn't this year). */
export const goalDue = (g: ProtoGoal, today: Date): string => {
  if (!g.deadline) return '';
  const d = dnum(g.deadline);
  return d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '');
};

/** "90h by 6 Dec · 1h a day, 7h a week". */
export const goalMath = (g: ProtoGoal, today: Date): string => {
  const R = goalRate(g, today);
  if (!R.target) return 'No hours set yet';
  return hrs(R.target) + 'h by ' + goalDue(g, today) + ' · ' + dur(R.perDay) + ' a day, ' + dur(R.perWeek) + ' a week';
};

export type PaceTone = 'none' | 'good' | 'warn' | 'bad';
export interface PaceInfo {
  /** "+1h ahead", "On track", "−2h behind", "Complete", "No hours set" */
  word: string;
  /** signed short number for chips: "+1h" / "−2h" (equals `word` when there is no number) */
  num: string;
  tone: PaceTone;
  /** `#rrggbb` for the tone, or null for none */
  color: string | null;
  /** original oklch() string, or null for none */
  colorCss: string | null;
}

/** The pace chip: word, signed number and traffic-light tone. */
export const paceOf = (g: ProtoGoal, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): PaceInfo => {
  const s2 = goalStats(g, events, ctx), R = s2.rate;
  const sg = (v: number) => (v < -0.01 ? '−' : '+') + dur(Math.abs(v));
  const mk = (word: string, tone: PaceTone, num?: string): PaceInfo => ({
    word, num: num == null ? word : num, tone,
    color: tone === 'none' ? null : PACE[tone].hex,
    colorCss: tone === 'none' ? null : PACE[tone].css,
  });
  if (!R.target) return mk('No hours set', 'none');
  if (!s2.active) return s2.done >= R.target - 0.01 ? mk('Complete', 'good', sg(s2.done - R.target)) : mk(dur(R.target - s2.done) + ' short', 'bad', sg(s2.done - R.target));
  const d = s2.delta, ex = s2.expected, tol = Math.max(0.5, ex * 0.1);
  if (d > tol) return mk('+' + dur(d) + ' ahead', 'good', sg(d));
  if (d >= -1 / 60) return mk('On track', 'good', sg(d));
  return mk('−' + dur(-d) + ' behind', d >= -Math.max(1, ex * 0.25) ? 'warn' : 'bad', sg(d));
};

/** Goals whose span contains today. */
export const activeGoals = (goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): ProtoGoal[] =>
  (goals || []).filter((g) => goalStats(g, events, ctx).active);

/** Hours a week across all active goals. */
export const weeklyLoad = (goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): number =>
  activeGoals(goals, events, ctx).reduce((a, g) => a + goalRate(g, ctx.today).perWeek, 0);

/** Goals sorted by deadline (the order the goal list and widget use). */
export const sortGoals = (goals: ReadonlyArray<ProtoGoal>): ProtoGoal[] =>
  (goals || []).slice().sort((a, b) => ((a.deadline || '') < (b.deadline || '') ? -1 : (a.deadline || '') > (b.deadline || '') ? 1 : 0));

/** "12 days left" / "Ended" for the goal header. */
export const daysLeftLabel = (s: GoalStats, today: Date): string =>
  !s.active && today.getTime() >= s.s1.getTime() ? 'Ended' : s.daysLeft + (s.daysLeft === 1 ? ' day left' : ' days left');

/** Compact version: weeks once there are 14+ days left. */
export const leftShortLabel = (s: GoalStats, today: Date): string =>
  !s.active && today.getTime() >= s.s1.getTime() ? 'Ended' : s.daysLeft >= 14 ? Math.round(s.daysLeft / 7) + ' weeks left' : s.daysLeft + (s.daysLeft === 1 ? ' day left' : ' days left');

/** "2h to go · 20m a day to finish" / "Target met". */
export const toGoLabel = (s: GoalStats): string =>
  !s.rate.target ? '—'
    : s.done >= s.rate.target ? 'Target met'
      : dur(Math.max(0, s.rate.target - s.done)) + ' to go' + (s.active && s.daysLeft > 0 ? ' · ' + dur((s.rate.target - s.done) / s.daysLeft) + ' a day to finish' : '');

/* ---------- today's goal progress (goal chips and the home-screen widget) ---------- */

export interface GoalToday {
  id: string;
  title: string;
  hue: number;
  /** hours the goal needs today. Day-paced goals: perDay. Week-paced: what is left of this week's pace spread over the days left. */
  todayNeed: number;
  /** hours already done today (the running timer counts) */
  todayDone: number;
  /** hours still needed today (never negative) */
  leftHours: number;
  /** less than a minute left */
  doneToday: boolean;
  /** "45m left today" / "Done today" */
  label: string;
  /** just the duration, "45m" / "1h 5m", or "Done" */
  left: string;
  /** progress ring fill, 0..1 (a goal with no need today is full) */
  ring: number;
  /** hours of the goal still to do overall (target minus done, never negative) */
  totalLeft: number;
  /** `dur()` text of totalLeft: "12h", "45m" */
  totalLeftLabel: string;
  target: number;
}

/** One goal's progress for today. */
export const goalToday = (g: ProtoGoal, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): GoalToday => {
  const today = ctx.today, tm = ctx.timer;
  const R = goalRate(g, today), sp = goalSpan(g, today);
  const wk0 = dnum(weekKey(today));
  let a = R.unit === 'day' ? today : wk0;
  let b = R.unit === 'day' ? addDays(today, 1) : addDays(wk0, 7);
  if (a.getTime() < sp.s0.getTime()) a = sp.s0;
  if (b.getTime() > sp.s1.getTime()) b = sp.s1;
  const t0 = today, t1 = addDays(today, 1);
  const gotT = t1.getTime() > sp.s0.getTime() && t0.getTime() < sp.s1.getTime()
    ? goalHours(g, t0.getTime() < sp.s0.getTime() ? sp.s0 : t0, t1.getTime() > sp.s1.getTime() ? sp.s1 : t1, events, true, tm)
    : 0;
  let need = R.per || 0;
  if (R.unit !== 'day') {
    const before = t0.getTime() > a.getTime() ? goalHours(g, a, t0, events, true, tm) : 0;
    const daysLeft = Math.max(1, Math.round((b.getTime() - t0.getTime()) / DAY_MS));
    need = Math.max(0, (R.per || 0) - before) / daysLeft;
  }
  const leftH = Math.max(0, need - gotT);
  const doneToday = leftH < 1 / 60;
  const s = goalStats(g, events, ctx);
  const totalLeft = Math.max(0, R.target - s.done);
  return {
    id: g.id, title: g.title, hue: g.hue,
    todayNeed: need, todayDone: gotT, leftHours: leftH, doneToday,
    label: doneToday ? 'Done today' : fmtDur(Math.round(leftH * 60)) + ' left today',
    left: doneToday ? 'Done' : fmtDur(Math.round(leftH * 60)),
    ring: clamp(need ? gotT / need : 1, 0, 1),
    totalLeft, totalLeftLabel: dur(totalLeft), target: R.target,
  };
};

/** All goals' progress for today, ordered by deadline (what the goal chips and the widget list). */
export const goalsToday = (goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx): GoalToday[] =>
  sortGoals(goals).map((g) => goalToday(g, events, ctx));

/** Goals that are behind pace and still have days left, worst first. */
export const behindGoals = (
  goals: ReadonlyArray<ProtoGoal>, events: ReadonlyArray<ProtoEvent>, ctx: NowCtx,
): Array<{ g: ProtoGoal; s: GoalStats }> =>
  activeGoals(goals, events, ctx).map((g) => ({ g, s: goalStats(g, events, ctx) }))
    .filter((x) => x.s.target && x.s.delta < -0.5 && x.s.daysLeft > 0)
    .sort((a, b) => a.s.delta - b.s.delta);

/* ---------- creating goals ---------- */

export interface GoalPatch {
  title?: string;
  outcome?: string;
  /** `YYYY-MM-DD` */
  deadline?: string;
  hours?: number;
  hue?: number;
}

export interface SeedCtx {
  today: Date;
  /** categories at the time of creation (used to pick an unused hue) */
  cats: CatMap;
  /** goals already set (hue fallback rotates by this) */
  goalCount: number;
  nowMs: number;
  /** returns a number in [0, 1) */
  random: () => number;
}

/** Id for a new goal: "g" + base36 clock + base36 random. */
export const newGoalId = (nowMs: number, random: () => number): string =>
  'g' + nowMs.toString(36) + Math.round(random() * 1e4).toString(36);

/**
 * A complete goal from a partial one: trimmed title (or "New goal"), the title
 * as its category, a deadline that is today or later (else 27 days out), hours
 * floored at 0, starting today, and the first spare hue.
 */
export const newGoalSeed = (patch: GoalPatch | null | undefined, ctx: SeedCtx): ProtoGoal => {
  patch = patch || {};
  const title = String(patch.title || '').trim() || 'New goal';
  const free = spareHue(ctx.cats);
  const dl = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.deadline || '')) && dnum(patch.deadline as string).getTime() >= ctx.today.getTime()
    ? (patch.deadline as string) : key(addDays(ctx.today, 27));
  return {
    id: newGoalId(ctx.nowMs, ctx.random),
    title, cat: title, outcome: String(patch.outcome || '').trim(), deadline: dl,
    hours: Math.max(0, Number(patch.hours) || 0),
    start: key(ctx.today),
    hue: patch.hue != null ? patch.hue : (free != null ? free : SPARE[ctx.goalCount % SPARE.length]),
    at: ctx.nowMs,
  };
};

/* ---------- free time ---------- */

/**
 * First gap on a day that fits a block of `mins`. Today starts at the next
 * quarter hour (not before 07:00), other days at 09:00. Falls back to the end
 * of the day, clamped between 06:00 and `23:00 - mins`.
 */
export const freeSlot = (
  events: ReadonlyArray<ProtoEvent>, dk: string, mins: number, ctx: { today: Date; nowMin: number },
): number => {
  const taken = events.filter((e) => e.day === dk && !e.allDay).map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  let t = dk === key(ctx.today) ? Math.max(420, Math.ceil(ctx.nowMin / 15) * 15) : 540;
  for (let i = 0; i < taken.length; i++) {
    if (taken[i][1] <= t) continue;
    if (taken[i][0] - t >= mins) return t;
    t = Math.max(t, taken[i][1]);
  }
  return clamp(t, 360, Math.max(360, 1380 - mins));
};
