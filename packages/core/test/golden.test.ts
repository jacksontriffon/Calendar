/**
 * Cross-checks the port against the ORIGINAL prototype.
 *
 * test/fixtures/golden.json was produced by running the decoded prototype
 * (`logic.js`) in Node on its own sample data at Fri 30 Oct 2026 14:20, see
 * scripts/gen-golden.mjs. Everything below must reproduce those values exactly.
 */
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden.json' with { type: 'json' };
import {
  activeGoals, applyResolved, calBlock, checkCi, checkOps, ciLocalQs, ciPrompt, dnum, freeSlot, fromModel, goalBlock, goalDue,
  goalLoad, goalMath, goalPace, goalRate, goalSpan, goalStats, key, makeIdGen, paceOf, paintCss, parseNote, weeklyLoad, winCands,
} from '../src/index.ts';
import type { CalendarData, ProtoEvent, Resolved } from '../src/index.ts';
import { NOW_MS, TODAY, TODAY_KEY, lcg, nowCtx, revive } from './helpers.ts';

const G = revive(golden) as unknown as {
  today: string; nowMin: number; uid: number; data: CalendarData;
  goals: Record<string, { span: string[]; rate: unknown; stats: Record<string, unknown>; pace: string; due: string; math: string; paceOf: { word: string; num: string }; load: number; block: string }>;
  weeklyLoad: number; activeGoals: string[]; freeSlot: Record<string, number>; calBlock: string; ciPrompt: string; ciLocalQs: unknown[]; winCands: string[];
  late: Record<string, { stats: Array<Record<string, number | string>>; calBlock: string }>;
  ops: Record<string, { input: unknown[]; resolved: Resolved; uid: number; after: CalendarData; message: string; newIds: string[]; history: { label: string; kind: string } | null; unchanged: boolean }>;
  checkOps: Array<{ input: unknown[]; noAsk: [string[], string[]] }>;
  winIds: string[];
  checkCi: Array<{ input: unknown[]; issues: string[] }>;
  parse: Record<string, Array<{ note: string; events: ProtoEvent[]; cats: Record<string, number>; fresh: string[] }>>;
  paint: Record<string, Record<string, string>>;
};

const data = G.data;
const ctx = nowCtx();
const lastSeen = NOW_MS - 20 * 3600000;

describe('golden: fixture sanity', () => {
  it('is the instant the tests assume', () => {
    expect(G.today).toBe(TODAY_KEY);
    expect(G.nowMin).toBe(14 * 60 + 20);
    expect(data.events.length).toBe(26);
  });
});

describe('golden: goal maths matches the prototype', () => {
  data.goals.forEach((g) => {
    const want = G.goals[g.id];
    it(g.title + ': span, rate, stats', () => {
      const sp = goalSpan(g, TODAY);
      expect([key(sp.s0), key(sp.s1)]).toEqual(want.span);
      expect(goalRate(g, TODAY)).toEqual(want.rate);
      const s = goalStats(g, data.events, ctx);
      const got: Record<string, unknown> = { ...s, s0: key(s.s0), s1: key(s.s1), rate: undefined };
      expect(JSON.parse(JSON.stringify(got))).toEqual(want.stats);
    });
    it(g.title + ': pace text, due, math, load, prompt block', () => {
      const s = goalStats(g, data.events, ctx);
      expect(goalPace(g, s)).toBe(want.pace);
      expect(goalDue(g, TODAY)).toBe(want.due);
      expect(goalMath(g, TODAY)).toBe(want.math);
      const p = paceOf(g, data.events, ctx);
      expect({ word: p.word, num: p.num }).toEqual(want.paceOf);
      expect(goalLoad(g, data.events, TODAY)).toBe(want.load);
      expect(goalBlock(g.id, 'reduce', data, ctx)).toBe(want.block);
    });
  });

  it('weekly load and active goals', () => {
    expect(weeklyLoad(data.goals, data.events, ctx)).toBe(G.weeklyLoad);
    expect(activeGoals(data.goals, data.events, ctx).map((g) => g.id)).toEqual(G.activeGoals);
  });

  it('progress through the day (frac, delta) at different times', () => {
    Object.keys(G.late).forEach((nm) => {
      const c = nowCtx({ nowMin: Number(nm) });
      const got = data.goals.map((g) => { const s = goalStats(g, data.events, c); return { id: g.id, done: s.done, delta: s.delta, frac: s.frac, expected: s.expected }; });
      expect(got).toEqual(G.late[nm].stats);
      expect(calBlock(data, c).split('\n')[1]).toBe(G.late[nm].calBlock);
    });
  });

  it('freeSlot', () => {
    Object.keys(G.freeSlot).forEach((k) => {
      const [o, m] = k.split(':').map(Number);
      const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + o);
      expect(freeSlot(data.events, key(d), m, ctx)).toBe(G.freeSlot[k]);
    });
  });
});

describe('golden: prompt blocks', () => {
  it('<calendar>', () => expect(calBlock(data, ctx)).toBe(G.calBlock));
  it('<checkin>', () => expect(ciPrompt(data, ctx, lastSeen)).toBe(G.ciPrompt));
  it('offline check-in questions', () => expect(ciLocalQs(data, ctx)).toEqual(G.ciLocalQs));
  it('goal sessions waiting for a win', () => expect(winCands(data.events, data.goals, TODAY, NOW_MS).map((e) => e.id)).toEqual(G.winCands));
});

describe('golden: AI ops resolve and apply like the prototype', () => {
  Object.keys(G.ops).forEach((name) => {
    it(name, () => {
      const w = G.ops[name];
      const c = { today: TODAY, nowMin: G.nowMin, nowMs: NOW_MS, nextId: makeIdGen(data.events, G.uid), random: lcg(99) };
      const r = fromModel(w.input, data, c);
      expect(r).toEqual(w.resolved);
      const res = applyResolved(data, r, { ...c, random: lcg(99) }, 'claude');
      expect(res.data).toEqual(w.after);
      expect(res.message).toBe(w.message);
      expect(res.newIds).toEqual(w.newIds);
      expect(res.history ? { label: res.history.label, kind: res.history.kind } : null).toEqual(w.history);
    });
  });
});

describe('golden: validators', () => {
  G.checkOps.forEach((c, i) => {
    it('checkOps #' + i + ' ' + JSON.stringify(c.input).slice(0, 60), () => {
      expect(checkOps(c.input, data, TODAY, false)).toEqual(c.noAsk[0]);
      expect(checkOps(c.input, data, TODAY, true)).toEqual(c.noAsk[1]);
    });
  });
  G.checkCi.forEach((c, i) => {
    it('checkCi #' + i, () => expect(checkCi(c.input, data, G.winIds)).toEqual(c.issues));
  });
});

describe('golden: offline parser', () => {
  Object.keys(G.parse).forEach((nm) => {
    G.parse[nm].forEach((w) => {
      it('"' + w.note.replace(/\n/g, ' / ') + '" at minute ' + nm, () => {
        const r = parseNote(w.note, { cats: data.cats }, { today: TODAY, nowMin: Number(nm), nowMs: NOW_MS, nextId: makeIdGen(data.events, G.uid), random: lcg(5) });
        expect({ events: r.events, cats: r.cats, fresh: r.fresh }).toEqual({ events: w.events, cats: w.cats, fresh: w.fresh });
      });
    });
  });
});

describe('golden: tokens', () => {
  it('paintCss reproduces the prototype color-mix strings', () => {
    Object.keys(G.paint).forEach((h) => expect(paintCss(Number(h))).toEqual(G.paint[h]));
  });
  it('dnum round-trips keys', () => expect(key(dnum(TODAY_KEY))).toBe(TODAY_KEY));
});
