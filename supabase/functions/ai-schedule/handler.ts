/**
 * ai-schedule: the server-side replacement for the browser's direct Anthropic calls.
 *
 * POST (JWT required)
 *   { mode: 'note' | 'adjust' | 'checkin',
 *     note?, goalId?, adjustMode?: 'reduce'|'stretch'|'scope', noAsk?, lastSeen?,
 *     today: 'YYYY-MM-DD', nowMin: 0..1439, tz: 'Europe/London',
 *     data: { events, cats, goals } }          // the client's own CalendarData snapshot, size-capped
 *
 * 200 { ok: true, mode, ops: [...], verified: 'approved'|'fixed'|'skipped', issues: [...],
 *       model, transport, usage: { used, limit, resetsOn } }
 *     `ops` are the scheduler/goal-adjust operations (may contain `ask` ops) or the check-in
 *     questions; the client resolves and applies them with @calendar/core.
 *     With `debug: true` in the request it also has `firstOps`/`firstIssues`: the scheduler's reply
 *     before the verifier (used by evals).
 * 4xx/5xx { error: '<code>', message?, usage? }
 *     429 { error: 'limit', used, limit, resetsOn }       monthly allowance used up
 *     429 { error: 'rate_limit', retryAfter, usage }      too many calls in the last minute
 *
 * Every accepted call takes one note from the month's allowance (ai_claim); a call that fails
 * through no fault of the user (provider down, unusable reply) gives it back (ai_refund).
 */
import { errorResponse, HttpError, json, preflight, readJsonBody } from '../_shared/http.ts';
import { MissingEnvError } from '../_shared/env.ts';
import type { BaseDeps } from '../_shared/supabase.ts';
import { AnthropicError, createTransport } from './anthropic.ts';
import type { ModelTransport } from './anthropic.ts';
import { parseRequest } from './request.ts';
import { BadReplyError, runSchedule } from './schedule.ts';

export interface AiDeps extends BaseDeps {
  /** Replace the model transport (tests). Default: `createTransport(env, fetch)`. */
  transport?: () => ModelTransport;
}

export interface Usage { used: number; limit: number; resetsOn: string }

/** First day of the month after `usageMonth` (`YYYY-MM-01`), as `YYYY-MM-DD`: when the allowance resets (UTC). */
export const resetsOn = (usageMonth: string): string => {
  const [y, m] = usageMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

interface Claim { allowed: boolean; reason: 'ok' | 'limit' | 'rate'; used: number; usage_month: string; retry_after: number }

const mapUpstream = (e: unknown): HttpError => {
  if (e instanceof BadReplyError) return new HttpError(502, 'bad_reply', 'The model returned nothing usable', { detail: e.message });
  if (e instanceof AnthropicError) {
    if (e.status === 401 || e.status === 403) return new HttpError(502, 'upstream_auth', 'The AI provider rejected the server credentials');
    if (e.status === 429) return new HttpError(503, 'upstream_rate_limit', 'The AI provider is rate limiting; try again shortly', {}, { 'retry-after': '10' });
    if (e.status === 0 && e.detail === 'timeout') return new HttpError(504, 'upstream_timeout', 'The AI provider took too long');
    if (e.status === 0 || e.status >= 500) return new HttpError(502, 'upstream_unavailable', 'The AI provider is unavailable');
    return new HttpError(502, 'upstream_error', 'The AI provider rejected the request');
  }
  return e instanceof HttpError ? e : new HttpError(500, 'internal', 'Something went wrong');
};

export const handle = async (req: Request, deps: AiDeps): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    return await run(req, deps);
  } catch (e) {
    if (e instanceof MissingEnvError) return errorResponse(new HttpError(500, 'server_config', e.message));
    return errorResponse(e);
  }
};

const run = async (req: Request, deps: AiDeps): Promise<Response> => {
  const { env } = deps;
  const limit = env.int('AI_MONTHLY_LIMIT', 200);
  const perMinute = env.int('AI_PER_MINUTE', 6);

  const user = await deps.auth(req);
  const body = await readJsonBody(req, env.int('AI_MAX_BODY_BYTES', 1_000_000));
  const input = parseRequest(body);

  // Fail on a missing key before anything is counted.
  const transport = deps.transport ? deps.transport() : createTransport(env, deps.fetch);
  const admin = deps.admin();

  const { data, error } = await admin.rpc('ai_claim', { p_user_id: user.id, p_limit: limit, p_per_minute: perMinute });
  const claim = (Array.isArray(data) ? data[0] : data) as Claim | null;
  if (error || !claim) {
    console.error('[ai-schedule] ai_claim failed', error);
    throw new HttpError(503, 'usage_unavailable', 'Could not check the AI allowance; try again');
  }
  const reset = resetsOn(String(claim.usage_month));
  const usage: Usage = { used: claim.used, limit, resetsOn: reset };

  if (!claim.allowed) {
    if (claim.reason === 'limit') throw new HttpError(429, 'limit', 'Monthly AI allowance used up', { used: claim.used, limit, resetsOn: reset, usage });
    throw new HttpError(429, 'rate_limit', 'Too many requests; slow down', { retryAfter: claim.retry_after, usage }, { 'retry-after': String(claim.retry_after) });
  }

  try {
    const result = await runSchedule(input, transport);
    return json({
      ok: true, mode: input.mode, ops: result.ops, verified: result.verified, issues: result.issues,
      model: transport.model, transport: transport.kind, usage,
      ...(input.debug ? { firstOps: result.first.ops, firstIssues: result.first.issues } : {}),
    });
  } catch (e) {
    // The call produced nothing for the user: give the note back (best effort).
    const refunded = await admin.rpc('ai_refund', { p_user_id: user.id }).then((r) => r, () => null);
    const used = refunded && !refunded.error && typeof refunded.data === 'number' ? refunded.data : Math.max(0, claim.used - 1);
    const err = mapUpstream(e);
    if (err.status === 500) console.error('[ai-schedule]', e);
    throw new HttpError(err.status, err.code, err.message, { ...err.extra, usage: { ...usage, used } }, err.headers);
  }
};
