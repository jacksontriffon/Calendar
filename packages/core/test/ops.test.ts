import { describe, expect, it } from 'vitest';
import {
  applyOps, applyResolved, checkCi, checkOps, fromModel, interpretReply, isAskOp, isEmptyResolved, normAsks, parseArr, parseVerdict, verdictFix,
  NOASK, dataSnap, makeIdGen, restoreEntry, pushHistory,
} from '../src/index.ts';
import type { CalendarData, RawOp } from '../src/index.ts';
import { NOW_MS, TODAY, TODAY_KEY, dd, ev, goal, lcg, nowCtx, opsCtx } from './helpers.ts';

const base = (): CalendarData => ({
  events: [
    ev('e1', TODAY_KEY, 'Work', 'Standup', 570, 585),
    ev('e2', dd(1), 'Health', 'Gym', 420, 480),
    ev('e3', TODAY_KEY, 'Deep work', 'Sync layer', 540, 690),
    ev('e4', dd(-1), 'Food', 'Dinner', 1140, 1200, { done: true }),
    ev('e5', dd(2), 'Work', 'Trip', 0, 1440, { allDay: true, days: 2 }),
  ],
  cats: { Work: 255, Food: 72, Health: 132, Family: 28, Social: 12, Routine: 104, Pets: 166, 'Deep work': 240 },
  goals: [goal({ id: 'g1', title: 'Deep work', cat: 'Deep work', hours: 70, start: dd(-20), deadline: dd(25), hue: 240 })],
});

describe('parseArr', () => {
  it('extracts the array from fenced or chatty replies', () => {
    expect(parseArr('[{"op":"delete","id":"e1"}]')).toEqual([{ op: 'delete', id: 'e1' }]);
    expect(parseArr('```json\n[1,2]\n```')).toEqual([1, 2]);
    expect(parseArr('Sure! Here you go: [{"a":[1,2]}] hope that helps')).toEqual([{ a: [1, 2] }]);
  });
  it('throws "no JSON" without brackets and on malformed JSON', () => {
    expect(() => parseArr('nothing here')).toThrow('no JSON');
    expect(() => parseArr('{"a":1}')).toThrow('no JSON');
    expect(() => parseArr('[')).toThrow('no JSON');
    expect(() => parseArr('[1,2')).toThrow('no JSON');
    expect(() => parseArr('[oops]')).toThrow(SyntaxError);
  });
});

describe('verifier verdicts', () => {
  it('parses ok and fixed verdicts', () => {
    expect(parseVerdict('{"ok":true}')).toEqual({ ok: true });
    expect(verdictFix(parseVerdict('```json\n{"ok":false,"reason":"r","fixed":[{"op":"delete","id":"e1"}]}\n```'))).toEqual([{ op: 'delete', id: 'e1' }]);
  });
  it('only a rejected verdict with a non-empty fix replaces the candidate', () => {
    expect(verdictFix({ ok: true })).toBeNull();
    expect(verdictFix({ ok: false, fixed: [] })).toBeNull();
    expect(verdictFix({ ok: false })).toBeNull();
    expect(verdictFix(null)).toBeNull();
    expect(parseVerdict('no json at all')).toBeNull();
  });
});

describe('checkOps: accepts good replies', () => {
  const d = base();
  const good: RawOp[][] = [
    [{ op: 'create', title: 'Standup', cat: 'Work', start: 570, end: 585, dayOffset: 0 }],
    [{ op: 'create', title: 'Lisbon trip', cat: 'Travel', allDay: true, dayOffset: 4, days: 3 }],
    [{ op: 'create', title: 'Launch week', cat: 'Work', allDay: true, span: 'week', weekOffset: 1 }],
    [{ op: 'create', title: 'Novel', cat: 'Novel', start: 840, end: 1020, dayOffset: -1, win: 'Finished chapter 3' }],
    [{ op: 'create', title: 'Sleep', start: 1320, end: 1920 }], // overnight: end = start + 600
    [{ op: 'update', id: 'e1', start: 900, end: 960 }],
    [{ op: 'update', id: 'e1', title: 'Renamed' }],
    [{ op: 'delete', id: 'e2' }],
    [{ op: 'goal', title: 'Marathon', outcome: 'Run a sub-4 hour marathon', deadline: '2026-12-06', hours: 90 }],
    [{ op: 'goal', id: 'g1', hours: 50 }],
    [{ op: 'goal', id: 'g1', delete: true }],
    [{ op: 'ask', question: 'Which day?', options: [{ label: 'Today' }, { label: 'Tomorrow' }] }],
    [{ op: 'clarify', question: 'q', options: ['a', 'b', 'c', 'd'] }],
    [{ op: 'create', title: 'a', start: 60, end: 120 }, { op: 'update', id: 'e1', end: 600 }, { op: 'delete', id: 'e2' }],
  ];
  good.forEach((arr, i) => it('#' + i + ' ' + JSON.stringify(arr).slice(0, 70), () => expect(checkOps(arr, d, TODAY)).toEqual([])));
  it('a goal deadline of today is not in the past', () => expect(checkOps([{ op: 'goal', id: 'g1', deadline: TODAY_KEY }], d, TODAY)).toEqual([]));
  it('three questions are fine', () => {
    const q = { op: 'ask', question: 'q', options: ['a', 'b'] };
    expect(checkOps([q, q, q], d, TODAY)).toEqual([]);
  });
});

describe('checkOps: rejects each bad shape', () => {
  const d = base();
  const bad = (arr: unknown[], msg: string | RegExp, noAsk = false) => {
    const r = checkOps(arr, d, TODAY, noAsk);
    expect(r.length, JSON.stringify(r)).toBeGreaterThan(0);
    expect(r.join('\n')).toMatch(msg);
  };
  it('empty reply', () => expect(checkOps([], d, TODAY)).toEqual(['the reply is empty']));
  it('non-objects', () => {
    expect(checkOps([null, 5, 'str'], d, TODAY)).toEqual(['#1 is not an object', '#2 is not an object', '#3 is not an object']);
  });
  it('unknown op', () => bad([{ op: 'frobnicate' }], '#1 unknown op "frobnicate"'));
  it('missing op', () => bad([{}], '#1 unknown op "undefined"'));
  it('create: no title', () => bad([{ op: 'create', title: '  ', start: 1, end: 2 }], '#1 create has no title'));
  it('create: non-numeric dayOffset', () => bad([{ op: 'create', title: 'x', start: 1, end: 2, dayOffset: '1' }], '#1 dayOffset must be a number'));
  it('create: timed without numeric start/end', () => {
    bad([{ op: 'create', title: 'x', start: 600 }], '#1 timed create needs numeric start and end');
    bad([{ op: 'create', title: 'x', start: '600', end: '700' }], 'timed create needs numeric');
  });
  it('create: end not after start / more than 24h after', () => {
    bad([{ op: 'create', title: 'x', start: 600, end: 600 }], '#1 end must be greater than start and at most start+1440');
    bad([{ op: 'create', title: 'x', start: 600, end: 500 }], 'end must be greater than start');
    bad([{ op: 'create', title: 'x', start: 600, end: 2041 }], 'at most start+1440');
    expect(checkOps([{ op: 'create', title: 'x', start: 600, end: 2040 }], d, TODAY)).toEqual([]);
  });
  it('create: all-day days must be 1 or more (not for whole weeks)', () => {
    bad([{ op: 'create', title: 'x', allDay: true, days: 0 }], '#1 days must be 1 or more');
    expect(checkOps([{ op: 'create', title: 'x', allDay: true, span: 'week', days: 0 }], d, TODAY)).toEqual([]);
  });
  it('update/delete: id not on the calendar', () => {
    bad([{ op: 'update', id: 'e404', start: 1, end: 2 }], '#1 update id "e404" is not on the calendar');
    bad([{ op: 'delete', id: 'e404' }], '#1 delete id "e404" is not on the calendar');
    bad([{ op: 'delete' }], '#1 delete id "undefined" is not on the calendar');
    // a prototype-chain name must not count as an id
    bad([{ op: 'delete', id: 'constructor' }], 'is not on the calendar');
  });
  it('update: bad time span', () => bad([{ op: 'update', id: 'e1', start: 900, end: 800 }], '#1 end must be greater than start'));
  it('goal: unknown id', () => bad([{ op: 'goal', id: 'g404', hours: 5 }], '#1 goal id "g404" does not exist'));
  it('goal: a new goal needs title, outcome, deadline and hours', () => {
    const r = checkOps([{ op: 'goal', title: 'Marathon' }], d, TODAY);
    expect(r).toEqual(['#1 new goal is missing outcome', '#1 new goal is missing deadline', '#1 new goal is missing hours']);
    expect(checkOps([{ op: 'goal', title: '', outcome: 'o', deadline: dd(5), hours: 5 }], d, TODAY)).toEqual(['#1 new goal is missing title']);
  });
  it('goal: deadline format and past', () => {
    bad([{ op: 'goal', id: 'g1', deadline: '6 Dec' }], '#1 deadline must be YYYY-MM-DD');
    bad([{ op: 'goal', id: 'g1', deadline: '2026-1-1' }], 'deadline must be YYYY-MM-DD');
    bad([{ op: 'goal', id: 'g1', deadline: dd(-1) }], '#1 deadline ' + dd(-1) + ' is in the past');
  });
  it('goal: hours must be a positive number', () => {
    bad([{ op: 'goal', id: 'g1', hours: 0 }], '#1 hours must be a positive number');
    bad([{ op: 'goal', id: 'g1', hours: -3 }], 'positive');
    bad([{ op: 'goal', id: 'g1', hours: 'lots' }], 'positive');
    expect(checkOps([{ op: 'goal', id: 'g1', hours: '12' }], d, TODAY)).toEqual([]);
  });
  it('ask: needs a question and 2-4 options', () => {
    bad([{ op: 'ask', question: '', options: ['a', 'b'] }], '#1 ask has no question');
    bad([{ op: 'ask', question: 'q', options: ['a'] }], '#1 ask has 1 options (needs 2–4)');
    bad([{ op: 'ask', question: 'q', options: ['a', 'b', 'c', 'd', 'e'] }], 'ask has 5 options');
    bad([{ op: 'ask', question: 'q' }], 'ask has 0 options');
  });
  it('ask: at most three questions', () => {
    const q = { op: 'ask', question: 'q', options: ['a', 'b'] };
    bad([q, q, q, q], '4 questions (max 3)');
  });
  it('ask: not allowed when the note says not to ask', () => bad([{ op: 'ask', question: 'q', options: ['a', 'b'] }], 'the note says not to ask, but the reply asks', true));
  it('ask mixed with edits', () => bad([{ op: 'ask', question: 'q', options: ['a', 'b'] }, { op: 'delete', id: 'e1' }], 'mixes questions with create/update/delete'));
  it('op aliases for ask are recognised', () => {
    ['ask', 'clarify', 'question', 'confirm', 'ASK'].forEach((op) => expect(isAskOp({ op })).toBe(true));
    ['create', 'goal', '', undefined].forEach((op) => expect(isAskOp({ op })).toBe(false));
    expect(isAskOp(null)).toBe(false);
  });
});

describe('checkCi', () => {
  const d = base();
  const q = (field: string, extra: RawOp = {}) => ({ field, q: 'A question?', ...extra });
  it('accepts good replies', () => {
    expect(checkCi([q('goal', { id: 'g1', chips: ['1h', '2h', 'Not today'] }), q('log', { chips: ['07:30'] })], d, [])).toEqual([]);
    expect(checkCi([q('win', { id: 'e9' })], d, ['e9'])).toEqual([]);
    expect(checkCi([q('log'), q('log'), q('log'), q('log')], d, [])).toEqual([]);
  });
  it('question counts: 2-4 without win questions, up to 5 with', () => {
    expect(checkCi([q('log')], d, [])).toEqual(['1 questions (needs 2–4)']);
    expect(checkCi(new Array(5).fill(q('log')), d, [])).toEqual(['5 questions (needs 2–4)']);
    const w = (id: string) => q('win', { id });
    expect(checkCi([w('a'), w('b'), w('c'), w('d'), w('e'), q('log')], d, ['a', 'b', 'c', 'd', 'e'])).toEqual(['6 questions (needs 1–5)']);
  });
  it('each question needs a q', () => {
    expect(checkCi([q('log'), { field: 'log' }], d, [])).toEqual(['#2 has no q']);
    expect(checkCi([q('log'), { field: 'log', q: '  ' }], d, [])).toEqual(['#2 has no q']);
    expect(checkCi([q('log'), null], d, [])).toEqual(['#2 has no q']);
  });
  it('field must be goal, win or log', () => expect(checkCi([q('log'), q('other')], d, [])).toEqual(['#2 field must be "goal", "win" or "log"']));
  it('win ids must be listed sessions', () => expect(checkCi([q('win', { id: 'e404' })], d, ['e1'])).toEqual(['#1 win id "e404" is not a listed goal session']));
  it('goal ids must exist, the goal question comes first and there is at most one', () => {
    expect(checkCi([q('goal', { id: 'g404' }), q('log')], d, [])).toEqual(['#1 goal id "g404" does not exist']);
    expect(checkCi([q('log'), q('goal', { id: 'g1' })], d, [])).toEqual(['#2 goal question must come first']);
    expect(checkCi([q('goal', { id: 'g1' }), q('goal', { id: 'g1' }), q('log')], d, [])).toEqual(['#2 goal question must come first', 'more than one goal question']);
  });
  it('at most three chips', () => expect(checkCi([q('log', { chips: ['1', '2', '3', '4'] }), q('log')], d, [])).toEqual(['#1 more than 3 chips']));
});

describe('normAsks', () => {
  it('accepts strings or {label|text, note} options and trims', () => {
    expect(normAsks([{ question: ' Which day? ', options: [' Today ', { label: 'Tomorrow', note: ' Tue 15 ' }, { text: 'Next Monday' }] }])).toEqual([
      { q: 'Which day?', options: [{ label: 'Today', note: '' }, { label: 'Tomorrow', note: 'Tue 15' }, { label: 'Next Monday', note: '' }] },
    ]);
  });
  it('alternative keys for the question and the options', () => {
    expect(normAsks([{ text: 'T', choices: ['a', 'b'] }])[0]).toEqual({ q: 'T', options: [{ label: 'a', note: '' }, { label: 'b', note: '' }] });
    expect(normAsks([{ title: 'Z', answers: ['a', 'b'] }])[0].q).toBe('Z');
  });
  it('drops empty labels, needs two options and a question, caps options at 5 and questions at 2', () => {
    expect(normAsks([{ question: 'Q', options: ['a', '', { label: '' }] }])).toEqual([]);
    expect(normAsks([{ question: '', options: ['a', 'b'] }])).toEqual([]);
    expect(normAsks([{ question: 'Q', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }])[0].options).toHaveLength(5);
    const three = [1, 2, 3].map((i) => ({ question: 'Q' + i, options: ['a', 'b'] }));
    expect(normAsks(three).map((x) => x.q)).toEqual(['Q1', 'Q2']);
  });
});

describe('fromModel: creating events', () => {
  const d = base();
  const run = (ops: RawOp[], c = opsCtx(d)) => fromModel(ops, d, c);

  it('timed create with all the defaults', () => {
    const r = run([{ op: 'create', title: 'standup', cat: 'work', start: 570, end: 585, dayOffset: 0 }]);
    expect(r.events).toEqual([{ id: 'e6', day: TODAY_KEY, cat: 'Work', title: 'Standup', start: 570, end: 585, at: NOW_MS }]);
    expect(r.fresh).toEqual([]);
    expect(r.cats).toEqual(d.cats);
  });
  it('op defaults to create; category aliases and the category key', () => {
    const r = run([{ title: 'Lunch with Dan', category: 'Lunch', start: 750, end: 795 }]);
    expect(r.events[0]).toMatchObject({ cat: 'Food', title: 'Lunch with Dan' });
  });
  it('a new category gets the first spare hue not already used', () => {
    const r = run([{ op: 'create', title: 'Fold', cat: 'Origami', start: 900, end: 960 }]);
    expect(r.fresh).toEqual(['Origami']);
    expect(r.cats.Origami).toBe(350);
    const r2 = run([{ op: 'create', title: 'a', cat: 'Alpha', start: 1, end: 60 }, { op: 'create', title: 'b', cat: 'Beta', start: 1, end: 60 }]);
    expect([r2.cats.Alpha, r2.cats.Beta]).toEqual([350, 170]);
  });
  it('an existing category matches case-insensitively and the original is not mutated', () => {
    const r = run([{ op: 'create', title: 'x', cat: 'DEEP WORK', start: 100, end: 160 }]);
    expect(r.events[0].cat).toBe('Deep work');
    expect(d.cats).not.toHaveProperty('Origami');
    expect(r.cats).not.toBe(d.cats);
  });
  it('a category called constructor works like any other', () => {
    const r = run([{ op: 'create', title: 'x', cat: 'constructor', start: 100 }]);
    expect(r.events[0]).toMatchObject({ cat: 'constructor', start: 100, end: 145 });
    expect(r.fresh).toEqual(['constructor']);
    expect(Object.keys(r.cats)).toContain('constructor');
  });
  it('missing category becomes Other', () => {
    const r = run([{ op: 'create', title: 'x', start: 100, end: 160 }]);
    expect(r.events[0].cat).toBe('Other');
    expect(r.cats.Other).toBe(48);
  });
  it('time rounding and clamping', () => {
    const e = (o: RawOp) => run([{ op: 'create', title: 't', cat: 'Work', ...o }]).events[0];
    expect(e({ start: 600.4, end: 700.6 })).toMatchObject({ start: 600, end: 701 });
    expect(e({ start: 1500, end: 1501 })).toMatchObject({ start: 1425, end: 1501 }); // start clamped to 1425
    expect(e({ start: -50, end: 30 })).toMatchObject({ start: 0, end: 30 });
    expect(e({ start: 600, end: 600 })).toMatchObject({ start: 600, end: 660 }); // default duration for Work
    expect(e({ start: 600 })).toMatchObject({ end: 660 });
    expect(e({ start: 600, end: 30 })).toMatchObject({ end: 30 + 1440 }); // end before start means next day
    expect(e({ start: 600, end: 5000 })).toMatchObject({ end: 2040 }); // at most 24h
    expect(e({ start: 600, end: 605 })).toMatchObject({ end: 615 }); // at least 15 min
    expect(e({ start: 1320, end: 1920 })).toMatchObject({ start: 1320, end: 1920 }); // overnight
  });
  it('without a start: now (snapped), but not before 08:00', () => {
    expect(run([{ op: 'create', title: 't', cat: 'Work' }]).events[0]).toMatchObject({ start: 855, end: 915 }); // 14:20 snaps (rounds) to 14:15
    expect(run([{ op: 'create', title: 't', cat: 'Work' }], opsCtx(d, { nowMin: 60 })).events[0].start).toBe(480);
  });
  it('dayOffset is counted from today, rounded and clamped to +-60', () => {
    const day = (o: unknown) => run([{ op: 'create', title: 't', cat: 'Work', start: 1, end: 60, dayOffset: o }]).events[0].day;
    expect(day(1)).toBe(dd(1));
    expect(day(-1)).toBe(dd(-1));
    expect(day(2.6)).toBe(dd(3));
    expect(day(99)).toBe(dd(60));
    expect(day(-99)).toBe(dd(-60));
    expect(day('3')).toBe(dd(3));
    expect(day(undefined)).toBe(dd(0));
    expect(day('nope')).toBe(dd(0));
  });
  it('a past session with a win is marked done', () => {
    const r = run([{ op: 'create', title: 'Novel', cat: 'Novel', start: 840, end: 1020, dayOffset: -1, win: 'finished chapter 3' }]);
    expect(r.events[0]).toMatchObject({ done: true, win: { text: 'Finished chapter 3', at: NOW_MS } });
    expect(run([{ op: 'create', title: 'x', start: 1, end: 60, win: '  ' }]).events[0].win).toBeUndefined();
  });
  it('untitled', () => expect(run([{ op: 'create', title: '  ', start: 1, end: 60 }]).events[0].title).toBe('Untitled'));
  it('ids continue the counter', () => {
    const r = run([{ title: 'a', start: 1, end: 60 }, { title: 'b', start: 1, end: 60 }]);
    expect(r.events.map((e) => e.id)).toEqual(['e6', 'e7']);
  });
  it('non-object entries are skipped', () => expect(run([null as unknown as RawOp, 5 as unknown as RawOp]).events).toEqual([]));
});

describe('fromModel: all-day events', () => {
  const d = base();
  const one = (o: RawOp) => fromModel([{ op: 'create', title: 'Trip', cat: 'Holiday', ...o }], d, opsCtx(d)).events[0];
  it('multi-day', () => expect(one({ allDay: true, dayOffset: 4, days: 3 })).toEqual({ id: 'e6', day: dd(4), cat: 'Holiday', title: 'Trip', start: 0, end: 1440, allDay: true, days: 3 }));
  it('days default to 1, are rounded and clamped to 1..60', () => {
    expect(one({ allDay: true }).days).toBe(1);
    expect(one({ allDay: true, days: 2.5 }).days).toBe(3);
    expect(one({ allDay: true, days: 500 }).days).toBe(60);
    expect(one({ allDay: true, days: 0 }).days).toBe(1);
  });
  it('whole weeks snap to Monday and cover 7 days', () => {
    // today is Friday 30 Oct; next week's Monday is 2 Nov
    expect(one({ allDay: true, span: 'week', weekOffset: 1 })).toMatchObject({ day: '2026-11-02', days: 7 });
    expect(one({ allDay: true, span: 'week', weekOffset: 0 })).toMatchObject({ day: '2026-10-26', days: 7 });
    expect(one({ allDay: 'week' })).toMatchObject({ day: '2026-10-26', days: 7 });
    expect(one({ allDay: true, span: 'week', days: 14 }).days).toBe(14);
  });
  it('weekOffset without span just offsets by weeks', () => expect(one({ allDay: true, weekOffset: 1 }).day).toBe(dd(7)));
  it('weekOffset is clamped to +-26', () => expect(one({ allDay: true, weekOffset: 99 }).day).toBe(dd(26 * 7)));
});

describe('fromModel: updates', () => {
  const d = base();
  const upd = (o: RawOp) => fromModel([{ op: 'update', id: 'e1', ...o }], d, opsCtx(d)).updates;
  it('only the fields that change', () => {
    expect(upd({ title: 'renamed' })).toEqual([{ id: 'e1', patch: { title: 'Renamed' } }]);
    expect(upd({ cat: 'health' })).toEqual([{ id: 'e1', patch: { cat: 'Health' } }]);
    expect(upd({ dayOffset: 1 })).toEqual([{ id: 'e1', patch: { day: dd(1) } }]);
  });
  it('unknown ids and empty patches are ignored', () => {
    expect(fromModel([{ op: 'update', id: 'e404', title: 'x' }], d, opsCtx(d)).updates).toEqual([]);
    expect(upd({})).toEqual([]);
    expect(upd({ title: '  ' })).toEqual([]);
  });
  it('op aliases', () => {
    ['edit', 'move', 'UPDATE'].forEach((op) => expect(fromModel([{ op, id: 'e1', title: 'x' }], d, opsCtx(d)).updates).toHaveLength(1));
  });
  it('retiming keeps the length when only the start moves', () => {
    expect(upd({ start: 900 })[0].patch).toEqual({ start: 900, end: 915 }); // 570-585 is 15 min
    const e3 = fromModel([{ op: 'update', id: 'e3', start: 600 }], d, opsCtx(d)).updates[0].patch;
    expect(e3).toEqual({ start: 600, end: 750 }); // 150 min kept
  });
  it('moving only the end', () => expect(fromModel([{ op: 'update', id: 'e3', end: 720 }], d, opsCtx(d)).updates[0].patch).toEqual({ end: 720 }));
  it('end at or before start: same-length / next-day rules', () => {
    expect(fromModel([{ op: 'update', id: 'e3', start: 900, end: 900 }], d, opsCtx(d)).updates[0].patch).toEqual({ start: 900, end: 1050 });
    expect(fromModel([{ op: 'update', id: 'e3', start: 1320, end: 120 }], d, opsCtx(d)).updates[0].patch).toEqual({ start: 1320, end: 1560 });
  });
  it('end is kept between start+15 and start+1440', () => {
    expect(fromModel([{ op: 'update', id: 'e3', start: 600, end: 605 }], d, opsCtx(d)).updates[0].patch.end).toBe(615);
    expect(fromModel([{ op: 'update', id: 'e3', start: 600, end: 9000 }], d, opsCtx(d)).updates[0].patch.end).toBe(2040);
  });
  it('making an event all-day, and back', () => {
    expect(upd({ allDay: true, days: 2 })).toEqual([{ id: 'e1', patch: { allDay: true, days: 2, start: 0, end: 1440 } }]);
    expect(upd({ allDay: true })[0].patch.days).toBe(1);
    expect(fromModel([{ op: 'update', id: 'e5', allDay: false, start: 600, end: 660 }], d, opsCtx(d)).updates[0].patch).toEqual({ allDay: false, days: 1, start: 600, end: 660 });
  });
  it('whole-week update snaps to Monday', () => {
    expect(upd({ span: 'week', dayOffset: 7 })[0].patch).toEqual({ day: '2026-11-02', allDay: true, days: 7, start: 0, end: 1440 });
  });
  it('a win marks the session done', () => {
    expect(upd({ win: 'wrote the intro' })[0].patch).toEqual({ win: { text: 'Wrote the intro', at: NOW_MS }, done: true });
  });
  it('an unknown category on update is created', () => {
    const r = fromModel([{ op: 'update', id: 'e1', cat: 'Origami' }], d, opsCtx(d));
    expect(r.fresh).toEqual(['Origami']);
    expect(r.updates[0].patch.cat).toBe('Origami');
  });
});

describe('fromModel: deletes', () => {
  const d = base();
  it('known ids only; aliases', () => {
    expect(fromModel([{ op: 'delete', id: 'e2' }, { op: 'remove', id: 'e3' }, { op: 'cancel', id: 'e404' }], d, opsCtx(d)).deletes).toEqual(['e2', 'e3']);
  });
});

describe('fromModel: goals', () => {
  const d = base();
  const g = (o: RawOp) => fromModel([{ op: 'goal', ...o }], d, opsCtx(d)).goals;
  it('new goal', () => {
    expect(g({ title: 'marathon', outcome: ' Sub 4 ', deadline: '2026-12-06', hours: 90 })).toEqual([
      { create: { title: 'Marathon', outcome: 'Sub 4', deadline: '2026-12-06', hours: 90 } },
    ]);
  });
  it('changing a goal by id sends only what is given', () => {
    expect(g({ id: 'g1', hours: 50 })).toEqual([{ id: 'g1', patch: { hours: 50 } }]);
    expect(g({ id: 'g1', deadline: '2026-12-31', outcome: 'New outcome' })).toEqual([{ id: 'g1', patch: { outcome: 'New outcome', deadline: '2026-12-31' } }]);
  });
  it('a goal title that matches an existing goal (any case) updates it instead of creating', () => {
    expect(g({ title: 'deep WORK', hours: 80 })).toEqual([{ id: 'g1', patch: { title: 'Deep WORK', hours: 80 } }]);
  });
  it('deleting', () => {
    expect(g({ id: 'g1', delete: true })).toEqual([{ id: 'g1', remove: true }]);
    expect(fromModel([{ op: 'delete_goal', id: 'g1' }, { op: 'goal_delete', id: 'g1' }], d, opsCtx(d)).goals).toEqual([{ id: 'g1', remove: true }, { id: 'g1', remove: true }]);
    expect(g({ title: 'Deep work', delete: true })).toEqual([{ id: 'g1', remove: true }]);
    expect(g({ title: 'Nothing like it', delete: true })).toEqual([]);
  });
  it('field aliases and clamps', () => {
    expect(g({ id: 'g1', result: 'R', by: '2026-11-30T10:00:00', hours: 99999 })).toEqual([{ id: 'g1', patch: { outcome: 'R', deadline: '2026-11-30', hours: 5000 } }]);
    expect(g({ id: 'g1', deadlineOffset: 10 })[0]).toEqual({ id: 'g1', patch: { deadline: dd(10) } });
    expect(g({ id: 'g1', deadlineOffset: 5000 })[0]).toEqual({ id: 'g1', patch: { deadline: dd(1500) } });
    expect(g({ id: 'g1', hours: -3 })[0]).toEqual({ id: 'g1', patch: { hours: 0 } });
    expect(g({ id: 'g1', deadline: 'soon' })[0]).toEqual({ id: 'g1', patch: {} });
  });
  it('"intent" is a goal; nothing to anchor it means nothing happens', () => {
    expect(fromModel([{ op: 'intent', text: 'Learn piano', hours: 10 }], d, opsCtx(d)).goals).toEqual([{ create: { title: 'Learn piano', hours: 10 } }]);
    expect(g({ hours: 5 })).toEqual([]);
  });
});

describe('applyResolved / applyOps', () => {
  it('create', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'create', title: 'standup', cat: 'Work', start: 570, end: 585 }, { op: 'create', title: 'Fold', cat: 'Origami', start: 900, end: 960 }], opsCtx(d));
    expect(res.empty).toBe(false);
    expect(res.data.events).toHaveLength(7);
    expect(res.data.events.slice(5).map((e) => e.id)).toEqual(['e6', 'e7']);
    expect(res.data.cats.Origami).toBe(350);
    expect(res.message).toBe('2 events added · new: Origami');
    expect(res.newIds).toEqual(['e6', 'e7']);
    expect(res.changes.map((c) => c.type)).toEqual(['category-created', 'event-created', 'event-created']);
    expect(res.history).toMatchObject({ label: 'Claude · 2 events added · new: Origami', kind: 'claude' });
    expect(res.focusMin).toBe(570);
    // the input is untouched
    expect(d.events).toHaveLength(5);
    expect(d.cats.Origami).toBeUndefined();
  });
  it('single create wording', () => {
    const d = base();
    expect(applyOps(d, [{ op: 'create', title: 'x', cat: 'Work', start: 60, end: 120 }], opsCtx(d)).message).toBe('1 event added');
  });
  it('update', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'update', id: 'e1', start: 900, end: 960 }, { op: 'update', id: 'e2', title: 'swim' }], opsCtx(d));
    expect(res.data.events.find((e) => e.id === 'e1')).toMatchObject({ start: 900, end: 960, title: 'Standup' });
    expect(res.data.events.find((e) => e.id === 'e2')?.title).toBe('Swim');
    expect(res.data.events).toHaveLength(5);
    expect(res.message).toBe('2 updated');
    expect(res.newIds).toEqual(['e1', 'e2']);
    const ch = res.changes[0];
    expect(ch.type === 'event-updated' && ch.before.start === 570 && ch.after.start === 900).toBe(true);
    expect(res.focusMin).toBe(480); // a title-only update counts as 08:00 (prototype behaviour)
  });
  it('delete', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'delete', id: 'e2' }, { op: 'delete', id: 'e404' }], opsCtx(d));
    expect(res.data.events.map((e) => e.id)).toEqual(['e1', 'e3', 'e4', 'e5']);
    expect(res.message).toBe('1 removed');
    expect(res.changes).toEqual([{ type: 'event-deleted', event: d.events[1] }]);
  });
  it('delete, update and create in one reply apply in that order', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'create', title: 'new', cat: 'Work', start: 60, end: 120 }, { op: 'delete', id: 'e2' }, { op: 'update', id: 'e1', end: 600 }], opsCtx(d));
    expect(res.message).toBe('1 event added · 1 updated · 1 removed');
    expect(res.data.events.map((e) => e.id)).toEqual(['e1', 'e3', 'e4', 'e5', 'e6']);
  });
  it('goal: create adds the goal and its category', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'goal', title: 'piano', outcome: 'Grade 3', deadline: dd(40), hours: 40 }], opsCtx(d, { random: lcg(7) }));
    expect(res.data.goals).toHaveLength(2);
    const ng = res.data.goals[1];
    expect(ng).toMatchObject({ title: 'Piano', cat: 'Piano', outcome: 'Grade 3', deadline: dd(40), hours: 40, start: TODAY_KEY, hue: 350 });
    expect(res.data.cats.Piano).toBe(350);
    expect(res.message).toBe('goal set');
    expect(res.changes).toEqual([{ type: 'goal-created', goal: ng }]);
  });
  it('goal: change keeps the rest', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'goal', id: 'g1', hours: 50, deadline: dd(30) }], opsCtx(d));
    expect(res.data.goals[0]).toMatchObject({ id: 'g1', hours: 50, deadline: dd(30), title: 'Deep work', cat: 'Deep work', hue: 240 });
    expect(res.message).toBe('goal set');
  });
  it('goal: renaming renames its category and its sessions', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'goal', id: 'g1', title: 'Focus time' }], opsCtx(d));
    expect(res.data.goals[0]).toMatchObject({ title: 'Focus time', cat: 'Focus time' });
    expect(res.data.cats['Deep work']).toBeUndefined();
    expect(res.data.cats['Focus time']).toBe(240);
    expect(res.data.events.find((e) => e.id === 'e3')?.cat).toBe('Focus time');
    expect(res.changes.map((c) => c.type)).toEqual(['category-renamed', 'goal-updated']);
  });
  it('goal: delete', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'goal', id: 'g1', delete: true }], opsCtx(d));
    expect(res.data.goals).toEqual([]);
    expect(res.message).toBe('goal removed');
    expect(res.data.events).toHaveLength(5); // sessions stay
    expect(res.changes).toEqual([{ type: 'goal-deleted', goal: d.goals[0] }]);
    expect(applyOps(d, [{ op: 'goal', id: 'g1', delete: true }, { op: 'goal', title: 'a', outcome: 'b', deadline: dd(9), hours: 3 }, { op: 'goal', title: 'b', outcome: 'b', deadline: dd(9), hours: 3 }], opsCtx(d)).message).toBe('2 goals set · goal removed');
  });
  it('a goal created in the same reply that already ended its sessions flags win candidates', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'create', title: 'Deep session', cat: 'Deep work', start: 540, end: 600, dayOffset: -1 }, { op: 'create', title: 'Later', cat: 'Deep work', start: 1300, end: 1360 }], opsCtx(d));
    expect(res.pastSessionIds).toEqual(['e6']);
  });
  it('nothing to do is reported as empty and changes nothing', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'delete', id: 'e404' }], opsCtx(d));
    expect(res).toMatchObject({ empty: true, message: 'Nothing to schedule there', history: null, changes: [] });
    expect(res.data).toBe(d);
    expect(isEmptyResolved(fromModel([], d, opsCtx(d)))).toBe(true);
  });
  it('src picks the history label; offline adds a note', () => {
    const d = base();
    const ops = [{ op: 'create', title: 'x', cat: 'Work', start: 60, end: 120 }];
    expect(applyOps(d, ops, opsCtx(d), 'local').history).toMatchObject({ label: 'Note · 1 event added', kind: 'parse' });
    const fb = applyOps(d, ops, opsCtx(d), 'fallback');
    expect(fb.history).toMatchObject({ label: 'Offline parse · 1 event added · offline parse', kind: 'parse' });
  });
  it('the history entry undoes the change', () => {
    const d = base();
    const res = applyOps(d, [{ op: 'delete', id: 'e2' }, { op: 'goal', id: 'g1', hours: 10 }], opsCtx(d));
    const entry = res.history!;
    expect(entry.before).toEqual(dataSnap(d));
    const back = restoreEntry(entry, res.data, NOW_MS + 5000, lcg(3));
    expect(dataSnap(back.data)).toEqual(dataSnap(d));
    expect(back.label).toBe('Reverted · ' + entry.label);
    expect(back.entry).toMatchObject({ kind: 'undo', label: back.label });
    // undoing an undo does not stack the prefix
    const again = restoreEntry(back.entry!, back.data, NOW_MS + 9000, lcg(4));
    expect(again.label).toBe(back.label);
    expect(pushHistory([entry], back.entry!).map((h) => h.kind)).toEqual(['undo', 'claude']);
  });
});

describe('interpretReply', () => {
  const d = base();
  const c = () => opsCtx(d);
  const ask = { op: 'ask', question: 'Which day?', options: [{ label: 'Today' }, { label: 'Tomorrow' }] };
  const create = { op: 'create', title: 'x', cat: 'Work', start: 60, end: 120 };
  it('questions come back as asks (when asking is on)', () => {
    const r = interpretReply([ask], d, c(), { askOn: true }) as { asks: unknown[]; rest: unknown };
    expect(r.asks).toHaveLength(1);
    expect(r.rest).toBeNull();
  });
  it('ops that arrive with questions are returned to apply straight away (goal conversations)', () => {
    const r = interpretReply([create, ask], d, c(), { askOn: true }) as { asks: unknown[]; rest: { events: unknown[] } };
    expect(r.asks).toHaveLength(1);
    expect(r.rest.events).toHaveLength(1);
  });
  it('goal adjustment always asks, even with asking off', () => {
    expect('asks' in (interpretReply([ask], d, c(), { askOn: false, goalAdjust: true }) as object)).toBe(true);
  });
  it('with asking off, or noAsk, questions are dropped and the rest resolved', () => {
    const r = interpretReply([create, ask], d, c(), { askOn: false }) as { events: unknown[] };
    expect(r.events).toHaveLength(1);
    expect(() => interpretReply([ask], d, c(), { askOn: false })).toThrow('empty');
    expect(() => interpretReply([ask], d, c(), { askOn: true, noAsk: true })).toThrow('empty');
  });
  it('empty replies throw', () => expect(() => interpretReply([], d, c(), { askOn: true })).toThrow('empty'));
  it('a question with too few options is not a question', () => {
    expect(() => interpretReply([{ op: 'ask', question: 'q', options: ['only'] }], d, c(), { askOn: true })).toThrow('empty');
  });
});

describe('prompt text', () => {
  it('NOASK is the exact sentence the skills expect', () => expect(NOASK).toBe('\n\nDo not ask any questions this time — make your best assumption and return the operations.'));
});

describe('misc', () => {
  it('applyResolved on a hand-built Resolved: updates apply before new events, and are applied to the right event', () => {
    const d = base();
    const c = opsCtx(d);
    const res = applyResolved(d, { events: [], cats: d.cats, fresh: [], updates: [{ id: 'e3', patch: { done: true } }], deletes: [], goals: [] }, c);
    expect(res.data.events.find((e) => e.id === 'e3')?.done).toBe(true);
    expect(res.data.events.find((e) => e.id === 'e1')?.done).toBeUndefined();
  });
  it('the now context is respected for the id generator', () => {
    const d = base();
    expect(makeIdGen(d.events)()).toBe('e6');
    expect(nowCtx().today).toBe(TODAY);
  });
});
