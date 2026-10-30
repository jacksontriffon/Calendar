/**
 * Client for the `ai-schedule` edge function (docs/expo-plan.md section 5).
 *
 * The function takes the client's own `CalendarData` snapshot plus a note (or a goal-adjust or
 * check-in request) and returns operations (or check-in questions) and the monthly `usage`. The
 * app applies the operations itself with @calendar/core so History/Undo keep working.
 *
 * This file is pure: the transport is injected (`AiInvoker`); the default one that talks to
 * Supabase lives in `./invoker.ts`. Every failure is an `AiError` with a `kind` the composer
 * switches on: `limit` and `rate_limit` have their own states, the rest fall back to the offline
 * parser.
 */
import type { AdjustMode, CalendarData, ProtoEvent } from '@calendar/core';

import { parseUsage, type Usage } from './usage';

export type AiMode = 'note' | 'adjust' | 'checkin';

export interface AiRequest {
  mode: AiMode;
  /** the user text (empty for check-ins) */
  note?: string;
  /** adjust mode: the goal being adjusted */
  goalId?: string | null;
  adjustMode?: AdjustMode;
  /** make the best assumption instead of asking questions */
  noAsk?: boolean;
  /** `YYYY-MM-DD` */
  today: string;
  /** minutes past midnight now */
  nowMin: number;
  /** IANA time zone */
  tz: string;
  data: CalendarData;
  /** check-in: epoch ms of the last time the user looked at the calendar */
  lastSeen?: number | null;
}

export interface AiSuccess {
  /** scheduler / goal-adjust operations (may contain `ask` ops) or check-in questions */
  ops: unknown[];
  usage: Usage | null;
  /** model id as reported by the server, e.g. `claude-haiku-4-5` */
  model: string | null;
}

export type AiErrorKind =
  /** the monthly allowance is used up */
  | 'limit'
  /** too many calls in the last minute: retry after `retryAfter` seconds */
  | 'rate_limit'
  /** no connection */
  | 'offline'
  | 'timeout'
  /** the session is missing or expired */
  | 'auth'
  /** the model returned nothing usable (the note was refunded) */
  | 'bad_reply'
  /** the provider or function is down or misconfigured */
  | 'provider'
  /** the request itself was rejected (too large, malformed) */
  | 'bad_request'
  | 'unknown';

export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message?: string,
    public readonly extra: { retryAfter?: number; usage?: Usage | null; status?: number } = {},
  ) {
    super(message ?? kind);
    this.name = 'AiError';
  }
  get retryAfter(): number | undefined { return this.extra.retryAfter; }
  get usage(): Usage | null { return this.extra.usage ?? null; }
  get status(): number | undefined { return this.extra.status; }
}

/** The shape of `supabase.functions.invoke`'s result, which is all the client needs from it. */
export interface AiInvokeResult { data: unknown; error: unknown }
export type AiInvoker = (name: string, opts: { body: Record<string, unknown>; signal?: AbortSignal }) => Promise<AiInvokeResult>;

export const AI_FUNCTION = 'ai-schedule';
/** Two model passes (scheduler then verifier) can take a while; check-ins are shorter. */
export const TIMEOUT_MS = { note: 60_000, adjust: 60_000, checkin: 40_000 } as const;

/** The function rejects more events than this (and bodies over ~1 MB). */
export const MAX_EVENTS = 4500;

/**
 * The snapshot the function needs: only the fields its validator whitelists (the app's own
 * visibility / source / series fields stay home), and at most `MAX_EVENTS` events, newest days first.
 */
export function slimData(data: CalendarData): CalendarData {
  const evs = data.events.length > MAX_EVENTS
    ? data.events.slice().sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, MAX_EVENTS)
    : data.events;
  return {
    cats: data.cats,
    goals: data.goals,
    events: evs.map((e) => {
      const o: ProtoEvent = { id: e.id, day: e.day, cat: e.cat, title: e.title, start: e.start, end: e.end };
      if (e.allDay) o.allDay = true;
      if (e.days != null) o.days = e.days;
      if (e.done) o.done = true;
      if (e.pauses?.length) o.pauses = e.pauses;
      if (e.win) o.win = e.win;
      if (e.winAsked) o.winAsked = true;
      if (e.at != null) o.at = e.at;
      if (e.goalId) o.goalId = e.goalId;
      return o;
    }),
  };
}

/** The JSON body of the request, without `undefined` fields. */
export function toBody(req: AiRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mode: req.mode, today: req.today, nowMin: req.nowMin, tz: req.tz, data: slimData(req.data),
  };
  if (req.mode === 'checkin') {
    body.lastSeen = req.lastSeen ?? null;
    return body;
  }
  body.note = req.note ?? '';
  if (req.noAsk) body.noAsk = true;
  if (req.mode === 'adjust') {
    body.goalId = req.goalId;
    if (req.adjustMode) body.adjustMode = req.adjustMode;
  }
  return body;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Read `{ error: '<code>', ... }` out of a failed response (a `Response`, or an already-parsed body). */
async function errorBody(ctx: unknown): Promise<{ status?: number; body: Record<string, unknown> | null }> {
  if (!ctx || typeof ctx !== 'object') return { body: null };
  const c = ctx as { status?: unknown; json?: unknown; clone?: unknown };
  const status = typeof c.status === 'number' ? c.status : undefined;
  if (typeof c.json === 'function') {
    try {
      const res = typeof c.clone === 'function' ? (c.clone as () => Response).call(ctx) : (ctx as Response);
      const body: unknown = await res.json();
      return { status, body: isObj(body) ? body : null };
    } catch {
      return { status, body: null };
    }
  }
  return { status, body: isObj(ctx) ? ctx : null };
}

/** Whether a fetch failure was our own abort (timeout) rather than a lost connection. */
const isAbort = (e: unknown): boolean => {
  const c = isObj(e) ? (e.context ?? e) : null;
  const name = isObj(c) ? String(c.name ?? '') : '';
  return name === 'AbortError' || name === 'TimeoutError';
};

/** Turn whatever `functions.invoke` (or the timeout wrapper) reported into an `AiError`. */
export async function mapInvokeError(error: unknown): Promise<AiError> {
  if (error instanceof AiError) return error;
  const name = isObj(error) ? String(error.name ?? '') : error instanceof Error ? error.name : '';
  if (name === 'FunctionsFetchError' || name === 'TypeError') {
    return new AiError(isAbort(error) ? 'timeout' : 'offline', 'The request did not reach the server');
  }
  if (name === 'AbortError') return new AiError('timeout', 'The request timed out');
  if (name === 'FunctionsRelayError') return new AiError('provider', 'The function could not be reached');
  if (name === 'FunctionsHttpError') {
    const { status, body } = await errorBody(isObj(error) ? error.context : null);
    const code = body && typeof body.error === 'string' ? body.error : '';
    const usage = body ? parseUsage(body.usage) ?? parseUsage(body) : null;
    if (code === 'limit') return new AiError('limit', 'Monthly allowance used up', { status, usage });
    if (code === 'rate_limit') {
      const ra = body ? Number(body.retryAfter) : 0;
      return new AiError('rate_limit', 'Too many requests', { status, usage, retryAfter: ra > 0 ? Math.ceil(ra) : 10 });
    }
    if (status === 401 || code === 'unauthorized' || code === 'invalid_jwt') return new AiError('auth', 'Not signed in', { status, usage });
    if (code === 'bad_reply') return new AiError('bad_reply', 'The model returned nothing usable', { status, usage });
    if (status === 400 || status === 413 || status === 405) {
      return new AiError('bad_request', (body && String(body.message ?? code)) || 'Bad request', { status, usage });
    }
    return new AiError('provider', (body && String(body.message ?? code)) || 'The AI service failed', { status, usage });
  }
  return new AiError('unknown', error instanceof Error ? error.message : 'Unknown error');
}

/** Run `p`, but give up (aborting `ctl`) after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new AiError('timeout', 'The request timed out'));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Call `ai-schedule`. Resolves with the ops and usage; rejects with an `AiError`. */
export async function callAi(req: AiRequest, o: { invoke: AiInvoker; timeoutMs?: number }): Promise<AiSuccess> {
  const ctl = new AbortController();
  let res: AiInvokeResult;
  try {
    res = await withTimeout(o.invoke(AI_FUNCTION, { body: toBody(req), signal: ctl.signal }), o.timeoutMs ?? TIMEOUT_MS[req.mode], ctl);
  } catch (e) {
    throw await mapInvokeError(e);
  }
  if (res.error) throw await mapInvokeError(res.error);
  const d = res.data;
  if (!isObj(d) || d.ok === false) throw new AiError('provider', 'Unexpected reply from the AI service');
  if (!Array.isArray(d.ops)) throw new AiError('bad_reply', 'The reply had no operations');
  return {
    ops: d.ops,
    usage: parseUsage(d.usage),
    model: typeof d.model === 'string' ? d.model : null,
  };
}
