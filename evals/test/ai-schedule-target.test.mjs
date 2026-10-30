// The `--target ai-schedule` path, against a local stand-in for the edge function. No API calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAiScheduleTarget } from '../lib/ai-schedule.mjs';
import { grade } from '../lib/grade.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cal = JSON.parse(fs.readFileSync(path.join(HERE, '../cases/calendar.json'), 'utf8'));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, '../cases/scheduler.json'), 'utf8')).map((c) => [c.id, c]));

const ok = (o) => ({ status: 200, body: { ok: true, model: 'claude-haiku-4-5', transport: 'inline', issues: [], usage: { used: 1, limit: 200, resetsOn: '2026-10-01' }, ...o } });
const stub = (fn) => (async (url, init) => {
  const r = fn(JSON.parse(init.body), init);
  return new Response(JSON.stringify(r.body), { status: r.status });
});

test('sends the case calendar and note, and the ops resolve into a gradable outcome', async () => {
  let seen;
  const c = cases['create-basic'];
  const t = createAiScheduleTarget({
    url: 'http://fn.test', jwt: 'jwt-1',
    fetchImpl: stub((body, init) => {
      seen = { body, auth: init.headers.authorization };
      return ok({ ops: [{ op: 'create', title: 'Haircut', cat: 'Routine', dayOffset: 1, start: 900, end: 960 }], firstOps: [{ op: 'create', title: 'Haircut', cat: 'Routine', dayOffset: 1, start: 900, end: 960 }], firstIssues: [] });
    }),
  });
  const out = await t.runNote(cal, cal.events, c.note, false);
  assert.equal(seen.auth, 'Bearer jwt-1');
  assert.deepEqual({ mode: seen.body.mode, note: seen.body.note, noAsk: seen.body.noAsk, today: seen.body.today, nowMin: seen.body.nowMin, tz: seen.body.tz, debug: seen.body.debug },
    { mode: 'note', note: 'haircut tomorrow at 3pm', noAsk: false, today: '2026-09-23', nowMin: 540, tz: 'UTC', debug: true });
  assert.deepEqual(seen.body.data.cats, cal.cats);
  assert.equal(seen.body.data.events.length, cal.events.length);
  assert.equal(out.final.creates[0].day, '2026-09-24');
  assert.equal(grade(out.final, c.expect, cal.events).pass, true);
  assert.equal(grade(out.schedOnly, c.expect, cal.events).pass, true);
  assert.deepEqual(t.describe(), { model: 'claude-haiku-4-5', transport: 'inline' });
});

test('final and scheduler-only are graded separately (the verifier fixed it)', async () => {
  const c = cases['update-move-lookalike'];
  const t = createAiScheduleTarget({
    url: 'http://fn.test', jwt: 'j',
    fetchImpl: stub(() => ok({
      ops: [{ op: 'update', id: 'e3', dayOffset: 2, start: 840, end: 900 }], issues: [],
      firstOps: [{ op: 'update', id: 'e5', dayOffset: 2, start: 840, end: 870 }], firstIssues: [],
    })),
  });
  const out = await t.runNote(cal, cal.events, c.note, false);
  assert.equal(grade(out.final, c.expect, cal.events).pass, true);
  assert.equal(grade(out.schedOnly, c.expect, cal.events).pass, false);
});

test('questions come back as asks; noAsk drops them', async () => {
  const asks = [{ op: 'ask', question: 'Which gym?', options: ['A', 'B'] }];
  const t = createAiScheduleTarget({ url: 'u', jwt: 'j', fetchImpl: stub(() => ok({ ops: asks, firstOps: asks })) });
  const out = await t.runNote(cal, cal.events, 'gym', false);
  assert.equal(out.final.asks.length, 1);
  assert.equal(grade(out.final, { asks: true }, cal.events).pass, true);
  const none = await t.runNote(cal, cal.events, 'gym', true);
  assert.equal(none.final.error, 'empty');
});

test('code-check findings from the server fail the case', async () => {
  const c = cases['create-basic'];
  const ops = [{ op: 'create', title: 'Haircut', cat: 'Routine', dayOffset: 1, start: 900, end: 960 }];
  const t = createAiScheduleTarget({ url: 'u', jwt: 'j', fetchImpl: stub(() => ok({ ops, firstOps: ops, issues: ['#1 something is off'], firstIssues: [] })) });
  const out = await t.runNote(cal, cal.events, c.note, false);
  const g = grade(out.final, c.expect, cal.events);
  assert.equal(g.pass, false);
  assert.match(g.reasons.join(), /code check: #1 something is off/);
});

test('rate limits are waited out; the monthly limit and server errors are reported', async () => {
  const waits = [];
  let n = 0;
  const t = createAiScheduleTarget({
    url: 'u', jwt: 'j', sleep: async (ms) => { waits.push(ms); },
    fetchImpl: stub(() => (++n < 3 ? { status: 429, body: { error: 'rate_limit', retryAfter: 4 } } : ok({ ops: [{ op: 'delete', id: 'e1' }], firstOps: [{ op: 'delete', id: 'e1' }] }))),
  });
  const out = await t.runNote(cal, cal.events, 'cancel standup', false);
  assert.deepEqual(out.final.deletes, ['e1']);
  assert.equal(n, 3);
  assert.deepEqual(waits, [4250, 4250]);

  const limited = createAiScheduleTarget({ url: 'u', jwt: 'j', fetchImpl: stub(() => ({ status: 429, body: { error: 'limit', used: 200, limit: 200, resetsOn: '2026-11-01' } })) });
  await assert.rejects(() => limited.runNote(cal, cal.events, 'x', false), /AI_MONTHLY_LIMIT/);

  const down = createAiScheduleTarget({ url: 'u', jwt: 'j', fetchImpl: stub(() => ({ status: 502, body: { error: 'upstream_unavailable' } })) });
  const d = await down.runNote(cal, cal.events, 'x', false);
  assert.match(d.final.error, /ai-schedule HTTP 502: upstream_unavailable/);
  assert.equal(d.calls[0].status, 502);

  const bad = createAiScheduleTarget({ url: 'u', jwt: 'j', fetchImpl: stub(() => ({ status: 502, body: { error: 'bad_reply', detail: 'no JSON' } })) });
  assert.equal((await bad.runNote(cal, cal.events, 'x', false)).final.error, 'no JSON');
});

test('run.mjs --target ai-schedule end to end against a local server', async () => {
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      const body = JSON.parse(b);
      const ops = [{ op: 'create', title: 'Haircut', cat: 'Routine', dayOffset: 1, start: 900, end: 960 }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, model: 'claude-haiku-4-5', transport: 'skills', ops, firstOps: ops, issues: [], firstIssues: [], echoed: body.note }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/functions/v1/ai-schedule`;
  const run = (env) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, '../run.mjs'), '--target', 'ai-schedule', '--only', 'create-basic', '--trials', '1'], { env: { ...process.env, ANTHROPIC_API_KEY: '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
  try {
    const r = await run({ AI_SCHEDULE_URL: url, AI_SCHEDULE_JWT: 'jwt' });
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /Model claude-haiku-4-5 · transport ai-schedule\/skills/);
    assert.match(r.out, /\| create-basic \| create \| 100% \|/);
    assert.match(r.out, /Meets the standard/);
  } finally {
    server.close();
  }
  const missing = spawnSync(process.execPath, [path.join(HERE, '../run.mjs'), '--target', 'ai-schedule'], { env: { ...process.env, AI_SCHEDULE_URL: '', AI_SCHEDULE_JWT: '' }, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /AI_SCHEDULE_URL/);
  const wrong = spawnSync(process.execPath, [path.join(HERE, '../run.mjs'), '--target', 'nope'], { encoding: 'utf8' });
  assert.equal(wrong.status, 2);
});
