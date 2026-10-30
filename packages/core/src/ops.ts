/**
 * The AI operation schema, the code validator and the applier.
 *
 * The scheduler / goal-adjust skills reply with a JSON array of operations
 * (see skills/calendar-scheduler/references/operations.md); the check-in skill
 * replies with questions (skills/calendar-checkin/references/questions.md).
 *
 * - {@link parseArr} pulls the array out of a model reply.
 * - {@link checkOps} / {@link checkCi} are the deterministic validators whose
 *   findings are fed to the verifier pass.
 * - {@link fromModel} resolves loose model JSON against the current data into
 *   a {@link Resolved} change set; {@link applyResolved} applies it and
 *   returns the new data plus a change log; {@link applyOps} does both.
 *
 * Everything is pure: the clock, ids and randomness come in through {@link OpsCtx}.
 */
import { addDays, cap, clamp, dnum, key, snap, weekKey } from './time.ts';
import { builtinHue, catHue, defaultDur, normCat, spareHue } from './categories.ts';
import type { CatMap } from './categories.ts';
import { dataSnap } from './model.ts';
import type { CalendarData, HistoryEntry, HistoryKind, ProtoEvent, ProtoGoal } from './model.ts';
import { goalOf, newGoalSeed } from './goals.ts';
import type { GoalPatch } from './goals.ts';
import { evEndMs } from './checkin.ts';
import { makeHistoryEntry } from './history.ts';

/* =====================================================================
 * Operation schema
 * ===================================================================== */

export interface AskOption { label: string; note?: string }

/** `{"op":"create", ...}`. Timed events need `start`/`end`; all-day events `allDay` (+ `days`) or `span: "week"`. */
export interface CreateOp {
  op: 'create';
  title: string;
  cat?: string;
  /** minutes past midnight of the start day */
  start?: number;
  /** greater than `start`, at most `start + 1440` */
  end?: number;
  /** 0 today, 1 tomorrow, -1 yesterday */
  dayOffset?: number;
  allDay?: boolean;
  /** consecutive days for an all-day event */
  days?: number;
  /** whole-week event, snaps to Monday and covers 7 days */
  span?: 'week';
  /** 0 this week, 1 next week (all-day events only) */
  weekOffset?: number;
  /** one past-tense line about what was achieved in a session that already happened */
  win?: string;
}

/** `{"op":"update","id":"e12", ...}`: only the fields that change. */
export interface UpdateOp {
  op: 'update';
  id: string;
  title?: string;
  cat?: string;
  start?: number;
  end?: number;
  dayOffset?: number;
  weekOffset?: number;
  allDay?: boolean;
  days?: number;
  span?: 'week';
  win?: string;
}

export interface DeleteOp { op: 'delete'; id: string }

/** A new goal needs all of title, outcome, deadline (YYYY-MM-DD) and hours. */
export interface GoalCreateOp { op: 'goal'; title: string; outcome: string; deadline: string; hours: number }
/** Change a goal: its `id` plus only the fields that change; `delete: true` drops it. */
export interface GoalUpdateOp { op: 'goal'; id: string; title?: string; outcome?: string; deadline?: string; hours?: number; delete?: boolean }

export interface AskOp { op: 'ask'; question: string; options: AskOption[] }

export type Operation = CreateOp | UpdateOp | DeleteOp | GoalCreateOp | GoalUpdateOp | AskOp;

/** Check-in questions the checkin skill returns. */
export interface CheckInOp { field: 'goal' | 'win' | 'log'; q: string; chips?: string[]; id?: string }

/** One loose model-produced op. The applier tolerates aliases (`edit`/`move`, `remove`/`cancel`, `category`, `intent`, …). */
export type RawOp = Record<string, unknown>;

export const isAskOp = (r: unknown): boolean => /^(ask|clarify|question|confirm)$/.test(String((r && (r as RawOp).op) || '').toLowerCase());

/** A question after normalisation, ready for the question sheet. */
export interface Ask { q: string; options: Array<{ label: string; note: string }> }

/** Text appended to the note when the model must not ask questions. */
export const NOASK = '\n\nDo not ask any questions this time — make your best assumption and return the operations.';

/** Pull the first JSON array out of a model reply (code fences tolerated). Throws `no JSON` / `empty`. */
export const parseArr = (raw: unknown): unknown[] => {
  const m = String(raw).replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
  if (!m) throw new Error('no JSON');
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) throw new Error('empty');
  return arr;
};

/** Pull the verifier's JSON object out of its reply: `{ok:true}` or `{ok:false, reason, fixed}`. Null if absent. */
export const parseVerdict = (raw: unknown): { ok?: boolean; reason?: string; fixed?: unknown[] } | null => {
  const m = String(raw).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
};

/** The verifier's replacement array when it rejected the candidate, else null. */
export const verdictFix = (v: ReturnType<typeof parseVerdict>): unknown[] | null =>
  v && v.ok === false && Array.isArray(v.fixed) && v.fixed.length ? v.fixed : null;

/* =====================================================================
 * Code validators (deterministic checks fed to the verifier, never shown)
 * ===================================================================== */

type Idish = { id: string };

/**
 * Problems with a scheduler / goal-adjust reply, as human sentences. Empty
 * means it passed. `noAsk` is true when the note told the model not to ask.
 */
export const checkOps = (
  arr: ReadonlyArray<unknown>, state: { events: ReadonlyArray<Idish>; goals: ReadonlyArray<Idish> }, today: Date, noAsk?: boolean,
): string[] => {
  const out: string[] = [];
  const ids = new Set(state.events.map((e) => e.id));
  const gids = new Set((state.goals || []).map((g) => g.id));
  const todayKey = key(today);
  let asks = 0, edits = 0;
  const span = (r: RawOp, n: string) => {
    if (typeof r.start === 'number' && typeof r.end === 'number' && (r.end <= r.start || r.end > r.start + 1440)) out.push(n + 'end must be greater than start and at most start+1440');
  };
  if (!arr.length) out.push('the reply is empty');
  arr.forEach((raw, i) => {
    const n = '#' + (i + 1) + ' ';
    if (!raw || typeof raw !== 'object') { out.push(n + 'is not an object'); return; }
    const r = raw as RawOp;
    const op = String(r.op || '').toLowerCase();
    if (/^(ask|clarify|question|confirm)$/.test(op)) {
      asks++;
      const o = (r.options || []) as ArrayLike<unknown>;
      if (!String(r.question || '').trim()) out.push(n + 'ask has no question');
      if (o.length < 2 || o.length > 4) out.push(n + 'ask has ' + o.length + ' options (needs 2–4)');
    } else if (op === 'create') {
      edits++;
      if (!String(r.title || '').trim()) out.push(n + 'create has no title');
      if (r.dayOffset != null && typeof r.dayOffset !== 'number') out.push(n + 'dayOffset must be a number');
      if (r.allDay) { if (r.span !== 'week' && r.days != null && !((r.days as number) >= 1)) out.push(n + 'days must be 1 or more'); }
      else if (typeof r.start !== 'number' || typeof r.end !== 'number') out.push(n + 'timed create needs numeric start and end');
      else span(r, n);
    } else if (op === 'update' || op === 'delete') {
      edits++;
      if (!ids.has(r.id as string)) out.push(n + op + ' id "' + r.id + '" is not on the calendar');
      if (op === 'update') span(r, n);
    } else if (op === 'goal') {
      if (r.id) { if (!gids.has(r.id as string)) out.push(n + 'goal id "' + r.id + '" does not exist'); }
      else ['title', 'outcome', 'deadline', 'hours'].forEach((f) => { if (r[f] == null || r[f] === '') out.push(n + 'new goal is missing ' + f); });
      if (r.deadline != null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.deadline))) out.push(n + 'deadline must be YYYY-MM-DD');
        else if (String(r.deadline) < todayKey) out.push(n + 'deadline ' + r.deadline + ' is in the past');
      }
      if (r.hours != null && !(Number(r.hours) > 0)) out.push(n + 'hours must be a positive number');
    } else out.push(n + 'unknown op "' + r.op + '"');
  });
  if (asks > 3) out.push(asks + ' questions (max 3)');
  if (asks && noAsk) out.push('the note says not to ask, but the reply asks');
  if (asks && edits) out.push('the reply mixes questions with create/update/delete: keep it only if this is a goal-conversation step, otherwise return just the questions');
  return out;
};

/**
 * Problems with a check-in reply. `winIds` are the ids of the goal sessions
 * that were listed as waiting for a win (see `winCands`).
 */
export const checkCi = (
  arr: ReadonlyArray<unknown>, state: { goals: ReadonlyArray<Idish> }, winIds: ReadonlyArray<string>,
): string[] => {
  const out: string[] = [];
  const gids = new Set((state.goals || []).map((g) => g.id));
  const wids = new Set(winIds);
  const nw = arr.filter((r) => r && String((r as RawOp).field || '') === 'win').length;
  if (nw ? arr.length > 5 : (arr.length < 2 || arr.length > 4)) out.push(arr.length + (nw ? ' questions (needs 1–5)' : ' questions (needs 2–4)'));
  let goals = 0;
  arr.forEach((raw, i) => {
    const r = raw as RawOp;
    const n = '#' + (i + 1) + ' ';
    if (!r || !String(r.q || '').trim()) { out.push(n + 'has no q'); return; }
    const f = String(r.field || '');
    if (f !== 'goal' && f !== 'log' && f !== 'win') out.push(n + 'field must be "goal", "win" or "log"');
    if (f === 'win' && !wids.has(r.id as string)) out.push(n + 'win id "' + r.id + '" is not a listed goal session');
    if (f === 'goal') {
      goals++;
      if (!gids.has(r.id as string)) out.push(n + 'goal id "' + r.id + '" does not exist');
      if (i !== 0) out.push(n + 'goal question must come first');
    }
    if (r.chips && (r.chips as ArrayLike<unknown>).length > 3) out.push(n + 'more than 3 chips');
  });
  if (goals > 1) out.push('more than one goal question');
  return out;
};

/**
 * Normalise `ask` ops into question-sheet questions: options may be strings or
 * `{label|text, note}`; at most five options each (needs at least two), at most
 * two questions.
 */
export const normAsks = (list: ReadonlyArray<RawOp>): Ask[] =>
  list.map((r) => {
    const opts = ((r.options || r.choices || r.answers || []) as unknown[])
      .map((o) => (typeof o === 'string'
        ? { label: o.trim(), note: '' }
        : {
          label: String((o && ((o as RawOp).label != null ? (o as RawOp).label : (o as RawOp).text)) || '').trim(),
          note: String((o && (o as RawOp).note) || '').trim(),
        }))
      .filter((o) => o.label)
      .slice(0, 5);
    return { q: String(r.question || r.text || r.title || '').trim(), options: opts };
  }).filter((q) => q.q && q.options.length > 1).slice(0, 2);

/* =====================================================================
 * Resolving model JSON against the data
 * ===================================================================== */

/** Everything the resolver needs from the outside world. */
export interface OpsCtx {
  /** local midnight of today (dayOffset is counted from here) */
  today: Date;
  /** minutes past midnight now */
  nowMin: number;
  /** epoch ms now */
  nowMs: number;
  /** returns the next event id ("e42"); see `makeIdGen` */
  nextId: () => string;
  /** [0, 1) */
  random: () => number;
}

export interface EventUpdate { id: string; patch: Partial<ProtoEvent> }

export type GoalDirective =
  | { id: string; remove: true }
  | { id: string; patch: GoalPatch & { cat?: string } }
  | { create: GoalPatch };

/** A model reply resolved into concrete changes (what the prototype's `fromModel` returned). */
export interface Resolved {
  events: ProtoEvent[];
  /** the category map to use afterwards (existing plus any new ones) */
  cats: CatMap;
  /** names of categories created by this reply */
  fresh: string[];
  updates: EventUpdate[];
  deletes: string[];
  goals: GoalDirective[];
}

const isObj = (r: unknown): r is RawOp => !!r && typeof r === 'object';

/**
 * Resolve loose model ops against the current data. Offsets are clamped
 * (days +-60, weeks +-26), times are rounded and clamped (start 0..1425, end
 * at least 15 minutes after and at most 24 h after the start), unknown
 * categories are created with a spare hue, and unknown ids are ignored.
 * Non-object entries are skipped.
 */
export const fromModel = (arr: ReadonlyArray<unknown>, data: CalendarData, ctx: OpsCtx): Resolved => {
  const { today, nowMs, nowMin } = ctx;
  const cats: CatMap = Object.assign({}, data.cats);
  const known = Object.keys(cats);
  const byId = new Map<string, ProtoEvent>();
  data.events.forEach((e) => byId.set(e.id, e));
  const out: ProtoEvent[] = [], fresh: string[] = [], updates: EventUpdate[] = [], deletes: string[] = [], goals: GoalDirective[] = [];
  const resolveCat = (v: unknown): string => {
    let cat = String(v || '').trim();
    const ci = known.find((k) => k.toLowerCase() === cat.toLowerCase());
    cat = ci || (normCat(cat || 'Other') as string) || 'Other';
    if (catHue(cats, cat) == null) {
      const sp = spareHue(cats);
      const h = builtinHue(cat) != null ? (builtinHue(cat) as number) : (sp != null ? sp : Math.round(ctx.random() * 360));
      cats[cat] = h; known.push(cat); if (fresh.indexOf(cat) < 0) fresh.push(cat);
    }
    return cat;
  };
  arr.forEach((raw) => {
    if (!isObj(raw)) return;
    const r = raw;
    const op = String(r.op || 'create').toLowerCase();
    if (op.indexOf('goal') > -1 || op === 'intent') {
      const title = String((r.title != null ? r.title : (r.text != null ? r.text : '')) || '').trim();
      const gid = r.id ? String(r.id) : (title ? (data.goals.find((g) => g.title.toLowerCase() === title.toLowerCase()) || ({} as Partial<ProtoGoal>)).id : null);
      const gone = r.delete === true || op.indexOf('delete') > -1 || op === 'remove' || op === 'clear';
      if (gone) { if (gid) goals.push({ id: gid, remove: true }); return; }
      const patch: GoalPatch = {};
      if (title) patch.title = cap(title);
      const oc = r.outcome != null ? r.outcome : r.result;
      if (oc != null && String(oc).trim()) patch.outcome = String(oc).trim();
      const dl = String(r.deadline || r.by || r.due || '').trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) patch.deadline = dl;
      else if (r.deadlineOffset != null && isFinite(Number(r.deadlineOffset))) patch.deadline = key(addDays(today, clamp(Math.round(Number(r.deadlineOffset)), 1, 1500)));
      if (r.hours != null) patch.hours = clamp(Number(r.hours) || 0, 0, 5000);
      if (gid) goals.push({ id: gid, patch });
      else if (title) goals.push({ create: patch });
      return;
    }
    if (op === 'delete' || op === 'remove' || op === 'cancel') {
      if (byId.has(r.id as string)) deletes.push(r.id as string);
      return;
    }
    if (op === 'update' || op === 'edit' || op === 'move') {
      const cur = byId.get(r.id as string);
      if (!cur) return;
      const patch: Partial<ProtoEvent> = {};
      if (r.title != null && String(r.title).trim()) patch.title = cap(String(r.title).trim());
      if (r.cat != null || r.category != null) patch.cat = resolveCat(r.cat != null ? r.cat : r.category);
      if (r.win != null && String(r.win).trim()) { patch.win = { text: cap(String(r.win).trim()), at: nowMs }; patch.done = true; }
      if (r.dayOffset != null) patch.day = key(addDays(today, clamp(Math.round(Number(r.dayOffset) || 0), -60, 60)));
      if (r.weekOffset != null && (r.allDay || cur.allDay)) patch.day = weekKey(addDays(today, clamp(Math.round(Number(r.weekOffset) || 0), -26, 26) * 7));
      if (r.allDay != null) patch.allDay = !!r.allDay;
      const wholeWeek = String(r.span || '').toLowerCase() === 'week';
      if (wholeWeek) { patch.allDay = true; patch.days = 7; patch.day = weekKey(dnum(patch.day || cur.day)); }
      else if (r.days != null) patch.days = clamp(Math.round(Number(r.days) || 1), 1, 60);
      const nowAD = patch.allDay != null ? patch.allDay : cur.allDay;
      if (nowAD) {
        if (patch.days == null && !cur.allDay) patch.days = 1;
        patch.start = 0; patch.end = 1440;
      } else {
        if (cur.allDay) patch.days = 1;
        const start = Number(r.start), end = Number(r.end);
        if (isFinite(start)) patch.start = clamp(Math.round(start), 0, 1425);
        if (isFinite(end)) patch.end = Math.round(end);
        const s2 = patch.start != null ? patch.start : cur.start;
        if (patch.end != null || patch.start != null) {
          const e2 = patch.end != null ? patch.end : (cur.end - cur.start) + s2;
          patch.end = clamp(e2 === s2 ? s2 + (cur.end - cur.start) : e2 < s2 ? e2 + 1440 : e2, s2 + 15, s2 + 1440);
        }
      }
      if (Object.keys(patch).length) updates.push({ id: r.id as string, patch });
      return;
    }
    const title = cap(String(r.title || '').trim() || 'Untitled');
    const cat = resolveCat(r.cat != null ? r.cat : r.category);
    const wholeWeek = String(r.span || '').toLowerCase() === 'week' || String(r.allDay || '').toLowerCase() === 'week';
    if (r.allDay || wholeWeek) {
      let n = clamp(Math.round(Number(r.days) || (wholeWeek ? 7 : 1)), 1, 60);
      let d0 = addDays(today, clamp(Math.round(Number(r.dayOffset) || 0), -60, 60));
      if (r.weekOffset != null) d0 = addDays(today, clamp(Math.round(Number(r.weekOffset) || 0), -26, 26) * 7);
      if (wholeWeek) { d0 = dnum(weekKey(d0)); n = Math.max(n, 7); }
      out.push({ id: ctx.nextId(), day: key(d0), cat, title, start: 0, end: 1440, allDay: true, days: n });
      return;
    }
    let start = clamp(Math.round(Number(r.start)), 0, 1425);
    if (!isFinite(start)) start = Math.max(480, snap(nowMin));
    let end = Math.round(Number(r.end));
    if (!isFinite(end) || end === start) end = start + (defaultDur(cat) || 45);
    else if (end < start) end += 1440;
    end = clamp(end, start + 15, start + 1440);
    const off = clamp(Math.round(Number(r.dayOffset) || 0), -60, 60);
    const ev: ProtoEvent = { id: ctx.nextId(), day: key(addDays(today, off)), cat, title, start, end, at: nowMs };
    const wt = String(r.win || r.achievement || '').trim();
    if (wt) { ev.win = { text: cap(wt), at: nowMs }; ev.done = true; }
    out.push(ev);
  });
  return { events: out, cats, fresh, updates, deletes, goals };
};

/** True when there is nothing in a resolved change set. */
export const isEmptyResolved = (r: Resolved): boolean =>
  !r.events.length && !r.updates.length && !r.deletes.length && !r.goals.length;

/**
 * Split a validated model reply the way `askClaude` does. With questions (and
 * asking allowed: not `noAsk`, and either asking is on or this is a goal
 * adjustment) the result has `asks` and `rest` (resolved ops that came with
 * the questions, to apply straight away, or null). Otherwise it is the
 * resolved ops. Throws `empty` when there is nothing to do.
 */
export const interpretReply = (
  arr: ReadonlyArray<unknown>, data: CalendarData, ctx: OpsCtx, o: { noAsk?: boolean; askOn?: boolean; goalAdjust?: boolean },
): { asks: Ask[]; rest: Resolved | null } | Resolved => {
  if (!Array.isArray(arr) || !arr.length) throw new Error('empty');
  const rest = arr.filter((r) => !isAskOp(r));
  if (!o.noAsk && (o.askOn || o.goalAdjust)) {
    const qs = normAsks(arr.filter(isAskOp) as RawOp[]);
    if (qs.length) return { asks: qs, rest: rest.length ? fromModel(rest, data, ctx) : null };
  }
  if (!rest.length) throw new Error('empty');
  return fromModel(rest, data, ctx);
};

/* =====================================================================
 * Applying
 * ===================================================================== */

export type Change =
  | { type: 'event-created'; event: ProtoEvent }
  | { type: 'event-updated'; id: string; before: ProtoEvent; after: ProtoEvent }
  | { type: 'event-deleted'; event: ProtoEvent }
  | { type: 'goal-created'; goal: ProtoGoal }
  | { type: 'goal-updated'; id: string; before: ProtoGoal; after: ProtoGoal }
  | { type: 'goal-deleted'; goal: ProtoGoal }
  | { type: 'category-created'; name: string; hue: number }
  | { type: 'category-removed'; name: string }
  | { type: 'category-renamed'; from: string; to: string };

export type ApplySource = 'claude' | 'local' | 'fallback';

export interface ApplyResult {
  /** the data after the change */
  data: CalendarData;
  /** nothing to schedule: `data` is the input, no history */
  empty: boolean;
  /** toast text: "2 events added · 1 updated · new: Novel" */
  message: string;
  /** every individual change, in order */
  changes: Change[];
  /** ids of created and updated events (to highlight) */
  newIds: string[];
  /** snapshot of the data before the change */
  before: CalendarData;
  /** the undo entry ("Claude · <message>"), or null if nothing changed */
  history: HistoryEntry | null;
  /** created timed events that have already ended and have no win: candidates for "what came out of it?" */
  pastSessionIds: string[];
  /** earliest start minute among the created timed events (or updated ones), to scroll to */
  focusMin: number | null;
}

/**
 * Apply a resolved change set (the prototype's `commit`): deletes, event
 * updates, goal changes (a renamed goal renames its sessions' category too),
 * then the new events. Returns the new data and a change log.
 */
export const applyResolved = (data: CalendarData, r: Resolved, ctx: OpsCtx, src: ApplySource = 'claude'): ApplyResult => {
  const ups = r.updates || [], dels = r.deletes || [], gls = r.goals || [];
  const before = dataSnap(data);
  if (!r.events.length && !ups.length && !dels.length && !gls.length) {
    return { data, empty: true, message: 'Nothing to schedule there', changes: [], newIds: [], before, history: null, pastSessionIds: [], focusMin: null };
  }
  const ids = r.events.map((e) => e.id).concat(ups.map((u) => u.id));
  const gSet = gls.filter((g) => !('remove' in g)).length, gClr = gls.length - gSet;
  const bits: string[] = [];
  if (r.events.length) bits.push(r.events.length + (r.events.length === 1 ? ' event added' : ' events added'));
  if (ups.length) bits.push(ups.length + ' updated');
  if (dels.length) bits.push(dels.length + ' removed');
  if (gSet) bits.push(gSet === 1 ? 'goal set' : gSet + ' goals set');
  if (gClr) bits.push(gClr === 1 ? 'goal removed' : gClr + ' goals removed');
  if (r.events.length && r.fresh.length) bits.push('new: ' + r.fresh.join(', '));
  if (src === 'fallback') bits.push('offline parse');
  const message = bits.join(' · ');

  const changes: Change[] = [];
  const byId = new Map<string, ProtoEvent>();
  data.events.forEach((e) => byId.set(e.id, e));
  r.fresh.forEach((name) => changes.push({ type: 'category-created', name, hue: r.cats[name] }));

  let list = dels.length ? data.events.filter((e) => dels.indexOf(e.id) < 0) : data.events;
  dels.forEach((id) => { const e = byId.get(id); if (e) changes.push({ type: 'event-deleted', event: e }); });
  if (ups.length) {
    list = list.map((e) => {
      const u = ups.find((x) => x.id === e.id);
      if (!u) return e;
      const after = Object.assign({}, e, u.patch);
      changes.push({ type: 'event-updated', id: e.id, before: e, after });
      return after;
    });
  }
  let goals = data.goals, cats = r.cats;
  if (gls.length) {
    goals = data.goals.slice(); cats = Object.assign({}, cats);
    gls.forEach((g) => {
      if ('remove' in g) {
        const gone = goals.find((x) => x.id === g.id);
        goals = goals.filter((x) => x.id !== g.id);
        if (gone) changes.push({ type: 'goal-deleted', goal: gone });
        return;
      }
      if ('create' in g) {
        /* hue/goal count come from the data as it was before this reply */
        const n = newGoalSeed(g.create, { today: ctx.today, cats: data.cats, goalCount: data.goals.length, nowMs: ctx.nowMs, random: ctx.random });
        goals = goals.concat([n]); cats[n.cat] = n.hue;
        changes.push({ type: 'goal-created', goal: n });
        return;
      }
      goals = goals.map((x) => {
        if (x.id !== g.id) return x;
        const nw: ProtoGoal = Object.assign({}, x, g.patch) as ProtoGoal;
        if (g.patch.title != null) nw.cat = String(g.patch.title).trim() || x.cat;
        if (nw.cat !== x.cat) {
          delete cats[x.cat];
          list = list.map((e) => (e.cat === x.cat ? Object.assign({}, e, { cat: nw.cat }) : e));
          changes.push({ type: 'category-renamed', from: x.cat, to: nw.cat });
        }
        cats[nw.cat] = nw.hue;
        changes.push({ type: 'goal-updated', id: x.id, before: x, after: nw });
        return nw;
      });
    });
  }
  r.events.forEach((e) => changes.push({ type: 'event-created', event: e }));
  const next: CalendarData = { events: list.concat(r.events), cats, goals };

  const pastSessionIds = r.events.filter((e) => !e.allDay && !e.win && evEndMs(e) <= ctx.nowMs && !!goalOf(e, goals)).map((e) => e.id);
  const timed = r.events.filter((e) => !e.allDay);
  const focus: Array<{ start: number }> = timed.length ? timed : ups.filter((u) => !u.patch.allDay).map((u) => Object.assign({ start: 480 }, u.patch) as { start: number });
  const first = focus.reduce<{ start: number } | null>((a, b) => (a && a.start < b.start ? a : b), null);

  const pre = src === 'claude' ? 'Claude · ' : src === 'fallback' ? 'Offline parse · ' : 'Note · ';
  const kind: HistoryKind = src === 'claude' ? 'claude' : 'parse';
  const history = makeHistoryEntry(pre + message, kind, before, dataSnap(next), ctx.nowMs, ctx.random);
  return { data: next, empty: false, message, changes, newIds: ids, before, history, pastSessionIds, focusMin: first ? first.start : null };
};

/** `fromModel` then `applyResolved`: the validated ops array in, new data and change log out. */
export const applyOps = (data: CalendarData, ops: ReadonlyArray<unknown>, ctx: OpsCtx, src: ApplySource = 'claude'): ApplyResult =>
  applyResolved(data, fromModel(ops, data, ctx), ctx, src);

