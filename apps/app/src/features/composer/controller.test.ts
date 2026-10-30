import { DEFAULT_PREFS, type ApplyResult, type CalendarData, type Prefs } from '@calendar/core';

import { createMemoryStore } from '@/store';
import { AiError, type AiRequest, type AiSuccess } from '../ai/client';
import type { Usage } from '../ai/usage';
import { createComposer, fetchCheckInQuestions, isRecapCommand, type Composer, type ComposerDeps } from './controller';

const TODAY = new Date(2026, 9, 30);
const NOW = { today: TODAY, nowMin: 600, nowMs: new Date(2026, 9, 30, 10, 0).getTime() };
const usage = (used: number): Usage => ({ used, limit: 200, resetsOn: '2026-11-01' });

const seed = (): CalendarData => ({
  events: [{ id: 'e1', day: '2026-10-30', cat: 'Work', title: 'Standup', start: 570, end: 585 }],
  cats: { Work: 220, Health: 140 },
  goals: [{ id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: 'Ship it', hours: 70, start: '2026-10-01', deadline: '2026-12-01', hue: 240 }],
});

interface Rig {
  c: Composer;
  deps: ComposerDeps;
  store: ReturnType<typeof createMemoryStore>;
  call: jest.Mock<Promise<AiSuccess>, [AiRequest]>;
  toasts: { label: string; undoId?: string | null }[];
  applied: ApplyResult[];
  highlights: [string[], number | null][];
  usages: (Usage | null | undefined)[];
  sleeps: number[];
  prefs: Prefs;
}

const rig = (o: { ai?: Partial<Prefs['ai']>; replies?: (AiSuccess | AiError)[] } = {}): Rig => {
  const prefs: Prefs = { ...DEFAULT_PREFS, ai: { ...DEFAULT_PREFS.ai, ...o.ai } };
  const store = createMemoryStore({ data: seed(), prefs });
  const replies = (o.replies ?? []).slice();
  const call = jest.fn<Promise<AiSuccess>, [AiRequest]>(async () => {
    const r = replies.shift();
    if (!r) throw new AiError('provider', 'no reply queued');
    if (r instanceof AiError) throw r;
    return r;
  });
  let n = 0;
  const toasts: Rig['toasts'] = [], applied: ApplyResult[] = [], highlights: Rig['highlights'] = [], usages: Rig['usages'] = [], sleeps: number[] = [];
  const deps: ComposerDeps = {
    getData: () => store.getState().data,
    getPrefs: () => store.getState().prefs,
    applyResult: (r) => { applied.push(r); store.applyResult(r); },
    newId: () => 'n' + ++n,
    now: () => NOW,
    tz: () => 'Europe/London',
    call,
    toast: (t) => { toasts.push(t); },
    recordUsage: (u) => { usages.push(u); },
    highlight: (ids, min) => { highlights.push([ids, min]); },
    openRecap: jest.fn(),
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
  };
  return { c: createComposer(deps), deps, store, call, toasts, applied, highlights, usages, sleeps, prefs };
};

/** Let the controller's promise chains run until `cond` holds. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await Promise.resolve();
  expect(cond()).toBe(true);
};
const idle = (r: Rig) => until(() => r.c.getState().phase === 'idle');

const gym: AiSuccess = {
  ops: [{ op: 'create', title: 'Gym', cat: 'Health', start: 420, end: 480, dayOffset: 0 }],
  usage: usage(7), model: 'claude-haiku-4-5',
};
const askOp = (q: string, ...opts: string[]) => ({ op: 'ask', question: q, options: opts });

describe('sending a note', () => {
  it('applies the returned ops locally through applyResult, with Undo and a highlight', async () => {
    const r = rig({ replies: [gym] });
    r.c.setDraft('  gym at 7  ');
    r.c.send();
    expect(r.c.getState()).toMatchObject({ phase: 'thinking', draft: '', query: 'gym at 7', seq: 1 });
    await idle(r);

    expect(r.call).toHaveBeenCalledTimes(1);
    expect(r.call.mock.calls[0][0]).toMatchObject({
      mode: 'note', note: 'gym at 7', noAsk: false, today: '2026-10-30', nowMin: 600, tz: 'Europe/London',
    });
    expect(r.call.mock.calls[0][0].data.events).toHaveLength(1);

    expect(r.applied).toHaveLength(1);
    const res = r.applied[0];
    expect(res.message).toBe('1 event added');
    expect(res.data.events).toHaveLength(2);
    expect(res.data.events[1]).toMatchObject({ id: 'n1', title: 'Gym', cat: 'Health', day: '2026-10-30', start: 420, end: 480 });
    expect(res.history?.label).toBe('Claude · 1 event added');
    expect(res.history?.kind).toBe('claude');
    /* the store took it and History/Undo work */
    expect(r.store.getState().data.events.map((e) => e.title)).toContain('Gym');
    expect(r.store.getState().history[0].id).toBe(res.history?.id);
    r.store.undo(res.history?.id);
    expect(r.store.getState().data.events).toHaveLength(1);

    expect(r.toasts.at(-1)).toEqual({ label: '1 event added', undoId: res.history?.id });
    expect(r.highlights).toEqual([[['n1'], 420]]);
    expect(r.usages).toContainEqual(usage(7));
  });

  it('ignores empty input and a second send while thinking', async () => {
    const r = rig({ replies: [gym] });
    r.c.send();
    expect(r.call).not.toHaveBeenCalled();
    r.c.setDraft('gym');
    r.c.send();
    r.c.setDraft('again');
    r.c.send();
    await idle(r);
    expect(r.call).toHaveBeenCalledTimes(1);
    expect(r.c.getState().draft).toBe('again');
  });

  it('uses the offline parser when Claude is off, after the thinking beat', async () => {
    const r = rig({ ai: { on: false, model: 'offline' } });
    r.c.setDraft('gym at 7');
    r.c.send();
    await idle(r);
    expect(r.call).not.toHaveBeenCalled();
    expect(r.sleeps).toContain(950);
    expect(r.applied[0].history?.label).toMatch(/^Note · /);
    expect(r.store.getState().data.events.some((e) => /gym/i.test(e.title) && e.start === 420)).toBe(true);
  });

  it('says "nothing to schedule" when the reply changes nothing', async () => {
    const r = rig({ ai: { on: false, model: 'offline' } });
    r.c.setDraft('?');
    r.c.send();
    await idle(r);
    expect(r.applied).toHaveLength(0);
    expect(r.toasts.at(-1)?.label).toBe('Nothing to schedule there');
  });

  it('opens the recap for "show my wins" instead of scheduling', () => {
    const r = rig();
    r.c.setDraft('Show my wins');
    r.c.send();
    expect(r.deps.openRecap).toHaveBeenCalled();
    expect(r.call).not.toHaveBeenCalled();
    expect(r.c.getState().phase).toBe('idle');
    expect(isRecapCommand('what did I achieve this week?')).toBe(true);
    expect(isRecapCommand('gym at 7')).toBe(false);
  });

  it('asks the server not to ask when the ask preference is off', async () => {
    const r = rig({ ai: { ask: false }, replies: [gym] });
    r.c.setDraft('gym');
    r.c.send();
    await idle(r);
    expect(r.call.mock.calls[0][0].noAsk).toBe(true);
  });
});

describe('errors', () => {
  it('falls back to the offline parser when the call fails, and says so', async () => {
    const r = rig({ replies: [new AiError('offline')] });
    r.c.setDraft('gym at 7');
    r.c.send();
    await idle(r);
    expect(r.c.getState().fellBack).toBe(true);
    expect(r.applied[0].history?.label).toMatch(/^Offline parse · /);
    expect(r.toasts.at(-1)?.label).toMatch(/using offline parsing$/);
    expect(r.store.getState().data.events.some((e) => e.start === 420)).toBe(true);
  });

  it.each(['timeout', 'provider', 'auth', 'unknown'] as const)('falls back on %s too', async (kind) => {
    const r = rig({ replies: [new AiError(kind)] });
    r.c.setDraft('gym at 7');
    r.c.send();
    await idle(r);
    expect(r.applied[0].history?.label).toMatch(/^Offline parse/);
  });

  it('on the monthly limit records the usage, names the reset date and uses the offline parser', async () => {
    const r = rig({ replies: [new AiError('limit', 'x', { usage: usage(200) })] });
    r.c.setDraft('gym at 7');
    r.c.send();
    await idle(r);
    expect(r.usages).toContainEqual(usage(200));
    expect(r.toasts.map((t) => t.label)).toContain('Monthly notes used · using offline parsing until Nov 1');
    expect(r.applied[0].history?.label).toMatch(/^Offline parse/);
    expect(r.c.getState().fellBack).toBe(true);
  });

  it('retries once after retryAfter when rate limited, then applies', async () => {
    const r = rig({ replies: [new AiError('rate_limit', 'slow', { retryAfter: 3, usage: usage(10) }), gym] });
    r.c.setDraft('gym');
    r.c.send();
    await idle(r);
    expect(r.call).toHaveBeenCalledTimes(2);
    expect(r.sleeps).toContain(3000);
    expect(r.applied).toHaveLength(1);
  });

  it('keeps the note in the input when the rate limit is long or repeats', async () => {
    const long = rig({ replies: [new AiError('rate_limit', 'slow', { retryAfter: 45 })] });
    long.c.setDraft('gym');
    long.c.send();
    await idle(long);
    expect(long.call).toHaveBeenCalledTimes(1);
    expect(long.c.getState().draft).toBe('gym');
    expect(long.toasts.at(-1)?.label).toBe('Too many notes at once · try again in 45s');

    const twice = rig({ replies: [new AiError('rate_limit', '', { retryAfter: 2 }), new AiError('rate_limit', '', { retryAfter: 2 })] });
    twice.c.setDraft('gym');
    twice.c.send();
    await idle(twice);
    expect(twice.call).toHaveBeenCalledTimes(2);
    expect(twice.applied).toHaveLength(0);
    expect(twice.c.getState().draft).toBe('gym');
  });

  it('does not guess when the reply is unusable: message, and the note comes back', async () => {
    const r = rig({ replies: [new AiError('bad_reply')] });
    r.c.setDraft('gym');
    r.c.send();
    await idle(r);
    expect(r.applied).toHaveLength(0);
    expect(r.c.getState().draft).toBe('gym');
    expect(r.toasts.at(-1)?.label).toBe('Claude returned nothing usable — try rewording');
  });

  it('treats a reply that resolves to nothing as unusable', async () => {
    const r = rig({ replies: [{ ops: [askOp('When?', 'Now', 'Later')], usage: usage(1), model: null }], ai: { ask: false } });
    r.c.setDraft('x');
    r.c.send();
    await idle(r);
    expect(r.applied).toHaveLength(0);
    expect(r.c.getState().draft).toBe('x');
  });
});

describe('the ask flow', () => {
  const asking: AiSuccess = {
    ops: [
      { op: 'create', title: 'Standup', cat: 'Work', start: 600, end: 615, dayOffset: 1 },
      askOp('Which day for the gym?', 'Today', 'Tomorrow', 'Monday'),
      askOp('How long?', '30 min', '1 hour'),
    ],
    usage: usage(3), model: 'claude-haiku-4-5',
  };

  it('applies the rest straight away and shows the questions one at a time', async () => {
    const r = rig({ replies: [asking] });
    r.c.setDraft('gym and standup');
    r.c.send();
    await until(() => r.c.getState().phase === 'asking');
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].message).toBe('1 event added');
    const s = r.c.getState();
    expect(s.ask?.qs.map((q) => q.q)).toEqual(['Which day for the gym?', 'How long?']);
    expect(s.ask?.note).toContain('The operations from your previous reply are already applied. Do not repeat them.');
    expect(s.draft).toBe('');
  });

  it('answers both questions, then re-sends the note with the answers', async () => {
    const r = rig({ replies: [asking, gym] });
    r.c.setDraft('gym and standup');
    r.c.send();
    await until(() => r.c.getState().phase === 'asking');

    r.c.answerAsk('Tomorrow');
    await until(() => r.c.getState().ask?.idx === 1);
    expect(r.sleeps).toContain(190);
    expect(r.c.getState().ask?.ans).toEqual(['Tomorrow']);

    r.c.answerAsk('1 hour');
    await until(() => r.call.mock.calls.length === 2);
    await idle(r);
    const second = r.call.mock.calls[1][0];
    expect(second.note).toContain('Answers to your questions:\n- Which day for the gym? → Tomorrow\n- How long? → 1 hour');
    expect(second.noAsk).toBe(false);
    expect(r.c.getState().ask).toBeNull();
    expect(r.applied).toHaveLength(2);
  });

  it('takes a typed answer from the composer input', async () => {
    const r = rig({ replies: [asking, gym] });
    r.c.setDraft('x');
    r.c.send();
    await until(() => r.c.getState().phase === 'asking');
    r.c.setDraft('the 3rd');
    r.c.send();
    expect(r.c.getState().draft).toBe('');
    await until(() => r.c.getState().ask?.idx === 1);
    expect(r.c.getState().ask?.ans[0]).toBe('the 3rd');
  });

  it('skip sends what has been answered, "you decide" for the rest', async () => {
    const r = rig({ replies: [asking, gym] });
    r.c.setDraft('x');
    r.c.send();
    await until(() => r.c.getState().phase === 'asking');
    r.c.skipAsk();
    await until(() => r.call.mock.calls.length === 2);
    expect(r.call.mock.calls[1][0].note).toContain('- Which day for the gym? → you decide');
    await idle(r);
  });

  it('keyboard: a digit picks, Escape dismisses without sending', async () => {
    const r = rig({ replies: [asking] });
    r.c.setDraft('x');
    r.c.send();
    await until(() => r.c.getState().phase === 'asking');
    expect(r.c.askKey('2')).toBe(true);
    await until(() => r.c.getState().ask?.idx === 1);
    expect(r.c.getState().ask?.ans[0]).toBe('Tomorrow');
    expect(r.c.askKey('x')).toBe(false);
    expect(r.c.askKey('Escape')).toBe(true);
    await idle(r);
    expect(r.c.getState().ask).toBeNull();
    expect(r.call).toHaveBeenCalledTimes(1);
  });

  it('stops asking after three rounds (noAsk)', async () => {
    const q = (): AiSuccess => ({ ops: [askOp('Again?', 'Yes', 'No')], usage: usage(1), model: null });
    const r = rig({ replies: [q(), q(), q(), gym] });
    r.c.setDraft('x');
    r.c.send();
    for (let round = 1; round <= 3; round++) {
      await until(() => r.c.getState().phase === 'asking' && r.c.getState().ask?.closing === false);
      expect(r.call).toHaveBeenCalledTimes(round);
      r.c.answerAsk('Yes');
      await until(() => r.call.mock.calls.length === round + 1);
    }
    expect(r.call.mock.calls[3][0].noAsk).toBe(true);
    await idle(r);
  });
});

describe('goal adjustments', () => {
  const adjust: AiSuccess = {
    ops: [askOp('What should give way?', 'Push the deadline', 'Cut hours')],
    usage: usage(4), model: 'claude-haiku-4-5',
  };

  it('sends mode adjust with the goal and the adjustment note', async () => {
    const r = rig({ replies: [adjust] });
    r.c.startGoalAdjust('g1', 'reduce');
    expect(r.c.getState().phase).toBe('thinking');
    await until(() => r.c.getState().phase === 'asking');
    expect(r.call.mock.calls[0][0]).toMatchObject({
      mode: 'adjust', goalId: 'g1', adjustMode: 'reduce', noAsk: false,
      note: 'I’m behind on Deep work. Help me reduce the scope. Ask me what should give way.',
    });
    expect(r.c.getState().ask?.goalId).toBe('g1');
  });

  it('asks even when the ask preference is off, and re-sends in adjust mode', async () => {
    const r = rig({ ai: { ask: false }, replies: [adjust, { ops: [{ op: 'goal', id: 'g1', hours: 50 }], usage: usage(5), model: null }] });
    r.c.startGoalAdjust('g1', 'stretch');
    await until(() => r.c.getState().phase === 'asking');
    expect(r.call.mock.calls[0][0].note).toContain('I’m on track with Deep work. Help me add a stretch.');
    r.c.answerAsk('Cut hours');
    await until(() => r.call.mock.calls.length === 2);
    await idle(r);
    expect(r.call.mock.calls[1][0]).toMatchObject({ mode: 'adjust', goalId: 'g1', adjustMode: 'stretch' });
    expect(r.store.getState().data.goals[0].hours).toBe(50);
    expect(r.toasts.at(-1)?.label).toBe('goal set');
  });

  it('explains that Claude is off instead of calling', () => {
    const r = rig({ ai: { on: false, model: 'offline' } });
    r.c.startGoalAdjust('g1', 'reduce');
    expect(r.call).not.toHaveBeenCalled();
    expect(r.toasts.at(-1)?.label).toBe('Turn on Claude in settings to adjust goals');
    expect(r.c.getState().phase).toBe('idle');
  });

  it('does not fall back to the parser when offline (there is no offline adjustment)', async () => {
    const r = rig({ replies: [new AiError('offline')] });
    r.c.startGoalAdjust('g1', 'reduce');
    await idle(r);
    expect(r.applied).toHaveLength(0);
    expect(r.toasts.at(-1)?.label).toBe('Goal adjustments need a connection');
  });

  it('ignores an unknown goal', () => {
    const r = rig();
    r.c.startGoalAdjust('nope', 'reduce');
    expect(r.call).not.toHaveBeenCalled();
  });
});

describe('check-ins', () => {
  it('sends free-text check-in answers as a note without asking questions', async () => {
    const r = rig({ replies: [gym] });
    r.c.submitCheckInAnswers('These things already happened today.\n- Lunch? → soup at 1', ['soup at 1']);
    expect(r.c.getState().phase).toBe('thinking');
    await idle(r);
    expect(r.call.mock.calls[0][0]).toMatchObject({ mode: 'note', noAsk: true, note: expect.stringContaining('soup at 1') });
    expect(r.applied).toHaveLength(1);
  });

  it('parses them offline when Claude is off', async () => {
    const r = rig({ ai: { on: false, model: 'offline' } });
    r.c.submitCheckInAnswers('ignored', ['soup at 1pm']);
    await idle(r);
    expect(r.call).not.toHaveBeenCalled();
    expect(r.sleeps).toContain(500);
    expect(r.store.getState().data.events.some((e) => /soup/i.test(e.title))).toBe(true);
  });

  it('fetches the questions in mode checkin and normalises them', async () => {
    const r = rig({
      replies: [{
        ops: [{ field: 'goal', id: 'g1', q: 'Deep work is behind — how much today?', chips: ['1h', '2h', 'Not today', 'extra'] }, { field: 'log', question: 'Lunch?', options: ['Skipped it'] }, 'junk'],
        usage: usage(9), model: 'claude-haiku-4-5',
      }],
    });
    const qs = await fetchCheckInQuestions(r.deps, 1234);
    expect(r.call.mock.calls[0][0]).toMatchObject({ mode: 'checkin', lastSeen: 1234, today: '2026-10-30', nowMin: 600 });
    expect(qs).toEqual([
      { field: 'goal', id: 'g1', q: 'Deep work is behind — how much today?', chips: ['1h', '2h', 'Not today'] },
      { field: 'log', id: null, q: 'Lunch?', chips: ['Skipped it'] },
    ]);
    expect(r.usages).toContainEqual(usage(9));
  });

  it('returns null (use the local questions) on any failure', async () => {
    const r = rig({ replies: [new AiError('limit', 'x', { usage: usage(200) })] });
    expect(await fetchCheckInQuestions(r.deps, 0)).toBeNull();
    expect(r.usages).toContainEqual(usage(200));
    const r2 = rig({ replies: [{ ops: [{ nothing: true }], usage: null, model: null }] });
    expect(await fetchCheckInQuestions(r2.deps, 0)).toBeNull();
  });
});
