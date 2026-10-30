#!/usr/bin/env node
// Regenerates test/fixtures/golden.json by running the ORIGINAL prototype logic
// (the decoded `logic.js` from index.html) in Node and recording what it produces.
// The core tests then assert the TypeScript port gives identical results.
//
//   node scripts/gen-golden.mjs /path/to/proto/logic.js
//
// Only needed when the prototype changes; the fixture is committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const logicPath = process.argv[2];
if (!logicPath) { console.error('usage: gen-golden.mjs <logic.js>'); process.exit(1); }

/* ---- load the prototype with stubs ---- */
const NOW = new Date(2026, 9, 30, 14, 20).getTime(); // local time, Fri 30 Oct 2026 14:20
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const reseed = (s) => { seed = s; };
const src = fs.readFileSync(logicPath, 'utf8');
const fn = new Function('DCLogic', 'React', 'window', 'localStorage', 'document', 'location', 'history', src + '\nreturn { Component, paint, fmt, hm, hrs, dur, niceDate, snapHue };');
class DCLogic {
  constructor(p) { this.props = p || {}; }
  setState(patch, cb) {
    const v = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, v || {});
    if (cb) cb();
  }
}
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
};
Math.random = rnd;
const P = fn(DCLogic, { createRef: () => ({ current: null }) }, { innerWidth: 390 }, { getItem: () => null, setItem() {} }, {}, {}, {});

const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fresh = () => {
  const c = new P.Component({});
  c.fadeToast = () => {}; c.persist = () => {};
  c.lastSeen = NOW - 20 * 3600000;
  /* winCands is stubbed to [] in the prototype (dead code after `return []`); run the dead code. */
  c.winCands = () => {
    const tk = key(c.today), yk = key(new Date(c.today.getFullYear(), c.today.getMonth(), c.today.getDate() - 1)), now = Date.now();
    return (c.state.events || []).filter((e) => (e.day === tk || e.day === yk) && !e.allDay && !e.win && !e.winAsked
      && c.evEndMs(e) <= now && c.evEndMs(e) > now - 30 * 3600000 && c.goalOf(e)).sort((a, b) => c.evEndMs(a) - c.evEndMs(b)).slice(-3);
  };
  return c;
};
const sym = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v === NOW ? 'NOW' : typeof v === 'string' ? v.split(NOW.toString(36)).join('{now36}') : v)));

const c0 = fresh();
const data = sym({ events: c0.state.events, cats: c0.state.cats, goals: c0.state.goals });
const out = { today: key(c0.today), nowMin: c0.state.nowMin, uid: c0.uid, data };

/* goal maths on the prototype's own sample data */
out.goals = {};
c0.state.goals.forEach((g) => {
  const s = c0.goalStats(g), R = s.rate, p = c0.paceOf(g);
  const sp = c0.goalSpan(g);
  out.goals[g.id] = sym({
    span: [key(sp.s0), key(sp.s1)], rate: R,
    stats: Object.assign({}, s, { s0: key(s.s0), s1: key(s.s1), rate: undefined }),
    pace: c0.goalPace(g, s), due: c0.goalDue(g), math: c0.goalMath(g), paceOf: { word: p.word, num: p.num },
    load: c0.goalLoad(g, c0.state.events), block: c0.goalBlock(g, 'reduce'),
  });
});
out.weeklyLoad = c0.weeklyLoad();
out.activeGoals = c0.activeGoals().map((g) => g.id);
out.freeSlot = {};
[0, 1, -1].forEach((o) => [30, 120, 600].forEach((m) => { const dk = key(new Date(c0.today.getFullYear(), c0.today.getMonth(), c0.today.getDate() + o)); out.freeSlot[o + ':' + m] = c0.freeSlot(dk, m); }));
out.calBlock = c0.calBlock();
out.ciPrompt = c0.ciPrompt();
out.ciLocalQs = c0.ciLocalQs();
out.winCands = c0.winCands().map((e) => e.id);

/* a few other timelines: later in the day */
out.late = {};
[0, 480, 1200].forEach((nm) => {
  const c = fresh(); c.state.nowMin = nm;
  out.late[nm] = { stats: c.state.goals.map((g) => { const s = c.goalStats(g); return { id: g.id, done: s.done, delta: s.delta, frac: s.frac, expected: s.expected }; }), calBlock: c.calBlock().split('\n')[1] };
});

/* AI ops: fromModel + commit */
const opsCases = {
  create_basic: [{ op: 'create', title: 'standup', cat: 'Work', start: 570, end: 585, dayOffset: 0 }],
  create_overnight: [{ op: 'create', title: 'Sleep', cat: 'Health', start: 1320, end: 480, dayOffset: 0 }],
  create_alias_cat: [{ op: 'create', title: 'Lunch with Dan', cat: 'Lunch', start: 750, end: 795 }, { op: 'create', title: 'Brand new thing', cat: 'Origami', start: 900, end: 960 }],
  create_allday: [{ op: 'create', title: 'Lisbon trip', cat: 'Travel', allDay: true, dayOffset: 4, days: 3 }, { op: 'create', title: 'Launch week', cat: 'Work', allDay: true, span: 'week', weekOffset: 1 }],
  create_win: [{ op: 'create', title: 'Novel', cat: 'Novel', start: 840, end: 1020, dayOffset: -1, win: 'finished chapter 3' }],
  create_clamps: [{ op: 'create', title: 'x', start: 1500, end: 1501, dayOffset: 99 }, { op: 'create', title: 'y', start: 600, end: 600 }, { op: 'create', title: 'z', start: 600, end: 30 }, { op: 'create', title: 'w' }],
  update_move: [{ op: 'update', id: 'e22', start: 900, end: 960 }, { op: 'update', id: 'e23', title: 'sync layer part 3', cat: 'Work', dayOffset: 1 }],
  update_allday: [{ op: 'update', id: 'e24', allDay: true, days: 2 }, { op: 'update', id: 'e25', span: 'week' }],
  delete: [{ op: 'delete', id: 'e22' }, { op: 'delete', id: 'e404' }],
  goal_create: [{ op: 'goal', title: 'piano', outcome: 'Grade 3', deadline: '2026-12-06', hours: 40 }],
  goal_change: [{ op: 'goal', id: 'g2', hours: 50 }, { op: 'goal', id: 'g3', title: 'Books', deadline: '2026-11-20' }],
  goal_delete: [{ op: 'goal', id: 'g1', delete: true }],
  mixed: [{ op: 'create', title: 'Gym', start: 420, end: 480 }, { op: 'update', id: 'e22', end: 1000 }, { op: 'delete', id: 'e23' }, { op: 'goal', title: 'Marathon training', hours: 100 }],
};
out.ops = {};
Object.keys(opsCases).forEach((name) => {
  const c = fresh();
  reseed(99);
  const r = c.fromModel(opsCases[name]);
  const before = JSON.stringify({ e: c.state.events, c: c.state.cats, g: c.state.goals });
  reseed(99);
  c.commit(r, 'claude');
  const h = c.state.log[0];
  out.ops[name] = sym({
    input: opsCases[name], resolved: r, uid: c.uid,
    after: { events: c.state.events, cats: c.state.cats, goals: c.state.goals }, message: c.state.toast, newIds: c.state.newIds,
    history: h ? { label: h.label, kind: h.kind } : null, unchanged: before === JSON.stringify({ e: c.state.events, c: c.state.cats, g: c.state.goals }),
  });
});

/* validators */
const vOps = [
  [{ op: 'create', title: 'Standup', cat: 'Work', start: 570, end: 585, dayOffset: 0 }],
  [],
  [{ op: 'create', title: '', start: 1, end: 2 }],
  [{ op: 'create', title: 'x', start: 600 }],
  [{ op: 'create', title: 'x', start: 600, end: 2100 }],
  [{ op: 'create', title: 'x', start: 600, end: 500 }],
  [{ op: 'create', title: 'x', allDay: true, days: 0 }],
  [{ op: 'create', title: 'x', start: 1, end: 2, dayOffset: '1' }],
  [{ op: 'update', id: 'e404', start: 1, end: 1 }],
  [{ op: 'delete', id: 'e22' }, { op: 'delete', id: 'nope' }],
  [{ op: 'goal', title: 'M', outcome: 'o', deadline: '2026-12-06', hours: 90 }],
  [{ op: 'goal', title: 'M', hours: 0, deadline: '2026-01-01' }],
  [{ op: 'goal', id: 'g404', deadline: '6 Dec' }],
  [{ op: 'ask', question: 'Which day?', options: [{ label: 'a' }, { label: 'b' }] }],
  [{ op: 'ask', question: '', options: [{ label: 'a' }] }],
  [{ op: 'ask', question: 'q1', options: ['a', 'b'] }, { op: 'ask', question: 'q2', options: ['a', 'b'] }, { op: 'ask', question: 'q3', options: ['a', 'b'] }, { op: 'ask', question: 'q4', options: ['a', 'b'] }],
  [{ op: 'ask', question: 'q', options: ['a', 'b'] }, { op: 'create', title: 'x', start: 1, end: 2 }],
  [{ op: 'frobnicate' }, null, 5],
];
out.checkOps = [];
vOps.forEach((arr) => { const c = fresh(); out.checkOps.push({ input: arr, noAsk: [c.checkOps(arr, false), c.checkOps(arr, true)] }); });

const c1 = fresh();
const wc = c1.winCands().map((e) => e.id);
const vCi = [
  [{ field: 'goal', q: 'Behind?', id: 'g1' }, { field: 'log', q: 'Walk?', chips: ['07:30'] }],
  [{ field: 'log', q: 'only one' }],
  [{ field: 'log', q: 'a' }, { field: 'goal', q: 'late goal', id: 'g1' }],
  [{ field: 'goal', q: 'x', id: 'g404' }, { field: 'log', q: 'y' }],
  [{ field: 'goal', q: 'x', id: 'g1' }, { field: 'goal', q: 'y', id: 'g2' }, { field: 'log', q: 'z' }],
  [{ field: 'log', q: 'a', chips: ['1', '2', '3', '4'] }, { field: 'other', q: 'b' }, { field: 'log' }],
  [{ field: 'win', q: 'w', id: 'e404' }],
];
out.winIds = wc;
out.checkCi = vCi.map((arr) => ({ input: arr, issues: c1.checkCi(arr) }));

/* offline parser */
const notes = ['gym at 7am then lunch with Dan 12:30-1:30 and dentist at 3pm tomorrow', 'standup 9:30 for 15 minutes, review PRs, call mum', 'dinner at 7pm for 2 hours\nwalk the dog', 'novel writing until 5pm', 'sleep 10pm-6am', 'run yesterday at 6:30am for an hour', 'lunch at noon for half an hour then call Sam 1pm', 'plant the garden', 'zumba at 6 pm'];
out.parse = {};
[0, 860].forEach((nm) => {
  out.parse[nm] = notes.map((note) => { const c = fresh(); c.state.nowMin = nm; reseed(5); const r = c.parse(note); return sym({ note, events: r.events, cats: r.cats, fresh: r.fresh }); });
});

/* paint */
out.paint = {};
[28, 60, 125, 170, 240, 290, 350, 1000].forEach((h) => { out.paint[h] = P.paint(h); });

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'golden.json');
fs.writeFileSync(dest, JSON.stringify(sym(out), null, 1) + '\n');
console.log('wrote', dest);
