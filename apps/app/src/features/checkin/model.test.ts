import { addDays, dnum, key, type CalendarData, type CheckInQuestion } from '@calendar/core';

import { answer, back, buildQuestions, finish, isLast, shouldOpen, startFlow, stepLabel } from './model';

const today = dnum('2026-10-30');
const clock = { today, nowMin: 14 * 60, nowMs: today.getTime() + 14 * 3600000 };
const dk = (n: number) => key(addDays(today, n));

const data: CalendarData = {
  cats: { 'Deep work': 240 },
  goals: [{ id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: 'Ship', hours: 70, start: dk(-20), deadline: dk(10), hue: 240 }],
  events: [
    // a goal session that ended an hour ago, no win yet
    { id: 's1', day: dk(0), cat: 'Deep work', title: 'Sync layer', start: 720, end: 780, at: 1 },
  ],
};

describe('check-in questions', () => {
  it('asks the goal, the win and the confirmation, first', () => {
    const qs = buildQuestions(data, clock, 0);
    expect(qs.map((q) => q.field).slice(0, 2)).toEqual(['goal', 'win']);
    expect(qs[0].id).toBe('g1');
    expect(qs[1].q).toMatch(/What came out of Sync layer/);
  });
});

describe('flow', () => {
  const qs: CheckInQuestion[] = [
    { field: 'goal', id: 'g1', q: 'How much?', chips: ['1h'] },
    { field: 'win', id: 's1', q: 'What came out of it?', chips: ['Nothing notable'] },
  ];

  it('steps through answers, back and skip', () => {
    let f = startFlow(qs);
    expect(stepLabel(f)).toBe('1 of 2');
    const r = answer(f, '1h');
    f = r.flow;
    expect(r.done).toBe(false);
    expect(f.idx).toBe(1);
    expect(isLast(f)).toBe(true);
    expect(back(f).idx).toBe(0);
    const last = answer(f, '  ');
    expect(last.done).toBe(true);
    expect(last.flow.ans).toEqual(['1h', undefined]);
  });

  it('applies answers: books goal hours, confirms the session and logs the win', () => {
    let ids = 0;
    const flow = { qs, idx: 1, ans: ['1h', 'Finished chapter 3'] as (string | undefined)[] };
    const r = finish(data, flow, clock, () => 'n' + ++ids);
    expect(r.changed).toBe(true);
    const s1 = r.data.events.find((e) => e.id === 's1');
    expect(s1).toMatchObject({ done: true, winAsked: true });
    expect(s1?.win?.text).toBe('Finished chapter 3');
    expect(r.data.events.some((e) => e.id === 'n1' && e.end - e.start === 60)).toBe(true);
    expect(r.label).toMatch(/^Check-in · 1h on Deep work · 1 win logged/);
  });

  it('"didn’t happen" removes the event', () => {
    const flow = { qs: [qs[1]], idx: 0, ans: ['Didn’t happen'] as (string | undefined)[] };
    const r = finish(data, flow, clock, () => 'n');
    expect(r.data.events.find((e) => e.id === 's1')).toBeUndefined();
    expect(r.label).toBe('Check-in · 1 removed');
  });
});

describe('when to open', () => {
  const base = { enabled: true, eodOnly: false, data, clock, lastCheckIn: 0, lastWinDay: '' };

  it('opens after a long gap and not while disabled or recent', () => {
    expect(shouldOpen(base)).toBe(true);
    expect(shouldOpen({ ...base, enabled: false })).toBe(false);
    expect(shouldOpen({ ...base, lastCheckIn: clock.nowMs - 3600000 })).toBe(false);
  });

  it('opens once in the evening while a win is waiting', () => {
    const evening = { today, nowMin: 19 * 60, nowMs: today.getTime() + 19 * 3600000 };
    const o = { ...base, clock: evening, eodOnly: true, lastCheckIn: evening.nowMs - 3600000 };
    expect(shouldOpen(o)).toBe(true);
    expect(shouldOpen({ ...o, lastWinDay: key(today) })).toBe(false);
  });
});
