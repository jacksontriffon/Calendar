// Drives the real index.html in headless Chromium: seeds the calendar, pins the clock,
// forwards the app's own API calls to Anthropic, and returns what the app would apply.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROXY = 'https://anthropic-proxy.eval/v1/messages';
const PROMPT_V = 7;

function serveApp() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function clockTime(cal) {
  const [y, m, d] = cal.today.split('-').map(Number);
  const [hh, mm] = cal.now.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

function seed(cal, events, skills) {
  const now = clockTime(cal);
  return {
    'aical.v1': JSON.stringify({
      events, cats: cal.cats, goals: cal.goals || [], view: 'day3', font: 'serif', zoom: 1,
      sun: { region: 'London', sunrise: 398, sunset: 1163 },
      ai: { on: true, skills, key: '', proxy: PROXY, model: 'haiku', ask: true, checkin: false, v: PROMPT_V },
    }),
    'aical.seen.v1': String(now),
    'aical.checkin.v1': String(now),
    'aical.hist.v1': '[]',
  };
}

export async function startHarness({ apiKey, baseUrl, model, transport }) {
  const server = await serveApp();
  const appUrl = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let skillsState = null;

  async function forward(route, calls) {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.includes('/skills') && transport !== 'skills') {
      return route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"message":"skills disabled for inline eval"}}' });
    }
    const headers = { 'x-api-key': apiKey, 'anthropic-version': req.headers()['anthropic-version'] || '2023-06-01' };
    if (req.headers()['content-type']) headers['content-type'] = req.headers()['content-type'];
    if (req.headers()['anthropic-beta']) headers['anthropic-beta'] = req.headers()['anthropic-beta'];
    let body = req.postDataBuffer();
    let kind = 'skills-upload';
    if (url.pathname.endsWith('/messages')) {
      const j = JSON.parse(body.toString('utf8'));
      if (model) j.model = model;
      kind = String(j.messages[0].content).includes('<candidate kind=') ? 'verifier' : 'scheduler';
      body = Buffer.from(JSON.stringify(j));
    }
    const t0 = Date.now();
    const res = await fetch(baseUrl + url.pathname, { method: req.method(), headers, body, signal: AbortSignal.timeout(180000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const rec = { kind, status: res.status, ms: Date.now() - t0 };
    try { rec.json = JSON.parse(buf.toString('utf8')); } catch { rec.raw = buf.toString('utf8').slice(0, 2000); }
    calls.push(rec);
    return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': res.headers.get('content-type') || 'application/json' }, body: buf });
  }

  async function openApp(cal, events, calls) {
    const context = await browser.newContext({ timezoneId: 'UTC' });
    const page = await context.newPage();
    await page.clock.setFixedTime(clockTime(cal));
    await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, seed(cal, events, skillsState));
    await page.route('https://anthropic-proxy.eval/**', (route) => forward(route, calls));
    await page.goto(appUrl);
    await page.waitForFunction(() => {
      for (const el of document.querySelectorAll('[data-dc-tpl]')) {
        const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
        for (let f = k && el[k]; f; f = f.return) {
          const l = f.stateNode && f.stateNode.logic;
          if (l && typeof l.askClaude === 'function') { window.__L = l; return true; }
        }
      }
      return false;
    }, null, { timeout: 30000 });
    return { context, page };
  }

  // One upload up front so every trial reuses the same skill ids instead of re-uploading.
  async function prepareSkills(cal) {
    if (transport !== 'skills') return;
    const calls = [];
    const { context, page } = await openApp(cal, cal.events, calls);
    skillsState = await page.evaluate(async () => { await window.__L.ensureSkills(true); return window.__L.state.aiSkills; });
    await context.close();
  }

  async function runNote(cal, events, note, noAsk) {
    const calls = [];
    const { context, page } = await openApp(cal, events, calls);
    try {
      const final = await page.evaluate(async ({ note, noAsk }) => {
        const L = window.__L;
        let finalArr = null;
        const verify = L.verify.bind(L);
        L.verify = async (...a) => (finalArr = await verify(...a));
        try {
          const r = await L.askClaude(note, noAsk);
          return { r, finalArr, issues: L.checkOps(finalArr, noAsk) };
        } catch (e) { return { error: String((e && e.message) || e), finalArr }; }
      }, { note, noAsk });

      const sched = calls.filter((c) => c.kind === 'scheduler' && c.json).pop();
      const schedOnly = sched ? await page.evaluate(({ j, noAsk }) => {
        const L = window.__L;
        const isAsk = (r) => /^(ask|clarify|question|confirm)$/.test(String((r && r.op) || '').toLowerCase());
        const raw = L.textOf(j);
        const m = String(raw).replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
        let arr;
        try { arr = m ? JSON.parse(m[0]) : null; } catch (e) { arr = null; }
        if (!Array.isArray(arr)) return { error: 'no JSON', raw };
        const rest = arr.filter((r) => !isAsk(r));
        const asks = L.state.qzOn && !noAsk ? L.normAsks(arr.filter(isAsk)) : [];
        if (!asks.length && !rest.length) return { error: 'empty', arr };
        return { arr, asks, applied: rest.length ? L.fromModel(rest) : null, issues: L.checkOps(arr, noAsk) };
      }, { j: sched.json, noAsk }) : { error: 'no scheduler response' };

      return { final: toOutcome(final), schedOnly: toOutcome(schedOnly), calls };
    } finally {
      await context.close();
    }
  }

  async function close() { await browser.close(); server.close(); }
  return { prepareSkills, runNote, close };
}

// askClaude returns fromModel() output, or { asks, rest } when it wants to ask first.
function toOutcome(x) {
  if (x.error) return { error: x.error, ops: x.finalArr || x.arr || null };
  let applied = x.applied, asks = x.asks || [];
  if (x.r) {
    if (x.r.asks) { asks = x.r.asks; applied = x.r.rest; } else applied = x.r;
  }
  applied = applied || { events: [], updates: [], deletes: [], goals: [] };
  return {
    ops: x.finalArr || x.arr,
    issues: x.issues || [],
    asks,
    creates: applied.events.map((e) => ({ day: e.day, start: e.start, end: e.end, allDay: !!e.allDay, days: e.days, title: e.title, cat: e.cat })),
    updates: applied.updates,
    deletes: applied.deletes,
    goals: applied.goals,
  };
}
