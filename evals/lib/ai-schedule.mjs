// The `ai-schedule` target: sends each case's note and calendar to the deployed ai-schedule edge
// function and turns the ops it returns into what the app would apply (the same outcome shape the
// browser harness produces), so the existing grader scores it unchanged.
//
// The function holds the Anthropic key, model and skills; this target only needs its URL and a
// user's JWT. Resolving ops uses @calendar/core (the app's own code), loaded straight from source
// (Node >= 22.18 strips the types).
import { fromModel, isAskOp, makeIdGen, normAsks } from '../../packages/core/src/index.ts';

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Same shape as toOutcome() in harness.mjs.
function toOutcome(ops, issues, { data, cal, noAsk }) {
  if (!Array.isArray(ops)) return { error: 'no JSON', ops: null };
  const rest = ops.filter((r) => !isAskOp(r));
  const asks = noAsk ? [] : normAsks(ops.filter(isAskOp));
  if (!asks.length && !rest.length) return { error: 'empty', ops };
  const today = dateOf(cal.today), nowMin = minutes(cal.now);
  const ctx = { today, nowMin, nowMs: today.getTime() + nowMin * 60000, nextId: makeIdGen(data.events), random: () => 0.5 };
  const applied = rest.length ? fromModel(rest, data, ctx) : { events: [], updates: [], deletes: [], goals: [] };
  return {
    ops, issues: issues || [], asks,
    creates: applied.events.map((e) => ({ day: e.day, start: e.start, end: e.end, allDay: !!e.allDay, days: e.days, title: e.title, cat: e.cat })),
    updates: applied.updates, deletes: applied.deletes, goals: applied.goals,
  };
}

/**
 * @param {{ url: string, jwt: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, maxRetries?: number }} o
 */
export function createAiScheduleTarget({ url, jwt, fetchImpl = fetch, sleep = sleepMs, maxRetries = 5 }) {
  const seen = { model: null, transport: null };

  async function post(body) {
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      const json = await res.json().catch(() => ({}));
      const rec = { kind: 'ai-schedule', status: res.status, ms: Date.now() - t0, json };
      if (res.status === 429 && json.error === 'rate_limit' && attempt < maxRetries) {
        await sleep(Math.min(70, Number(json.retryAfter) || 10) * 1000 + 250);
        continue;
      }
      return rec;
    }
  }

  // The function owns skills and transport; nothing to prepare.
  async function prepareSkills() {}

  async function runNote(cal, events, note, noAsk) {
    const data = { events, cats: cal.cats, goals: cal.goals || [] };
    const rec = await post({
      mode: 'note', note, noAsk: !!noAsk, debug: true,
      today: cal.today, nowMin: minutes(cal.now), tz: 'UTC', data,
    });
    const j = rec.json;
    if (rec.status !== 200 || !j.ok) {
      const why = `ai-schedule HTTP ${rec.status}: ${j.error || ''}${j.message ? ' (' + j.message + ')' : ''}`;
      if (rec.status === 429 && j.error === 'limit') throw new Error(`${why}; raise AI_MONTHLY_LIMIT for the eval account`);
      const call = { kind: 'ai-schedule', status: rec.status, ms: rec.ms, json: { error: { message: why } } };
      // A reply the model could not produce is a failed case; anything else is reported as an HTTP error.
      const err = j.error === 'bad_reply' ? { error: j.detail || 'no JSON', ops: null } : { error: why, ops: null };
      return { final: err, schedOnly: err, calls: j.error === 'bad_reply' ? [] : [call] };
    }
    seen.model = j.model; seen.transport = j.transport;
    const ctx = { data, cal, noAsk: !!noAsk };
    return {
      final: toOutcome(j.ops, j.issues, ctx),
      schedOnly: toOutcome(j.firstOps, j.firstIssues, ctx),
      calls: [{ kind: 'ai-schedule', status: 200, ms: rec.ms, json: { usage: {} } }],
    };
  }

  return {
    prepareSkills, runNote, close: async () => {},
    /** What the server reported using (model, transport), after at least one successful call. */
    describe: () => ({ model: seen.model || 'ai-schedule', transport: seen.transport || 'ai-schedule' }),
  };
}
