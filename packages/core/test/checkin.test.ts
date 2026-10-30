import { describe, expect, it } from 'vitest';
import {
  CI_FOLLOWUP, applyCheckIn, assembleCheckIn, ciConfirmQs, ciHistory, ciLocalQs, evEndMs, isPending, makeIdGen, normCheckIn, pendingEvents,
  shouldCheckIn, sinceMs, winCands, winQ, winWhen,
} from '../src/index.ts';
import type { CalendarData, CheckInQuestion } from '../src/index.ts';
import { NOW_MS, TODAY, TODAY_KEY, dd, ev, goal, nowCtx } from './helpers.ts';

const lastSeen = NOW_MS - 20 * 3600000;
const ctx = nowCtx();

describe('pending ("did it happen?")', () => {
  it('evEndMs: end of the event as epoch ms; all-day ends at the end of day one', () => {
    expect(evEndMs(ev('e', TODAY_KEY, 'x', 't', 540, 600))).toBe(new Date(2026, 9, 30, 10, 0).getTime());
    expect(evEndMs(ev('e', TODAY_KEY, 'x', 't', 0, 1440, { allDay: true }))).toBe(new Date(2026, 9, 31).getTime());
    expect(evEndMs(ev('e', TODAY_KEY, 'x', 't', 1320, 1920))).toBe(new Date(2026, 9, 31, 8, 0).getTime());
  });
  it('sinceMs: the last session, but at least the last 12 hours', () => {
    expect(sinceMs(0, NOW_MS)).toBe(NOW_MS - 12 * 3600000);
    expect(sinceMs(NOW_MS - 3600000, NOW_MS)).toBe(NOW_MS - 12 * 3600000);
    expect(sinceMs(NOW_MS - 30 * 3600000, NOW_MS)).toBe(NOW_MS - 30 * 3600000);
  });
  it('an unconfirmed event that ended since the last visit is pending', () => {
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 540, 600), NOW_MS, lastSeen)).toBe(true);
  });
  it('not pending: done, all-day, still running, too old, or logged after the fact', () => {
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 540, 600, { done: true }), NOW_MS, lastSeen)).toBe(false);
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 0, 1440, { allDay: true }), NOW_MS, lastSeen)).toBe(false);
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 800, 900), NOW_MS, lastSeen)).toBe(false); // ends 15:00, after now
    expect(isPending(ev('e', dd(-3), 'x', 't', 540, 600), NOW_MS, lastSeen)).toBe(false); // before the window
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 540, 600, { at: NOW_MS - 1000 }), NOW_MS, lastSeen)).toBe(false); // created after it ended
    expect(isPending(ev('e', TODAY_KEY, 'x', 't', 540, 600, { at: NOW_MS - 20 * 3600000 }), NOW_MS, lastSeen)).toBe(true); // created before
    expect(isPending(null, NOW_MS, lastSeen)).toBe(false);
  });
  it('pendingEvents are ordered by end time', () => {
    const evs = [ev('b', TODAY_KEY, 'x', 'b', 600, 660), ev('a', TODAY_KEY, 'x', 'a', 480, 540), ev('c', TODAY_KEY, 'x', 'c', 1000, 1100)];
    expect(pendingEvents(evs, NOW_MS, lastSeen).map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('confirmation questions: the two most recent', () => {
    const evs = [ev('a', TODAY_KEY, 'x', 'Run', 480, 540), ev('b', TODAY_KEY, 'x', 'Read', 600, 660), ev('c', TODAY_KEY, 'x', 'Nap', 700, 760)];
    const qs = ciConfirmQs(evs);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ field: 'confirm', id: 'a', q: 'Run at 08:00 — did that happen?', chips: ['Yes', 'It did, but later', 'Didn’t happen'] });
  });
});

describe('wins', () => {
  const goals = [goal({ id: 'g1', title: 'Novel', cat: 'Novel', outcome: 'Finish draft' })];
  const mk = (id: string, day: string, start: number, end: number, extra = {}) => ev(id, day, 'Novel', 'Novel', start, end, extra);
  it('goal sessions from today or yesterday that ended in the last 30h and have no win', () => {
    const evs = [
      mk('a', TODAY_KEY, 540, 600), // ended
      mk('b', dd(-1), 1320, 1380), // yesterday evening, within 30h
      mk('c', dd(-1), 360, 420), // yesterday 07:00: 31h20 ago
      mk('d', TODAY_KEY, 900, 960), // not ended
      mk('e', TODAY_KEY, 540, 600, { win: { text: 'x', at: 1 } }),
      mk('f', TODAY_KEY, 540, 600, { winAsked: true }),
      mk('g', dd(-2), 540, 600),
      ev('h', TODAY_KEY, 'Other', 'Other', 540, 600),
      mk('i', TODAY_KEY, 0, 1440, { allDay: true }),
    ];
    expect(winCands(evs, goals, TODAY, NOW_MS).map((e) => e.id)).toEqual(['b', 'a']);
  });
  it('only the latest three', () => {
    const evs = [480, 540, 600, 660, 720].map((s, i) => mk('s' + i, TODAY_KEY, s, s + 30));
    expect(winCands(evs, goals, TODAY, NOW_MS).map((e) => e.id)).toEqual(['s2', 's3', 's4']);
  });
  it('winWhen and winQ', () => {
    expect(winWhen(mk('a', TODAY_KEY, 840, 900), TODAY)).toBe('at 14:00');
    expect(winWhen(mk('a', dd(-1), 840, 900), TODAY)).toBe('yesterday at 14:00');
    expect(winWhen(mk('a', '2026-10-27', 840, 900), TODAY)).toBe('on Tue 27 at 14:00');
    expect(winQ(mk('a', TODAY_KEY, 840, 900), TODAY, false)).toEqual({ field: 'win', id: 'a', q: 'What came out of Novel at 14:00?', chips: ['Nothing notable'] });
    expect(winQ(mk('a', TODAY_KEY, 840, 900), TODAY, true).chips).toEqual(['Nothing notable', 'Didn’t happen']);
  });
});

describe('shouldCheckIn', () => {
  const o = { enabled: true, nowMs: NOW_MS, nowMin: 600, today: TODAY, lastCheckIn: 0, lastWinDay: '', winCount: 0 };
  it('after a long gap', () => expect(shouldCheckIn(o)).toBe(true));
  it('not within the 5 hour gap', () => expect(shouldCheckIn({ ...o, lastCheckIn: NOW_MS - 4 * 3600000 })).toBe(false));
  it('off switch', () => expect(shouldCheckIn({ ...o, enabled: false })).toBe(false));
  it('end of day with waiting wins, once a day', () => {
    const eod = { ...o, nowMin: 1100, lastCheckIn: NOW_MS - 3600000, winCount: 2 };
    expect(shouldCheckIn(eod)).toBe(true);
    expect(shouldCheckIn({ ...eod, lastWinDay: TODAY_KEY })).toBe(false);
    expect(shouldCheckIn({ ...eod, nowMin: 1000 })).toBe(false);
    expect(shouldCheckIn({ ...eod, winCount: 0 })).toBe(false);
  });
  it('eodOnly skips the gap rule', () => expect(shouldCheckIn({ ...o, eodOnly: true })).toBe(false));
});

describe('offline check-in questions', () => {
  it('asks about a behind goal first, with hour chips from the daily pace', () => {
    const data: CalendarData = { events: [], cats: {}, goals: [goal({ id: 'g1', title: 'Marathon', hours: 91, start: dd(-30), deadline: dd(60) })] };
    const qs = ciLocalQs(data, ctx);
    expect(qs[0]).toMatchObject({ field: 'goal', id: 'g1', chips: ['1h', '2h', 'Not today'] });
    expect(qs[0].q).toMatch(/^Marathon is \d+(\.\d)?h behind — how much can you put in today\?$/);
  });
  it('a habit seen three times in the last week, usually at a time that has passed', () => {
    const habit = [1, 2, 3].map((i) => ev('h' + i, dd(-i), 'Pets', 'Dog walk', 450 + i, 490));
    const qs = ciLocalQs({ events: habit, cats: {}, goals: [] }, ctx).filter((q) => q.field === 'log');
    expect(qs[0]).toEqual({ field: 'log', q: 'Dog walk — did that happen today?', chips: ['07:30', 'Not today'] }); // average start 07:32 snaps to 07:30
  });
  it('...but not if it is already on today, seen fewer than 3 times, or still in the future', () => {
    const habit = [1, 2, 3].map((i) => ev('h' + i, dd(-i), 'Pets', 'Dog walk', 450, 490));
    expect(ciLocalQs({ events: [...habit, ev('t', TODAY_KEY, 'Pets', 'dog walk', 450, 490)], cats: {}, goals: [] }, ctx).some((q) => /Dog walk/.test(q.q))).toBe(false);
    expect(ciLocalQs({ events: habit.slice(0, 2), cats: {}, goals: [] }, ctx).some((q) => /Dog walk/.test(q.q))).toBe(false);
    const evening = [1, 2, 3].map((i) => ev('e' + i, dd(-i), 'Pets', 'Late walk', 1300, 1340));
    expect(ciLocalQs({ events: evening, cats: {}, goals: [] }, ctx).some((q) => /Late walk/.test(q.q))).toBe(false);
  });
  it('lunch after 13:30 and the morning after 11:00', () => {
    const qs = ciLocalQs({ events: [], cats: {}, goals: [] }, ctx);
    expect(qs.map((q) => q.q)).toEqual(['What did you have for lunch, and when?', 'What did the morning go to?']);
    expect(ciLocalQs({ events: [], cats: {}, goals: [] }, nowCtx({ nowMin: 600 }))).toEqual([]);
    const withLunch = [ev('l', TODAY_KEY, 'Food', 'Lunch', 750, 795), ev('m', TODAY_KEY, 'Work', 'Standup', 540, 560)];
    expect(ciLocalQs({ events: withLunch, cats: {}, goals: [] }, ctx)).toEqual([]);
  });
  it('at most four', () => {
    const habits = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((t, k) => [1, 2, 3].map((i) => ev(t + i, dd(-i), 'x', 'Habit ' + t, 400 + k, 450)));
    expect(ciLocalQs({ events: habits, cats: {}, goals: [] }, ctx)).toHaveLength(4);
  });
  it('ciHistory lists the last seven days only', () => {
    const evs = [ev('a', dd(-1), 'Pets', 'Walk', 450, 490), ev('b', dd(-1), 'Work', 'Plan', 400, 430), ev('c', dd(-8), 'x', 'old', 1, 2), ev('d', dd(0), 'x', 'today', 1, 2), ev('e', dd(-2), 'x', 'All', 0, 1440, { allDay: true })];
    expect(ciHistory(evs, TODAY)).toEqual(['  ' + dd(-2) + ' | all-day All (x)', '  ' + dd(-1) + ' | 06:40 Plan (Work); 07:30 Walk (Pets)']);
  });
});

describe('model check-in replies', () => {
  it('normCheckIn maps fields, chips and ids', () => {
    expect(normCheckIn([
      { field: 'goal', id: 'g1', q: ' Behind? ', chips: ['1h', { label: '2h' }, '', 'Not today', 'extra'] },
      { field: 'win', id: 'e1', question: 'Win?' },
      { field: 'win', q: 'no id' },
      { field: 'intent', id: 'g2', q: 'x' },
      { q: '' },
    ])).toEqual([
      { field: 'goal', id: 'g1', q: 'Behind?', chips: ['1h', '2h', 'Not today'] },
      { field: 'win', id: 'e1', q: 'Win?', chips: [] },
      { field: 'log', id: null, q: 'no id', chips: [] },
      { field: 'goal', id: 'g2', q: 'x', chips: [] },
    ]);
  });
  it('caps at five', () => expect(normCheckIn(new Array(9).fill({ q: 'q' }))).toHaveLength(5));

  it('assembleCheckIn orders goal, win, confirm, log and merges model wording into code-driven win questions', () => {
    const goals = [goal({ id: 'g1', title: 'Novel', cat: 'Novel', outcome: 'Draft' })];
    const events = [
      ev('w1', TODAY_KEY, 'Novel', 'Novel', 480, 540), // win candidate
      ev('p1', TODAY_KEY, 'Work', 'Standup', 560, 580), // pending confirm
    ];
    const qs: CheckInQuestion[] = [
      { field: 'log', q: 'Walk?', chips: [], id: null },
      { field: 'win', id: 'w1', q: 'How did the writing go?', chips: ['Drafted the intro', 'Nothing notable', 'Ran 10k', 'More'] },
      { field: 'goal', id: 'g1', q: 'Behind', chips: ['1h'] },
    ];
    const out = assembleCheckIn(qs, { events, goals, today: TODAY, nowMs: NOW_MS, lastSeen });
    expect(out.map((q) => q.field)).toEqual(['goal', 'win', 'confirm', 'log']);
    expect(out[1]).toMatchObject({ id: 'w1', q: 'How did the writing go?', chips: ['Drafted the intro', 'Ran 10k', 'Nothing notable', 'Didn’t happen'] });
    expect(out[2]).toMatchObject({ id: 'p1' });
  });
  it('without win questions the cap is four', () => {
    const qs: CheckInQuestion[] = [1, 2, 3, 4, 5, 6].map((i) => ({ field: 'log' as const, q: 'q' + i, chips: [], id: null }));
    expect(assembleCheckIn(qs, { events: [], goals: [], today: TODAY, nowMs: NOW_MS, lastSeen })).toHaveLength(4);
  });
});

describe('applyCheckIn', () => {
  const goals = [goal({ id: 'g1', title: 'Novel', cat: 'Novel', hours: 40 })];
  const events = [
    ev('w1', TODAY_KEY, 'Novel', 'Novel', 480, 540),
    ev('w2', TODAY_KEY, 'Novel', 'Novel', 600, 660),
    ev('p1', TODAY_KEY, 'Work', 'Standup', 560, 580),
    ev('p2', TODAY_KEY, 'Work', 'Review', 580, 600),
  ];
  const data: CalendarData = { events, cats: { Novel: 125, Work: 255 }, goals };
  const run = (qs: CheckInQuestion[], ans: string[]) => applyCheckIn(data, qs, ans, { ...ctx, nowMs: NOW_MS, nextId: makeIdGen(events) });
  const w = (id: string): CheckInQuestion => ({ field: 'win', id, q: 'win?', chips: [] });
  const c = (id: string): CheckInQuestion => ({ field: 'confirm', id, q: 'did it?', chips: [] });

  it('a win confirms the session, logs the text and stops it being asked again', () => {
    const r = run([w('w1')], ['finished chapter 3']);
    const e = r.data.events.find((x) => x.id === 'w1')!;
    expect(e).toMatchObject({ done: true, winAsked: true, win: { text: 'Finished chapter 3', at: NOW_MS } });
    expect(r.label).toBe('Check-in · 1 win logged');
  });
  it('"nothing notable" confirms with no win text', () => {
    ['Nothing notable', 'nothing much', 'No', 'skip'].forEach((a) => {
      const e = run([w('w1')], [a]).data.events.find((x) => x.id === 'w1')!;
      expect(e).toMatchObject({ done: true, winAsked: true });
      expect(e.win).toBeUndefined();
    });
  });
  it('"didn\'t happen" removes the event', () => {
    const r = run([w('w1'), c('p1')], ['Didn’t happen', 'no']);
    expect(r.data.events.map((e) => e.id)).toEqual(['w2', 'p2']);
    expect(r.label).toBe('Check-in · 2 removed');
  });
  it('yes confirms; other answers confirm and are passed on as lines for the scheduler', () => {
    const r = run([c('p1'), c('p2')], ['Yes', 'It did, but later']);
    expect(r.data.events.filter((e) => e.done).map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(r.lines).toEqual(['- did it? → It did, but later']);
    expect(r.followUp).toBe(CI_FOLLOWUP + '- did it? → It did, but later');
    expect(r.label).toBe('Check-in · 2 confirmed');
  });
  it('a goal answer books that many hours in the first free slot today', () => {
    const r = run([{ field: 'goal', id: 'g1', q: 'How much?', chips: [] }], ['2h']);
    const added = r.data.events[r.data.events.length - 1];
    expect(added).toMatchObject({ id: 'e3', day: TODAY_KEY, cat: 'Novel', title: 'Novel', start: 870, end: 990, at: NOW_MS });
    expect(r.newIds).toEqual(['e3']);
    expect(r.label).toBe('Check-in · 2h on Novel');
  });
  it('hours are clamped to 15 minutes..10 hours; zero, junk and unknown goals add nothing', () => {
    const len = (a: string, id = 'g1') => { const r = run([{ field: 'goal', id, q: 'q', chips: [] }], [a]); return r.newIds.length ? r.data.events[r.data.events.length - 1].end - r.data.events[r.data.events.length - 1].start : 0; };
    expect(len('0.1h')).toBe(15);
    expect(len('99')).toBe(600);
    expect(len('1.5 hours')).toBe(90);
    expect(len('Not today')).toBe(0);
    expect(len('0')).toBe(0);
    expect(len('2h', 'g404')).toBe(0);
  });
  it('log answers are not applied here: returned for the scheduler / offline parser', () => {
    const r = run([{ field: 'log', q: 'Did you walk the dog?', chips: [] }, { field: 'log', q: 'Lunch?', chips: [] }, { field: 'log', q: 'Gym?', chips: [] }], ['07:30', 'Skipped it', 'no']);
    expect(r.lines).toEqual(['- Did you walk the dog? → 07:30']);
    expect(r.plain).toEqual(['07:30']);
    expect(r.changed).toBe(false);
    expect(r.data).toBe(data);
    expect(r.label).toBeNull();
  });
  it('blank answers do nothing', () => {
    const r = run([c('p1'), { field: 'goal', id: 'g1', q: 'q', chips: [] }], ['', '']);
    expect(r.data).toBe(data);
  });
  it('a mixed check-in', () => {
    const r = run([{ field: 'goal', id: 'g1', q: 'q', chips: [] }, w('w1'), w('w2'), c('p1')], ['1h', 'drafted the intro', 'Nothing notable', 'Yes']);
    expect(r.label).toBe('Check-in · 1h on Novel · 1 win logged · 1 confirmed');
    expect(r.data.events.find((e) => e.id === 'w2')).toMatchObject({ done: true, winAsked: true });
  });
  it('does not mutate its input', () => {
    const before = JSON.stringify(data);
    run([w('w1'), c('p1')], ['x', 'no']);
    expect(JSON.stringify(data)).toBe(before);
  });
});
