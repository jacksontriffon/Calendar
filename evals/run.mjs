#!/usr/bin/env node
// Runs every case in cases/*.json through the real app N times and scores the result.
// Usage: ANTHROPIC_API_KEY=... node run.mjs [--trials 3] [--model id] [--transport inline|skills]
//        [--only id,category] [--concurrency 4] [--save-baseline]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startHarness } from './lib/harness.mjs';
import { grade } from './lib/grade.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({
  options: {
    trials: { type: 'string', default: '3' },
    model: { type: 'string' },
    transport: { type: 'string', default: 'inline' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'save-baseline': { type: 'boolean', default: false },
  },
});

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('Set ANTHROPIC_API_KEY to run the eval.'); process.exit(2); }
const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cal = readJson(path.join(HERE, 'cases', 'calendar.json'));
let cases = fs.readdirSync(path.join(HERE, 'cases'))
  .filter((f) => f.endsWith('.json') && f !== 'calendar.json')
  .flatMap((f) => readJson(path.join(HERE, 'cases', f)));
if (opt.only) {
  const keep = new Set(opt.only.split(','));
  cases = cases.filter((c) => keep.has(c.id) || keep.has(c.category));
}
const trials = Number(opt.trials);
const modelLabel = opt.model || 'claude-haiku-4-5';

const usage = (calls) => calls.reduce((u, c) => {
  const x = (c.json && c.json.usage) || {};
  u.input += (x.input_tokens || 0) + (x.cache_read_input_tokens || 0) + (x.cache_creation_input_tokens || 0);
  u.output += x.output_tokens || 0;
  return u;
}, { input: 0, output: 0 });

const h = await startHarness({ apiKey, baseUrl, model: opt.model, transport: opt.transport });
const records = [];
try {
  await h.prepareSkills(cal);
  const jobs = cases.flatMap((c) => Array.from({ length: trials }, (_, t) => ({ c, t })));
  let next = 0, done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { c, t } = jobs[next++];
      const events = c.events || cal.events;
      const t0 = Date.now();
      let rec;
      try {
        const out = await h.runNote(cal, events, c.note, !!c.noAsk);
        const g = grade(out.final, c.expect, events), gs = grade(out.schedOnly, c.expect, events);
        rec = {
          id: c.id, category: c.category, trial: t, pass: g.pass, reasons: g.reasons,
          schedPass: gs.pass, schedReasons: gs.reasons,
          verifierChanged: JSON.stringify(out.final.ops) !== JSON.stringify(out.schedOnly.ops),
          ms: Date.now() - t0, usage: usage(out.calls),
          httpErrors: out.calls.filter((x) => x.status >= 400).map((x) => `${x.kind} HTTP ${x.status}: ${(x.json && x.json.error && x.json.error.message) || x.raw || ''}`),
          final: out.final, schedOnly: out.schedOnly,
        };
      } catch (e) {
        rec = { id: c.id, category: c.category, trial: t, pass: false, reasons: ['harness: ' + e.message], schedPass: false, schedReasons: [], ms: Date.now() - t0, usage: { input: 0, output: 0 } };
      }
      records.push(rec);
      done++;
      process.stderr.write(`\r${done}/${jobs.length} runs`);
    }
  };
  await Promise.all(Array.from({ length: Number(opt.concurrency) }, worker));
  process.stderr.write('\n');
} finally {
  await h.close();
}

// ---------- report ----------
const rate = (rs, k = 'pass') => (rs.length ? rs.filter((r) => r[k]).length / rs.length : 0);
const pct = (x) => (x * 100).toFixed(0) + '%';
const byCase = cases.map((c) => {
  const rs = records.filter((r) => r.id === c.id);
  const firstFail = rs.find((r) => !r.pass);
  return { id: c.id, category: c.category, rate: rate(rs), schedRate: rate(rs, 'schedPass'), n: rs.length, reason: firstFail ? firstFail.reasons[0] : '' };
});
const categories = [...new Set(cases.map((c) => c.category))].map((cat) => {
  const rs = records.filter((r) => r.category === cat);
  return { category: cat, rate: rate(rs), schedRate: rate(rs, 'schedPass'), n: rs.length };
});
const summary = {
  model: modelLabel, transport: opt.transport, trials, at: new Date().toISOString(),
  passRate: rate(records), schedPassRate: rate(records, 'schedPass'),
  verifierFixed: records.filter((r) => !r.schedPass && r.pass).length,
  verifierBroke: records.filter((r) => r.schedPass && !r.pass).length,
  tokens: records.reduce((u, r) => ({ input: u.input + r.usage.input, output: u.output + r.usage.output }), { input: 0, output: 0 }),
  avgSeconds: records.reduce((s, r) => s + r.ms, 0) / Math.max(1, records.length) / 1000,
  byCase, categories,
};

console.log(`\nModel ${modelLabel} · transport ${opt.transport} · ${trials} trial(s) per case\n`);
console.log('| Case | Category | Final | Scheduler only | First failure |');
console.log('|---|---|---|---|---|');
for (const c of byCase) console.log(`| ${c.id} | ${c.category} | ${pct(c.rate)} | ${pct(c.schedRate)} | ${c.reason.replace(/\|/g, '/').slice(0, 140)} |`);
console.log('\n| Category | Final | Scheduler only | Runs |');
console.log('|---|---|---|---|');
for (const c of categories) console.log(`| ${c.category} | ${pct(c.rate)} | ${pct(c.schedRate)} | ${c.n} |`);
console.log(`\nOverall: ${pct(summary.passRate)} final, ${pct(summary.schedPassRate)} scheduler only. Verifier fixed ${summary.verifierFixed}, broke ${summary.verifierBroke}.`);
console.log(`Tokens: ${summary.tokens.input} in / ${summary.tokens.output} out · ${summary.avgSeconds.toFixed(1)}s per note on average.`);
const httpErr = records.flatMap((r) => r.httpErrors || []);
if (httpErr.length) console.log(`HTTP errors (${httpErr.length}), first: ${httpErr[0].slice(0, 300)}`);

// ---------- standard ----------
const std = readJson(path.join(HERE, 'standard.json'));
const baselinePath = path.join(HERE, 'results', 'baseline.json');
const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : null;
const misses = [];
if (summary.passRate < std.minPassRate) misses.push(`overall ${pct(summary.passRate)} < ${pct(std.minPassRate)}`);
for (const c of categories) if (c.rate < std.minCategoryPassRate) misses.push(`${c.category} ${pct(c.rate)} < ${pct(std.minCategoryPassRate)}`);
if (baseline && !opt.only) {
  for (const c of byCase) {
    const b = baseline.byCase.find((x) => x.id === c.id);
    if (b && b.rate - c.rate > std.maxCaseDropVsBaseline) misses.push(`${c.id} dropped ${pct(b.rate)} → ${pct(c.rate)} vs baseline`);
  }
}
console.log(misses.length ? `\nBelow standard:\n- ${misses.join('\n- ')}` : '\nMeets the standard.');

const runsDir = path.join(HERE, 'results', 'runs');
fs.mkdirSync(runsDir, { recursive: true });
const stamp = summary.at.replace(/[:.]/g, '-');
const runFile = path.join(runsDir, `${stamp}-${modelLabel}-${opt.transport}.json`);
fs.writeFileSync(runFile, JSON.stringify({ summary, records }, null, 1));
console.log(`Full records: ${path.relative(process.cwd(), runFile)}`);
if (opt['save-baseline']) {
  fs.writeFileSync(baselinePath, JSON.stringify(summary, null, 1) + '\n');
  console.log(`Saved baseline: ${path.relative(process.cwd(), baselinePath)}`);
}
process.exit(misses.length ? 1 : 0);
