import { describe, expect, it } from 'vitest';
import {
  NOASK, adjustModeFor, adjustNote, applyResolved, calBlock, ciPrompt, goalBlock, makeIdGen, parseNote, schedulerInput,
} from '../src/index.ts';
import type { CalendarData } from '../src/index.ts';
import { NOW_MS, TODAY, TODAY_KEY, dd, ev, goal, lcg, nowCtx } from './helpers.ts';

const ctx = nowCtx();
const data = (): CalendarData => ({
  events: [
    ev('e1', TODAY_KEY, 'Work', 'Standup', 570, 585),
    ev('e2', dd(1), 'Food', 'Brunch', 660, 750),
    ev('e3', dd(3), 'Work', 'Trip', 0, 1440, { allDay: true, days: 3 }),
    ev('e4', dd(4), 'Work', 'Offsite', 0, 1440, { allDay: true }),
    ev('e5', dd(30), 'Work', 'Far away', 60, 120),
    ev('e6', dd(-8), 'Work', 'Too old', 60, 120),
  ],
  cats: { Work: 255, Food: 72, Pets: 166, 'Deep work': 240 },
  goals: [goal({ id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: 'Ship it', hours: 70, start: dd(-20), deadline: dd(25) })],
});

describe('<calendar> block', () => {
  const text = calBlock(data(), ctx);
  const lines = text.split('\n');
  it('header: today, time, categories', () => {
    expect(lines[0]).toBe('<calendar>');
    expect(lines[1]).toBe('Today is Friday, October 30, 2026. The current time is 14:20 (860 minutes past midnight).');
    expect(lines[2]).toBe('Existing categories: Work, Food, Pets, Deep work');
    expect(lines[lines.length - 1]).toBe('</calendar>');
  });
  it('lists events from a week ago to three weeks ahead, in order', () => {
    expect(text).toContain('  e1 | ' + TODAY_KEY + ' | 09:30-09:45 | Work | Standup');
    expect(text).toContain('  e2 | ' + dd(1) + ' | 11:00-12:30 | Food | Brunch');
    expect(text).toContain('  e3 | ' + dd(3) + ' | all-day, 3 days | Work | Trip');
    expect(text).toContain('  e4 | ' + dd(4) + ' | all-day, 1 day | Work | Offsite');
    expect(text).not.toContain('Far away');
    expect(text).not.toContain('Too old');
    expect(text.indexOf('Standup')).toBeLessThan(text.indexOf('Brunch'));
  });
  it('goal row with pace and totals', () => {
    expect(text).toMatch(/\n {2}g1 \| Deep work \| outcome: Ship it \| deadline \d{4}-\d\d-\d\d \(\d+ days left\) \| 70h estimate = 11h a week \| done 0h, booked \(not yet marked done\) 0h \| \d+h behind \| category "Deep work"\n/);
    expect(text).toMatch(/total pace across active goals: 11h a week\n/);
  });
  it('(none) for an empty calendar', () => {
    const t = calBlock({ events: [], cats: {}, goals: [] }, ctx);
    expect(t).toContain('Events already on the calendar:\n  (none)\nGoals already set:');
    expect(t).toContain('total pace across active goals: 0h a week');
  });
  it('caps at 90 events', () => {
    const many = Array.from({ length: 120 }, (_, i) => ev('m' + i, dd(1), 'Work', 'x', 60 + i, 70 + i));
    expect(calBlock({ events: many, cats: {}, goals: [] }, ctx).split('\n').filter((l) => / \| Work \| x$/.test(l))).toHaveLength(90);
  });
});

describe('<goal> block, adjust note and mode', () => {
  it('goal block', () => {
    const t = goalBlock('g1', 'reduce', data(), ctx)!;
    expect(t.startsWith('<goal mode="reduce">\nid g1 | Deep work | outcome: Ship it\ndeadline ' + dd(25) + ' (')).toBe(true);
    expect(t).toMatch(/\ntotal 70h \| fixed pace 11h a week\ndone 0h \| booked ahead, not yet done 0h \| still to do 70h\nexpected by now [\d.]+h \| [\d.]+h behind\n<\/goal>$/);
    expect(goalBlock('g1', undefined, data(), ctx)!.startsWith('<goal mode="scope">')).toBe(true);
    expect(goalBlock('nope', 'reduce', data(), ctx)).toBeNull();
  });
  it('adjust note and mode', () => {
    expect(adjustNote('Piano', 'reduce')).toBe('I’m behind on Piano. Help me reduce the scope. Ask me what should give way.');
    expect(adjustNote('Piano', 'stretch')).toBe('I’m on track with Piano. Help me add a stretch. Ask me what to push.');
    expect(adjustModeFor(-1, 10, true)).toBe('reduce');
    expect(adjustModeFor(-0.1, 10, true)).toBe('stretch');
    expect(adjustModeFor(2, 10, true)).toBe('stretch');
    expect(adjustModeFor(-5, 0, true)).toBeNull();
    expect(adjustModeFor(-5, 10, false)).toBeNull();
  });
  it('schedulerInput assembles calendar, goal and note', () => {
    const plain = schedulerInput(data(), ctx, 'gym at 7am');
    expect(plain.startsWith('<calendar>')).toBe(true);
    expect(plain.endsWith('\n\n<note>\ngym at 7am\n</note>')).toBe(true);
    expect(plain).not.toContain('<goal');
    const noask = schedulerInput(data(), ctx, 'gym at 7am', { noAsk: true });
    expect(noask.endsWith('<note>\ngym at 7am' + NOASK + '\n</note>')).toBe(true);
    const adj = schedulerInput(data(), ctx, 'x', { goalId: 'g1', mode: 'stretch' });
    expect(adj).toContain('</calendar>\n\n<goal mode="stretch">');
    expect(adj.indexOf('<goal')).toBeLessThan(adj.indexOf('<note>'));
  });
});

describe('<checkin> block', () => {
  it('sections in order', () => {
    const t = ciPrompt(data(), { ...ctx, nowMs: NOW_MS }, NOW_MS - 20 * 3600000);
    expect(t.startsWith('<checkin>\nToday is Friday, October 30. The time is now 14:20.\nGoals and where they stand:\n  g1 | Deep work | 0 of 70h by ')).toBe(true);
    const order = ['Already on today:', 'The last seven days:', 'Goal sessions that ended with no win logged', 'Already being confirmed separately'].map((s) => t.indexOf(s));
    expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
    expect(t).toContain('  09:30-09:45 | Standup (Work)');
    expect(t).toContain('  09:30 | Standup'); // standup ended, unconfirmed: pending
    expect(t.endsWith('\n\n</checkin>')).toBe(true);
  });
  it('empty sections', () => {
    const t = ciPrompt({ events: [], cats: {}, goals: [] }, { ...ctx, nowMs: NOW_MS }, 0);
    expect(t).toContain('Goals and where they stand:\n  (none)');
    expect(t).toContain('Already on today:\n  (nothing yet)');
    expect(t).toContain('The last seven days:\n  (no history)');
  });
  it('lists goal sessions awaiting a win', () => {
    const d = data();
    d.events.push(ev('w1', TODAY_KEY, 'Deep work', 'Sync layer', 480, 540));
    expect(ciPrompt(d, { ...ctx, nowMs: NOW_MS }, 0)).toContain('  w1 | today 08:00-09:00 | Sync layer | goal: Deep work (Ship it)');
  });
});

describe('offline parser', () => {
  const parse = (text: string, nowMin = NOW_MIN_DEFAULT, cats = data().cats) =>
    parseNote(text, { cats }, { today: TODAY, nowMin, nowMs: NOW_MS, nextId: makeIdGen([], 100), random: lcg(5) });
  const NOW_MIN_DEFAULT = 14 * 60 + 20;
  const brief = (text: string, nowMin?: number) => parse(text, nowMin).events.map((e) => [e.title, e.cat, e.day, e.start, e.end]);

  it('single event with a time and category', () => expect(brief('gym at 7am')).toEqual([['Gym', 'Health', TODAY_KEY, 420, 480]]));
  it('ranges, with the meridiem shared across the range', () => {
    expect(brief('standup 9:30-9:45')).toEqual([['Standup', 'Work', TODAY_KEY, 570, 585]]);
    expect(brief('meeting 2-3pm')).toEqual([['Meeting', 'Work', TODAY_KEY, 840, 900]]);
  });
  it('an end-only time ("until 5pm")', () => expect(brief('novel writing until 5pm', 600)[0].slice(3)).toEqual([600, 1020])); // starts now (10:00), ends 17:00
  it('durations: "for an hour", "for 15 minutes", "for half an hour"', () => {
    expect(brief('run at 6:30am for an hour')[0].slice(3)).toEqual([390, 450]);
    expect(brief('standup at 9:30 for 15 minutes')[0].slice(3)).toEqual([570, 585]);
    expect(brief('lunch at noon for half an hour')[0].slice(3)).toEqual([720, 750]);
    expect(brief('dinner at 7pm for 2 hours')[0].slice(3)).toEqual([1140, 1260]);
  });
  it('tomorrow and yesterday shift the day', () => {
    expect(brief('dentist at 3pm tomorrow')[0][2]).toBe(dd(1));
    expect(brief('run yesterday at 6:30am')[0][2]).toBe(dd(-1));
    expect(brief('run today at 6:30am')[0][2]).toBe(TODAY_KEY);
  });
  it('overnight ranges run past midnight', () => expect(brief('sleep 10pm-6am')[0].slice(3)).toEqual([1320, 1800]));
  it('segments split on commas, "then", "and" lines; events without a time follow the previous one', () => {
    const r = parse('gym at 7am then lunch, call mum').events;
    expect(r.map((e) => [e.title, e.start, e.end])).toEqual([['Gym', 420, 480], ['Lunch', 480, 525], ['Call mum', 525, 585]]);
    expect(r.map((e) => e.id)).toEqual(['e101', 'e102', 'e103']);
  });
  it('an untimed first event starts at now (snapped) but not before 08:00', () => {
    expect(brief('read', 14 * 60 + 20)[0].slice(3)).toEqual([855, 915]);
    expect(brief('read', 0)[0].slice(3)[0]).toBe(480);
  });
  it('named times of day', () => expect(brief('call sam in the evening')[0][3]).toBe(1140));
  it('an unknown activity makes a new category from its first meaningful word', () => {
    const r = parse('plant the garden');
    expect(r.events[0]).toMatchObject({ title: 'Plant the garden', cat: 'Plant' });
    expect(r.fresh).toEqual(['Plant']);
    expect(r.cats.Plant).toBe(350);
  });
  it("the user's own categories win and are never folded", () => {
    const r = parse('deep work 10am', 600, { Work: 255, 'Deep work': 240 });
    expect(r.events[0].cat).toBe('Deep work');
    expect(r.fresh).toEqual([]);
  });
  it('empty and tiny segments are ignored', () => {
    expect(parse('').events).toEqual([]);
    expect(parse('x').events).toEqual([]);
  });
  it('the result applies like model ops', () => {
    const d = data();
    const r = parse('gym at 7am, lunch at noon');
    const res = applyResolved(d, r, { today: TODAY, nowMin: 860, nowMs: NOW_MS, nextId: makeIdGen([]), random: lcg(1) }, 'local');
    expect(res.data.events).toHaveLength(d.events.length + 2);
    expect(res.message).toBe('2 events added · new: Health'); // Health is not among this test's categories
    expect(res.history?.label).toBe('Note · 2 events added · new: Health');
  });
});
