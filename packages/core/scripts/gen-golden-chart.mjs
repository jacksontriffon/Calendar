#!/usr/bin/env node
// Regenerates test/fixtures/golden-chart.json: what the ORIGINAL prototype's goals graph computes
// (buckets, cumulative bars, y max, gridlines, pace line, deadline dot) for the golden sample data.
//
//   node scripts/gen-golden-chart.mjs "/path/to/AI Calendar Web.dc.html"
//
// It slices the prototype's own `gcBk`/`gcSer`/`gcMax`/`gcLines`/`gcGrid` source out of the artifact
// and evaluates it, with small stand-ins for the goal maths it calls on `this` (goalSpan, goalRate,
// goalHours). Those stand-ins are written here from the prototype's rules, independent of the TS port.
// Only needed when the prototype's graph changes; the fixture is committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(process.argv[2] || '', 'utf8');
const here = path.dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(fs.readFileSync(path.join(here, '../test/fixtures/golden.json'), 'utf8'));

const slice = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('prototype source not found: ' + from);
  return html.slice(a, b);
};
const bodySrc = slice('const gcSpans =', 'const gcCard =');
const linesSrc = slice('      gcLines:', '      gcDots:');
const gridSrc = slice('      gcGrid: (() => {', '      gcCols:');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dnum = (k) => new Date(String(k).replace(/-/g, '/'));
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const hrs = (n) => { const r = Math.round((Number(n) || 0) * 10) / 10; return Math.abs(r) < 10 ? String(r).replace(/\.0$/, '') : String(Math.round(r)); };
const paint = () => ({});
const today = dnum(G.today);
const wk0 = (() => { const m = new Date(today.getFullYear(), today.getMonth(), today.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; })();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const inGoal = (e, g) => {
  if (e.goalId === g.id || e.cat === g.cat) return true;
  const t = norm(e.title);
  return t.length >= 4 && [norm(g.title), norm(g.cat)].some((x) => x && (x === t || x.indexOf(t + ' ') === 0));
};
const self = {
  today,
  goalHue: (g) => g.hue,
  goalSpan: (g) => {
    const s0 = dnum(g.start || key(today));
    let s1 = addDays(dnum(g.deadline), 1);
    if (!(s1 > s0)) s1 = addDays(s0, 1);
    return { s0, s1 };
  },
  goalRate: (g) => {
    const sp = self.goalSpan(g);
    return { target: Math.max(0, Number(g.hours) || 0), total: Math.max(1, Math.round((sp.s1 - sp.s0) / 864e5)) };
  },
  goalHours: (g, a, b) => G.data.events.reduce((h, e) => {
    if (e.allDay || !e.done || !inGoal(e, g)) return h;
    const d = dnum(e.day);
    return d < a || d >= b ? h : h + (e.end - e.start) / 60;
  }, 0),
};
const sortedGoals = G.data.goals.slice().sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));

const run = (gcUnit, gcList) => {
  const gcMo = gcUnit === 'month';
  const fn = new Function('self', 'gcUnit', 'gcMo', 'gcList', 'wk0', 'clamp', 'addDays', 'MON', 'DOW', 'paint', 'hrs', 'key', 'linesSrc', 'gridSrc',
    bodySrc.replace(/this\./g, 'self.') + `
    const lines = eval('({' + linesSrc.replace(/this\\./g, 'self.').replace(/,\\s*$/, '') + '})').gcLines;
    const grid = eval('({' + gridSrc.replace(/this\\./g, 'self.').replace(/,\\s*$/, '') + '})').gcGrid;
    return { gcBk, gcSer, gcMax, gcScroll: self._gcScroll, gcT2X, lines, grid, gcN, gcVis };`);
  const r = fn(self, gcUnit, gcMo, gcList, wk0, clamp, addDays, MON, DOW, paint, hrs, key, linesSrc, gridSrc);
  return {
    n: r.gcN, vis: r.gcVis, scrollAt: r.gcScroll.at, max: r.gcMax,
    buckets: r.gcBk.map((b) => ({ a: key(b.a), b: key(b.b), label: b.label })),
    series: r.gcSer.map((s) => ({
      id: s.g.id, target: s.R.target,
      cells: s.cells.map((c) => ({ on: c.on, fut: c.fut, exp: c.exp, h: c.h })),
    })),
    grid: r.grid.map((g) => ({ label: g.label, bottom: g.style.bottom })),
    lines: r.lines.map((l) => l.points),
    dots: r.gcSer.filter((s) => s.R.target > 0).map((s) => ({ id: s.g.id, cx: r.gcT2X(self.goalSpan(s.g).s1) })),
  };
};

const out = { today: G.today, units: {}, detail: {} };
for (const u of ['day', 'week', 'month']) {
  out.units[u] = run(u, sortedGoals);
  out.detail[u] = {};
  for (const g of sortedGoals) out.detail[u][g.id] = run(u, [g]);
}
fs.writeFileSync(path.join(here, '../test/fixtures/golden-chart.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote golden-chart.json', Object.keys(out.units).map((u) => u + ':' + out.units[u].n).join(' '));
