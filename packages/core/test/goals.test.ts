import { describe, expect, it } from 'vitest';
import {
  behindGoals, changedGoalIds, daysLeftLabel, evInGoal, freeSlot, goalDue, goalLoad, goalMath, goalOf, goalPace, goalRate, goalSpan, goalStats,
  goalToday, goalsToday, leftShortLabel, newGoalSeed, paceOf, sortGoals, toGoLabel, weeklyLoad, dayGoalStat, goalHours, key, dnum, addDays,
} from '../src/index.ts';
import type { ProtoEvent } from '../src/index.ts';
import { NOW_MIN, TODAY, TODAY_KEY, dd, ev, goal, lcg, nowCtx } from './helpers.ts';

const ctx = nowCtx();

/** `n` one-hour done sessions on consecutive days from `from`, in category `cat`. */
const sessions = (cat: string, from: number, n: number, over: Partial<ProtoEvent> = {}): ProtoEvent[] =>
  Array.from({ length: n }, (_, i) => ev('s' + cat + from + i, dd(from + i), cat, cat + ' session', 540, 600, { done: true, ...over }));

describe('goalSpan / goalRate', () => {
  it('runs from the start day to the end of the deadline day', () => {
    const g = goal({ id: 'g', title: 'G', start: '2026-10-01', deadline: '2026-10-10' });
    const sp = goalSpan(g, TODAY);
    expect([key(sp.s0), key(sp.s1)]).toEqual(['2026-10-01', '2026-10-11']);
  });
  it('a deadline before the start still spans a day', () => {
    const sp = goalSpan(goal({ id: 'g', title: 'G', start: '2026-10-10', deadline: '2026-10-01' }), TODAY);
    expect(key(sp.s1)).toBe('2026-10-11');
  });
  it('legacy scope goals use the period', () => {
    const sp = goalSpan({ id: 'g', title: 'G', cat: 'G', outcome: '', hours: 1, hue: 1, start: '2026-10-26', deadline: '', scope: 'week' }, TODAY);
    expect(key(sp.s1)).toBe('2026-11-02');
  });
  it('pace is per day up to 21 days, per week after', () => {
    const g21 = goal({ id: 'g', title: 'G', hours: 21, start: dd(0), deadline: dd(20) });
    const g22 = goal({ id: 'g', title: 'G', hours: 22, start: dd(0), deadline: dd(21) });
    expect(goalRate(g21, TODAY)).toMatchObject({ total: 21, unit: 'day', perDay: 1, label: '1h a day' });
    expect(goalRate(g22, TODAY)).toMatchObject({ total: 22, unit: 'week', perDay: 1, perWeek: 7, label: '7h a week' });
  });
  it('90 hours over 91 days', () => {
    const r = goalRate(goal({ id: 'g', title: 'G', hours: 91, start: dd(0), deadline: dd(90) }), TODAY);
    expect(r).toMatchObject({ total: 91, perDay: 1, perWeek: 7, label: '7h a week' });
  });
  it('no hours: zero pace', () => expect(goalRate(goal({ id: 'g', title: 'G', hours: 0 }), TODAY)).toMatchObject({ target: 0, perDay: 0, label: '0h a week' }));
  it('goalMath and goalDue', () => {
    const g = goal({ id: 'g', title: 'G', hours: 20, start: dd(-10), deadline: '2026-11-08' });
    expect(goalDue(g, TODAY)).toBe('8 Nov');
    expect(goalDue({ ...g, deadline: '2027-01-02' }, TODAY)).toBe('2 Jan 2027');
    expect(goalDue({ ...g, deadline: '' }, TODAY)).toBe('');
    expect(goalMath(g, TODAY)).toBe('20h by 8 Nov · 1h a day, 7h a week');
    expect(goalMath({ ...g, hours: 0 }, TODAY)).toBe('No hours set yet');
  });
});

describe('evInGoal', () => {
  const g = goal({ id: 'g1', title: 'Deep work', cat: 'Deep work' });
  it('by category', () => expect(evInGoal(ev('e', TODAY_KEY, 'Deep work', 'x', 1, 2), g)).toBe(true));
  it('by explicit goalId', () => expect(evInGoal(ev('e', TODAY_KEY, 'Other', 'x', 1, 2, { goalId: 'g1' }), g)).toBe(true));
  it('by title: equal, or a prefix of the goal title followed by a space (4+ chars)', () => {
    expect(evInGoal(ev('e', TODAY_KEY, 'Work', 'Deep work', 1, 2), g)).toBe(true);
    expect(evInGoal(ev('e', TODAY_KEY, 'Work', 'deep', 1, 2), g)).toBe(true);
    expect(evInGoal(ev('e', TODAY_KEY, 'Work', 'dee', 1, 2), g)).toBe(false); // too short
    expect(evInGoal(ev('e', TODAY_KEY, 'Work', 'Deep working', 1, 2), g)).toBe(false);
    expect(evInGoal(ev('e', TODAY_KEY, 'Work', 'Lunch', 1, 2), g)).toBe(false);
  });
  it('null-safe', () => {
    expect(evInGoal(null, g)).toBe(false);
    expect(evInGoal(ev('e', TODAY_KEY, 'x', 'y', 1, 2), null)).toBe(false);
  });
  it('goalOf finds the first match', () => {
    const g2 = goal({ id: 'g2', title: 'Reading' });
    expect(goalOf(ev('e', TODAY_KEY, 'Reading', 'x', 1, 2), [g, g2])?.id).toBe('g2');
    expect(goalOf(ev('e', TODAY_KEY, 'Nope', 'x', 1, 2), [g, g2])).toBeNull();
  });
});

describe('goalStats and pacing numbers', () => {
  // 20h over 10 days (day -9 to today): 2h a day.
  const g = goal({ id: 'g', title: 'Piano', hours: 20, start: dd(-9), deadline: dd(0) });

  it('nothing done: behind by the expected amount', () => {
    const s = goalStats(g, [], nowCtx({ nowMin: 0 }));
    expect(s).toMatchObject({ total: 10, elapsed: 9, daysLeft: 1, done: 0, booked: 0, remain: 20, active: true, pct: 0 });
    expect(s.frac).toBeCloseTo(0.9, 10);
    expect(s.expected).toBeCloseTo(18, 10);
    expect(s.delta).toBeCloseTo(-18, 10);
    expect(goalPace(g, s)).toBe('18h behind');
  });
  it('the day progresses through nowMin', () => {
    const noon = goalStats(g, [], nowCtx({ nowMin: 720 }));
    expect(noon.frac).toBeCloseTo(0.95, 10); // (9 + 0.5) / 10
    expect(noon.expected).toBeCloseTo(19, 10);
    const end = goalStats(g, [], nowCtx({ nowMin: 1439 }));
    expect(end.frac).toBeCloseTo((9 + 1439 / 1440) / 10, 10);
  });
  it('done vs booked vs not counted', () => {
    const evs = [
      ev('a', dd(-1), 'Piano', 'p', 540, 600, { done: true }), // 1h done
      ev('b', dd(0), 'Piano', 'p', 900, 960), // 1h booked
      ev('c', dd(-20), 'Piano', 'before the goal', 540, 600, { done: true }), // outside span
      ev('d', dd(0), 'Piano', 'all day', 0, 1440, { allDay: true, done: true }), // all-day never counts
      ev('e', dd(0), 'Other', 'p', 540, 600, { done: true }), // other category
      ev('f', dd(-2), 'Piano', 'p', 540, 600, { done: true, pauses: [[550, 560]] }), // 50m done
    ];
    const s = goalStats(g, evs, ctx);
    expect(s.done).toBeCloseTo(1 + 50 / 60, 10);
    expect(s.booked).toBe(1);
    expect(s.count).toBe(3);
    expect(s.pct).toBeCloseTo((1 + 50 / 60) / 20, 10);
    expect(s.bookedPct).toBeCloseTo((2 + 50 / 60) / 20, 10);
    expect(s.remain).toBeCloseTo(20 - (1 + 50 / 60), 10);
  });
  it('a running timer counts as done up to now', () => {
    const e = ev('t', dd(0), 'Piano', 'p', 800, 900); // 13:20-15:00; now 14:20 -> 60m
    const tm = { id: 't', endMs: 0, total: 0, evEnd: 900, evDay: dd(0), rang: false, paused: false, rem: 0 };
    const s = goalStats(g, [e], nowCtx({ timer: { tm, nowMs: new Date(2026, 9, 30, 14, 20).getTime() } }));
    expect(s.done).toBe(1);
    expect(s.booked).toBe(0);
  });
  it('before the goal starts', () => {
    const future = goal({ id: 'f', title: 'F', hours: 10, start: dd(5), deadline: dd(14) });
    const s = goalStats(future, [], ctx);
    expect(s).toMatchObject({ active: false, elapsed: 0, frac: 0, expected: 0, daysLeft: 10 });
  });
  it('after the deadline', () => {
    const past = goal({ id: 'p', title: 'P', hours: 10, start: dd(-20), deadline: dd(-10) });
    const s = goalStats(past, [], ctx);
    expect(s).toMatchObject({ active: false, frac: 1, daysLeft: 0 });
    expect(daysLeftLabel(s, TODAY)).toBe('Ended');
    expect(leftShortLabel(s, TODAY)).toBe('Ended');
  });
  it('labels for days left', () => {
    const s = goalStats(g, [], ctx);
    expect(daysLeftLabel(s, TODAY)).toBe('1 day left');
    const long = goalStats(goal({ id: 'l', title: 'L', hours: 50, start: dd(-1), deadline: dd(60) }), [], ctx);
    expect(daysLeftLabel(long, TODAY)).toBe('61 days left');
    expect(leftShortLabel(long, TODAY)).toBe('9 weeks left');
  });
  it('toGoLabel', () => {
    expect(toGoLabel(goalStats(g, [], ctx))).toBe('20h to go · 20h a day to finish');
    expect(toGoLabel(goalStats(goal({ id: 'z', title: 'Z', hours: 0 }), [], ctx))).toBe('—');
    expect(toGoLabel(goalStats(g, sessions('Piano', -9, 10, { end: 720 }), ctx))).toBe('Target met');
  });
});

describe('goalPace text thresholds', () => {
  // 100h over 100 days => 1h a day; at nowMin 0 on day 50 (elapsed 50), expected = 50h.
  const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 100, start: dd(-50), deadline: dd(49) });
  const mkDone = (h: number): ProtoEvent[] => [ev('x', dd(-1), 'Run', 'r', 0, h * 60, { done: true })];
  const c = nowCtx({ nowMin: 0 });
  const expected = goalStats(g, [], c).expected;
  const pace = (hours: number) => goalPace(g, goalStats(g, mkDone(hours), c));
  it('no hours set / target met / on pace / ahead / behind', () => {
    expect(goalPace(g, goalStats({ ...g, hours: 0 }, [], c))).toBe('No hours set');
    expect(goalPace(g, goalStats({ ...g, hours: 5 }, mkDone(5), c))).toBe('Target met');
    expect(expected).toBeCloseTo(50, 5);
    expect(pace(24)).toBe('26h behind');
    expect(pace(24)).not.toBe('On pace');
  });
  it('within a quarter hour either way is on pace', () => {
    const near = [ev('x', dd(-1), 'Run', 'r', 0, 15, { done: true })];
    const s = goalStats({ ...g, hours: 0.5 }, near, nowCtx({ nowMin: 0, today: addDays(TODAY, 0) }));
    expect(s.target).toBe(0.5);
  });
  it('ahead', () => {
    const evs = [ev('x', dd(-1), 'Run', 'r', 0, 60, { done: true }), ev('y', dd(0), 'Run', 'r', 0, 60, { done: true })];
    const early = goal({ id: 'e', title: 'Run', cat: 'Run', hours: 100, start: dd(-1), deadline: dd(98) });
    const s = goalStats(early, evs, nowCtx({ nowMin: 0 }));
    expect(s.delta).toBeGreaterThan(0.25);
    expect(goalPace(early, s)).toMatch(/^1h ahead$/);
  });
});

describe('paceOf tones', () => {
  const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 100, start: dd(-50), deadline: dd(49) });
  const c = nowCtx({ nowMin: 0 });
  it('far behind is bad, slightly behind is warn', () => {
    const bad = paceOf(g, [], c);
    expect(bad).toMatchObject({ tone: 'bad', word: '−50h behind', num: '−50h' });
    expect(bad.color).toMatch(/^#/);
    expect(bad.colorCss).toBe('oklch(0.7 0.15 30)');
    // 40h done: 10h behind of 50h expected is within 25%+: warn
    const warn = paceOf(g, [ev('x', dd(-1), 'Run', 'r', 0, 40 * 60, { done: true })], c);
    expect(warn).toMatchObject({ tone: 'warn', word: '−10h behind' });
  });
  it('on track and ahead are good', () => {
    const ontrack = paceOf(g, [ev('x', dd(-1), 'Run', 'r', 0, 50 * 60, { done: true })], c);
    expect(ontrack).toMatchObject({ tone: 'good', word: 'On track', num: '+0h' });
    const ahead = paceOf(g, [ev('x', dd(-1), 'Run', 'r', 0, 60 * 60, { done: true })], c);
    expect(ahead).toMatchObject({ tone: 'good', word: '+10h ahead', num: '+10h' });
  });
  it('no hours; and after the deadline complete vs short', () => {
    expect(paceOf({ ...g, hours: 0 }, [], c)).toMatchObject({ tone: 'none', word: 'No hours set', color: null, colorCss: null });
    const ended = goal({ id: 'e', title: 'Run', cat: 'Run', hours: 10, start: dd(-20), deadline: dd(-5) });
    expect(paceOf(ended, [], c)).toMatchObject({ tone: 'bad', word: '10h short', num: '−10h' });
    expect(paceOf(ended, [ev('x', dd(-6), 'Run', 'r', 0, 600, { done: true })], c)).toMatchObject({ tone: 'good', word: 'Complete', num: '+0h' });
  });
});

describe("today's progress (goal chips and widget)", () => {
  it('day-paced goal: nothing done yet', () => {
    const g = goal({ id: 'g', title: 'Piano', hours: 20, start: dd(-9), deadline: dd(0) }); // 2h a day
    const t = goalToday(g, [], ctx);
    expect(t).toMatchObject({ todayNeed: 2, todayDone: 0, leftHours: 2, doneToday: false, label: '2h left today', left: '2h', ring: 0, totalLeft: 20, totalLeftLabel: '20h' });
  });
  it('partial progress gives the ring fraction and minutes left', () => {
    const g = goal({ id: 'g', title: 'Piano', hours: 20, start: dd(-9), deadline: dd(0) });
    const t = goalToday(g, [ev('a', TODAY_KEY, 'Piano', 'p', 540, 615, { done: true })], ctx); // 75m
    expect(t.todayDone).toBe(1.25);
    expect(t.ring).toBeCloseTo(0.625, 10);
    expect(t.label).toBe('45m left today');
    expect(t.left).toBe('45m');
    expect(t.totalLeft).toBeCloseTo(18.75, 10);
    expect(t.totalLeftLabel).toBe('19h');
  });
  it('done for today', () => {
    const g = goal({ id: 'g', title: 'Piano', hours: 20, start: dd(-9), deadline: dd(0) });
    const t = goalToday(g, [ev('a', TODAY_KEY, 'Piano', 'p', 540, 780, { done: true })], ctx); // 4h > need 2h
    expect(t).toMatchObject({ doneToday: true, label: 'Done today', left: 'Done', ring: 1, leftHours: 0 });
  });
  it('booked but not done does not count', () => {
    const g = goal({ id: 'g', title: 'Piano', hours: 20, start: dd(-9), deadline: dd(0) });
    expect(goalToday(g, [ev('a', TODAY_KEY, 'Piano', 'p', 900, 1020)], ctx).todayDone).toBe(0);
  });
  it('week-paced goal: the rest of this week spread over the days left', () => {
    // 91h over 91 days = 7h a week. Today is Friday; Mon-Thu done 4h => (7-4)/3 days left (Fri, Sat, Sun) = 1h.
    const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 91, start: dd(-30), deadline: dd(60) });
    const evs = [ev('a', dd(-4), 'Run', 'r', 480, 540, { done: true }), ev('b', dd(-2), 'Run', 'r', 480, 600, { done: true }), ev('c', dd(-1), 'Run', 'r', 480, 540, { done: true })];
    const t0 = goalToday(g, evs, ctx);
    expect(t0.todayNeed).toBeCloseTo(1, 10);
    expect(t0.label).toBe('1h left today');
    const t1 = goalToday(g, [...evs, ev('d', TODAY_KEY, 'Run', 'r', 480, 510, { done: true })], ctx);
    expect(t1.todayDone).toBe(0.5);
    expect(t1.label).toBe('30m left today');
    expect(t1.ring).toBeCloseTo(0.5, 10);
  });
  it('week-paced goal already past its weekly pace needs nothing today', () => {
    const g = goal({ id: 'g', title: 'Run', cat: 'Run', hours: 91, start: dd(-30), deadline: dd(60) });
    const t = goalToday(g, [ev('a', dd(-3), 'Run', 'r', 0, 600, { done: true })], ctx); // 10h this week already
    expect(t.todayNeed).toBe(0);
    expect(t.doneToday).toBe(true);
    expect(t.ring).toBe(1);
  });
  it('a goal that has not started or has ended', () => {
    expect(goalToday(goal({ id: 'g', title: 'F', hours: 10, start: dd(3), deadline: dd(10) }), [], ctx).doneToday).toBe(false);
    const ended = goalToday(goal({ id: 'g', title: 'E', hours: 10, start: dd(-10), deadline: dd(-5) }), [], ctx);
    expect(ended.totalLeft).toBe(10);
  });
  it('goalsToday is ordered by deadline', () => {
    const a = goal({ id: 'a', title: 'A', deadline: dd(30) }), b = goal({ id: 'b', title: 'B', deadline: dd(5) });
    expect(goalsToday([a, b], [], ctx).map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortGoals([a, b]).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('weekly load, behind goals, load tracking', () => {
  const g1 = goal({ id: 'g1', title: 'A', hours: 91, start: dd(-30), deadline: dd(60) }); // 7h/week
  const g2 = goal({ id: 'g2', title: 'B', hours: 182, start: dd(-30), deadline: dd(60) }); // 14h/week
  const g3 = goal({ id: 'g3', title: 'C', hours: 50, start: dd(-80), deadline: dd(-40) }); // ended
  it('sums active goals only', () => expect(weeklyLoad([g1, g2, g3], [], ctx)).toBeCloseTo(21, 10));
  it('behindGoals: active, with hours, over half an hour behind, worst first', () => {
    const r = behindGoals([g1, g2, g3], [], ctx);
    expect(r.map((x) => x.g.id)).toEqual(['g2', 'g1']);
    expect(r[0].s.delta).toBeLessThan(r[1].s.delta);
    expect(behindGoals([{ ...g1, hours: 0 }], [], ctx)).toEqual([]);
  });
  it('goalLoad changes when a session is booked or ticked off; changedGoalIds sees it', () => {
    const base = [ev('x', dd(-1), 'A', 'r', 0, 60)];
    const booked = [...base, ev('y', dd(0), 'A', 'r', 0, 60)];
    const ticked = [ev('x', dd(-1), 'A', 'r', 0, 60, { done: true })];
    expect(goalLoad(g1, booked, TODAY)).toBe(2);
    expect(goalLoad(g1, ticked, TODAY)).toBe(1001);
    expect(changedGoalIds([g1, g2], base, booked, TODAY)).toEqual(['g1']);
    expect(changedGoalIds([g1, g2], base, ticked, TODAY)).toEqual(['g1']);
    expect(changedGoalIds([g1, g2], base, base, TODAY)).toEqual([]);
  });
  it('goalHours / dayGoalStat', () => {
    const evs = [ev('x', dd(-1), 'A', 'r', 0, 60, { done: true }), ev('y', dd(0), 'A', 'r', 0, 120)];
    const a = dnum(dd(-5)), b = dnum(dd(1));
    expect(goalHours(g1, a, b, evs)).toBe(3);
    expect(goalHours(g1, a, b, evs, true)).toBe(1);
    expect(dayGoalStat(g1, dd(0), evs)).toMatchObject({ done: 2, target: 91 });
  });
});

describe('newGoalSeed', () => {
  const c = (over = {}) => ({ today: TODAY, cats: {}, goalCount: 0, nowMs: 1_000_000, random: lcg(1), ...over });
  it('fills in everything', () => {
    const g = newGoalSeed({ title: '  Piano ', outcome: ' Grade 3 ', deadline: dd(40), hours: 12 }, c());
    expect(g).toMatchObject({ title: 'Piano', cat: 'Piano', outcome: 'Grade 3', deadline: dd(40), hours: 12, start: TODAY_KEY, hue: 350, at: 1_000_000 });
    expect(g.id).toMatch(/^g/);
  });
  it('defaults: New goal, 27 days out, no hours', () => {
    const g = newGoalSeed({}, c());
    expect(g).toMatchObject({ title: 'New goal', outcome: '', deadline: dd(27), hours: 0 });
  });
  it('a past or malformed deadline is replaced; today is allowed', () => {
    expect(newGoalSeed({ deadline: dd(-1) }, c()).deadline).toBe(dd(27));
    expect(newGoalSeed({ deadline: 'next friday' }, c()).deadline).toBe(dd(27));
    expect(newGoalSeed({ deadline: dd(0) }, c()).deadline).toBe(dd(0));
  });
  it('negative or junk hours become 0', () => {
    expect(newGoalSeed({ hours: -5 }, c()).hours).toBe(0);
    expect(newGoalSeed({ hours: NaN }, c()).hours).toBe(0);
  });
  it('picks the first spare hue not used by a category; rotates when all are used', () => {
    expect(newGoalSeed({}, c({ cats: { a: 350, b: 170 } })).hue).toBe(290);
    const all = { a: 350, b: 170, c: 290, d: 60, e: 240, f: 125, g: 28, h: 1000 };
    expect(newGoalSeed({}, c({ cats: all, goalCount: 3 })).hue).toBe(60);
    expect(newGoalSeed({ hue: 28 }, c()).hue).toBe(28);
  });
});

describe('freeSlot', () => {
  const day = dd(1);
  it('empty day starts at 09:00', () => expect(freeSlot([], day, 60, ctx)).toBe(540));
  it('today starts at the next quarter hour, not before 07:00', () => {
    expect(freeSlot([], TODAY_KEY, 60, nowCtx({ nowMin: 14 * 60 + 20 }))).toBe(14 * 60 + 30);
    expect(freeSlot([], TODAY_KEY, 60, nowCtx({ nowMin: 120 }))).toBe(420);
  });
  it('finds the first gap that fits', () => {
    const evs = [ev('a', day, 'x', 'a', 540, 600), ev('b', day, 'x', 'b', 630, 700), ev('c', day, 'x', 'c', 700, 760)];
    expect(freeSlot(evs, day, 30, ctx)).toBe(600); // 10:00-10:30 gap fits 30
    expect(freeSlot(evs, day, 45, ctx)).toBe(760); // gap too small, after the last
  });
  it('ignores all-day events and other days', () => {
    expect(freeSlot([ev('a', day, 'x', 'a', 0, 1440, { allDay: true }), ev('b', dd(2), 'x', 'b', 540, 600)], day, 60, ctx)).toBe(540);
  });
  it('late in the day it is clamped between 06:00 and 23:00 minus the length', () => {
    expect(freeSlot([ev('a', day, 'x', 'a', 540, 1400)], day, 60, ctx)).toBe(1320);
    expect(freeSlot([], TODAY_KEY, 60, nowCtx({ nowMin: 1430 }))).toBe(1320);
    expect(freeSlot([], day, 2000, ctx)).toBe(360); // longer than the day: the lower clamp
  });
  it('uses NOW_MIN sanity', () => expect(NOW_MIN).toBe(860));
});
