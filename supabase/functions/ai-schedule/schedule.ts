/**
 * The two-pass flow of the prototype's `askClaude` / `ciAsk` / `verify`, minus applying the ops
 * (the client does that, so undo and history keep working).
 *
 *  1. Pass 1: the scheduler, goal-adjust or check-in skill produces a JSON array.
 *  2. Code validator (core `checkOps` / `checkCi`): deterministic findings, never shown to the user.
 *  3. Pass 2: the verifier skill sees the request, the candidate and the findings and answers
 *     `{"ok":true}` or `{"ok":false,"reason":...,"fixed":[...]}`. Exactly one fix round: the fixed
 *     array is returned as is, as in the prototype.
 */
import {
  checkCi, checkOps, ciPrompt, dnum, normCheckIn, parseArr, parseVerdict, schedulerInput, verdictFix, winCands,
} from '@calendar/core';
import type { NowCtx } from '@calendar/core';
import type { ModelTransport, SkillName } from './anthropic.ts';
import type { AiInput } from './request.ts';

/** The model's reply could not be used (no JSON array, empty, or no usable question). */
export class BadReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadReplyError';
  }
}

export type Verified = 'approved' | 'fixed' | 'skipped';

export interface ScheduleResult {
  /** Final ops (mode note/adjust) or check-in questions (mode checkin), as returned by the model. */
  ops: unknown[];
  /** Whether the verifier approved the candidate, replaced it, or could not be run. */
  verified: Verified;
  /** Code-validator findings on the final ops; empty when clean. */
  issues: string[];
  /** The pass-1 reply (before the verifier) and its findings. */
  first: { ops: unknown[]; issues: string[] };
}

type Kind = 'scheduler' | 'goal-adjust' | 'checkin';

const skillFor = (k: Kind): SkillName => (k === 'checkin' ? 'calendar-checkin' : k === 'goal-adjust' ? 'calendar-goal-adjust' : 'calendar-scheduler');
const pass1Skills = (k: Kind): SkillName[] => (k === 'goal-adjust' ? ['calendar-goal-adjust', 'calendar-scheduler'] : [skillFor(k)]);
const verifierSkills = (k: Kind): SkillName[] =>
  k === 'checkin' ? ['calendar-verifier', 'calendar-checkin']
    : k === 'goal-adjust' ? ['calendar-verifier', 'calendar-goal-adjust', 'calendar-scheduler']
    : ['calendar-verifier', 'calendar-scheduler'];

export const kindOf = (mode: AiInput['mode']): Kind => (mode === 'checkin' ? 'checkin' : mode === 'adjust' ? 'goal-adjust' : 'scheduler');

export const runSchedule = async (input: AiInput, transport: ModelTransport): Promise<ScheduleResult> => {
  const kind = kindOf(input.mode);
  const today = dnum(input.today);
  /* Floating local time: "now" is today's midnight plus the client's minutes, in this runtime's zone,
     the same convention core uses for event times (dnum + minutes). */
  const ctx: NowCtx & { nowMs: number } = { today, nowMin: input.nowMin, nowMs: today.getTime() + input.nowMin * 60000 };
  const { data } = input;

  const prompt = kind === 'checkin'
    ? ciPrompt(data, ctx, input.lastSeen)
    : schedulerInput(data, ctx, input.note, { noAsk: input.noAsk, goalId: input.goalId, mode: input.adjustMode });

  const check = (arr: unknown[]): string[] =>
    kind === 'checkin'
      ? checkCi(arr, data, winCands(data.events, data.goals, today, ctx.nowMs).map((e) => e.id))
      : checkOps(arr, data, today, input.noAsk);

  // ---- pass 1
  const raw = await transport.call(
    pass1Skills(kind),
    prompt + '\n\nUse the ' + skillFor(kind) + ' skill. Reply with only the JSON array.',
    kind === 'checkin' ? 2048 : 4096,
  );
  let first: unknown[];
  try {
    first = parseArr(raw);
  } catch (e) {
    throw new BadReplyError(String((e as Error)?.message ?? e));
  }

  // ---- pass 2: approve or silently replace; one round
  let ops = first;
  let verified: Verified = 'skipped';
  const found = check(first);
  try {
    const user = prompt + '\n\n<candidate kind="' + kind + '">\n' + JSON.stringify(first) + '\n</candidate>\n\n<code_checks>\n'
      + (found.length ? found.map((x) => '- ' + x).join('\n') : '(none)')
      + '\n</code_checks>\n\nUse the calendar-verifier skill. Reply with only the JSON object.';
    const reply = await transport.call(verifierSkills(kind), user, 4096);
    const fix = verdictFix(parseVerdict(reply));
    if (fix) { ops = fix; verified = 'fixed'; } else verified = 'approved';
  } catch (e) {
    // As in the prototype, a verifier that fails (HTTP error, unparseable verdict) is skipped.
    console.warn('[ai-schedule] verifier skipped', String((e as Error)?.message ?? e));
  }

  if (!Array.isArray(ops) || !ops.length) throw new BadReplyError('empty');
  if (kind === 'checkin' && !normCheckIn(ops as Array<Record<string, unknown>>).length) throw new BadReplyError('empty');
  return { ops, verified, issues: check(ops), first: { ops: first, issues: found } };
};
