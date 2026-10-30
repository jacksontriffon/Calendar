/**
 * Validation of the ai-schedule request body.
 *
 * The client sends its own `CalendarData` snapshot (events, categories, goals) instead of the
 * function reading the user's rows: the prompt then matches exactly the local-first data the
 * returned ops will be applied to (including edits not yet synced). The snapshot is size-capped and
 * whitelisted field by field, because everything in it ends up in a prompt and in checks.
 */
import { adjustNote, dnum, normalizeGoals } from '@calendar/core';
import type { AdjustMode, CalendarData, ProtoEvent, ProtoGoal } from '@calendar/core';
import { HttpError } from '../_shared/http.ts';

export type Mode = 'note' | 'adjust' | 'checkin';

export const LIMITS = {
  events: 5000,
  goals: 200,
  categories: 200,
  noteChars: 4000,
  idChars: 80,
  textChars: 300,
} as const;

export interface AiInput {
  mode: Mode;
  /** the user text sent to the scheduler / goal-adjust skill (empty for check-ins) */
  note: string;
  goalId: string | null;
  adjustMode: AdjustMode | undefined;
  noAsk: boolean;
  /** also return the scheduler's reply before the verifier (for evals) */
  debug: boolean;
  /** `YYYY-MM-DD` */
  today: string;
  nowMin: number;
  tz: string;
  /** epoch ms last check-in window start, for check-ins */
  lastSeen: number | null;
  data: CalendarData;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function bad(code: string, message: string, status = 400): never {
  throw new HttpError(status, code, message);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const validDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const parseEvent = (raw: unknown, i: number): ProtoEvent => {
  const at = `data.events[${i}]`;
  if (!isObj(raw)) return bad('bad_data', `${at} is not an object`);
  const { id, day, start, end, title, cat } = raw;
  if (typeof id !== 'string' || !id || id.length > LIMITS.idChars) bad('bad_data', `${at}.id must be a short string`);
  if (!validDay(day)) bad('bad_data', `${at}.day must be YYYY-MM-DD`);
  if (!num(start) || !num(end)) bad('bad_data', `${at}.start and .end must be numbers (minutes past midnight)`);
  if (typeof title !== 'string') bad('bad_data', `${at}.title must be a string`);
  if (cat != null && typeof cat !== 'string') bad('bad_data', `${at}.cat must be a string or null`);
  const e: ProtoEvent = {
    id: id as string, day: day as string, cat: (cat as string | null | undefined) ?? null,
    title: (title as string).slice(0, LIMITS.textChars), start: start as number, end: end as number,
  };
  if (raw.allDay) e.allDay = true;
  if (num(raw.days)) e.days = raw.days;
  if (raw.done) e.done = true;
  if (Array.isArray(raw.pauses)) e.pauses = raw.pauses as ProtoEvent['pauses'];
  if (isObj(raw.win) && typeof raw.win.text === 'string' && num(raw.win.at)) e.win = raw.win as unknown as ProtoEvent['win'];
  if (raw.winAsked) e.winAsked = true;
  if (num(raw.at)) e.at = raw.at;
  if (typeof raw.goalId === 'string') e.goalId = raw.goalId;
  return e;
};

const parseGoal = (raw: unknown, i: number): Record<string, unknown> => {
  const at = `data.goals[${i}]`;
  if (!isObj(raw)) return bad('bad_data', `${at} is not an object`);
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > LIMITS.idChars) bad('bad_data', `${at}.id must be a short string`);
  if (typeof raw.title !== 'string' || !raw.title) bad('bad_data', `${at}.title must be a non-empty string`);
  const g: Record<string, unknown> = { id: raw.id, title: (raw.title as string).slice(0, LIMITS.textChars) };
  if (typeof raw.cat === 'string') g.cat = raw.cat;
  if (typeof raw.outcome === 'string') g.outcome = raw.outcome.slice(0, 600);
  if (num(raw.hours)) g.hours = raw.hours;
  if (raw.start != null) { if (!validDay(raw.start)) bad('bad_data', `${at}.start must be YYYY-MM-DD`); g.start = raw.start; }
  if (raw.deadline != null) { if (!validDay(raw.deadline)) bad('bad_data', `${at}.deadline must be YYYY-MM-DD`); g.deadline = raw.deadline; }
  if (num(raw.hue)) g.hue = raw.hue;
  if (num(raw.at)) g.at = raw.at;
  if (typeof raw.scope === 'string') g.scope = raw.scope;
  return g;
};

export const parseData = (raw: unknown, today: Date): CalendarData => {
  if (!isObj(raw)) return bad('bad_data', 'data must be an object { events, cats, goals }');
  if (!Array.isArray(raw.events)) bad('bad_data', 'data.events must be an array');
  const goalsRaw = raw.goals == null ? [] : raw.goals;
  if (!Array.isArray(goalsRaw)) bad('bad_data', 'data.goals must be an array');
  const catsRaw = raw.cats == null ? {} : raw.cats;
  if (!isObj(catsRaw)) bad('bad_data', 'data.cats must be an object of name -> hue');
  const events = raw.events as unknown[], goals = goalsRaw as unknown[], cats = catsRaw as Record<string, unknown>;
  if (events.length > LIMITS.events) bad('too_large', `data.events has ${events.length} events (max ${LIMITS.events})`, 413);
  if (goals.length > LIMITS.goals) bad('too_large', `data.goals has ${goals.length} goals (max ${LIMITS.goals})`, 413);
  const names = Object.keys(cats);
  if (names.length > LIMITS.categories) bad('too_large', `data.cats has ${names.length} categories (max ${LIMITS.categories})`, 413);
  const outCats: Record<string, number> = {};
  for (const n of names) {
    if (!num(cats[n])) bad('bad_data', `data.cats["${n.slice(0, 40)}"] must be a number`);
    outCats[n.slice(0, LIMITS.textChars)] = cats[n] as number;
  }
  return {
    events: events.map(parseEvent),
    cats: outCats,
    goals: normalizeGoals(goals.map(parseGoal), today) as ProtoGoal[],
  };
};

/** Validate the JSON body into an `AiInput`. Throws `HttpError` 400/413 with a stable `error` code. */
export const parseRequest = (body: Record<string, unknown>, o: { maxNote?: number } = {}): AiInput => {
  const mode = body.mode;
  if (mode !== 'note' && mode !== 'adjust' && mode !== 'checkin') bad('bad_mode', 'mode must be "note", "adjust" or "checkin"');

  if (!validDay(body.today)) bad('bad_today', 'today must be a valid YYYY-MM-DD date');
  const nowMin = body.nowMin;
  if (!num(nowMin) || !Number.isInteger(nowMin) || nowMin < 0 || nowMin > 1439) bad('bad_now', 'nowMin must be an integer 0..1439 (minutes past midnight)');
  const tz = body.tz;
  if (typeof tz !== 'string' || !tz || tz.length > 64) bad('bad_tz', 'tz must be an IANA time zone name');
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz as string }); } catch { bad('bad_tz', `"${String(tz).slice(0, 40)}" is not a known time zone`); }

  const today = body.today as string;
  const data = parseData(body.data, dnum(today));
  const noAsk = body.noAsk === true;
  const debug = body.debug === true;
  const maxNote = o.maxNote ?? LIMITS.noteChars;

  let note = '';
  let goalId: string | null = null;
  let adjustMode: AdjustMode | undefined;
  let lastSeen: number | null = null;

  if (mode === 'checkin') {
    if (body.lastSeen != null) {
      if (!num(body.lastSeen)) bad('bad_request', 'lastSeen must be epoch milliseconds or null');
      lastSeen = body.lastSeen as number;
    }
  } else {
    if (body.note != null && typeof body.note !== 'string') bad('bad_note', 'note must be a string');
    note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > maxNote) bad('bad_note', `note is over ${maxNote} characters`, 413);
    if (mode === 'adjust') {
      if (typeof body.goalId !== 'string' || !body.goalId) bad('bad_goal', 'goalId is required for adjust');
      const g = data.goals.find((x) => x.id === body.goalId);
      if (!g) bad('bad_goal', `goalId "${String(body.goalId).slice(0, 40)}" is not in data.goals`);
      goalId = body.goalId as string;
      const am = body.adjustMode ?? 'scope';
      if (am !== 'reduce' && am !== 'stretch' && am !== 'scope') bad('bad_adjust_mode', 'adjustMode must be "reduce", "stretch" or "scope"');
      adjustMode = am as AdjustMode;
      if (!note && (am === 'reduce' || am === 'stretch')) note = adjustNote(g!.title, am);
    }
    if (!note) bad('bad_note', 'note is required');
  }

  return { mode: mode as Mode, note, goalId, adjustMode, noAsk, debug, today, nowMin: nowMin as number, tz: tz as string, lastSeen, data };
};
