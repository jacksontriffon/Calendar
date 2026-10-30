/**
 * The composer's brain: a note goes to `ai-schedule` (or the offline parser), the reply is
 * resolved with core `interpretReply`, applied with `applyResolved` through the store's
 * `applyResult` (so History/Undo work) and announced with a toast. Clarifying questions open the
 * ask flow; goal adjustments and check-in follow-ups reuse the same path.
 *
 * Nothing here touches React, the network or the store directly: everything outside comes in as
 * `ComposerDeps`, so the flow is unit-testable with a mocked client. `./instance.ts` wires the real
 * ones.
 */
import {
  adjustNote, applyResolved, interpretReply, isEmptyResolved, key, normCheckIn, parseNote,
  type AdjustMode, type ApplyResult, type ApplySource, type CalendarData, type CheckInQuestion, type OpsCtx,
  type Prefs, type Resolved,
} from '@calendar/core';

import { AiError, type AiRequest, type AiSuccess } from '../ai/client';
import { formatResetDate, type Usage } from '../ai/usage';
import {
  back as askBack, followUpNote, keyIntent, moveHighlight, openAsk, pickAnswer, setHighlight, settle, skip as askSkip,
  type AskState,
} from '../ask/model';

export interface ComposerDeps {
  getData(): CalendarData;
  getPrefs(): Prefs;
  /** the store's `applyResult` (records the History entry) */
  applyResult(r: ApplyResult): void;
  newId(): string;
  now(): { today: Date; nowMin: number; nowMs: number };
  /** IANA zone: the profile's, else the device's */
  tz(): string;
  /** `ai-schedule` */
  call(req: AiRequest): Promise<AiSuccess>;
  toast(t: { label: string; undoId?: string | null }): void;
  recordUsage(usage: Usage | null | undefined, model?: string | null): void;
  /** created/updated ids and the minute to scroll to */
  highlight(ids: string[], focusMin: number | null): void;
  openRecap(): void;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export type Phase = 'idle' | 'thinking' | 'asking';

export interface ComposerState {
  /** the text in the input (also the typed answer while a question is open) */
  draft: string;
  phase: Phase;
  /** the last note, for the thinking phrase */
  query: string;
  /** counts sends: rotates the phrase and retriggers the send pulse */
  seq: number;
  ask: AskState | null;
  /** the last request fell back to the offline parser (the pill says "offline") */
  fellBack: boolean;
}

/** Timings from the prototype. */
export const PICK_MS = 190;
export const ASK_EXIT_MS = 200;
export const OFFLINE_THINK_MS = 950;
/** A rate-limited call is retried once, after the server's `retryAfter`, if that is this short. */
export const RETRY_MAX_S = 20;
/** After this many question rounds the scheduler is told to stop asking. */
export const MAX_ASK_ROUNDS = 3;

/** "show my wins", "recap", "what did I achieve this week?" open the recap instead of scheduling. */
export const isRecapCommand = (t: string): boolean =>
  /^(show |open )?(my |the )?(weekly |this week'?s? |week(ly)? )?(wins|recap|achievements|win summary)\??$/i.test(t)
  || /^what (did|have) i (achieved?|got? done)( this week)?\??$/i.test(t);

interface RunOpts {
  noAsk?: boolean;
  goal?: { id: string; mode: AdjustMode } | null;
  /** the user's own words, for the offline fallback and for restoring the input */
  base: string;
  /** a follow-up (check-in answers): do not put the text back in the input on failure */
  followUp?: boolean;
}

export interface Composer {
  getState(): ComposerState;
  subscribe(l: () => void): () => void;
  setDraft(t: string): void;
  /** the send button / Enter */
  send(): void;
  /** goal sheet buttons: Reduce scope / Add stretch goal */
  startGoalAdjust(goalId: string, mode: AdjustMode): void;
  /** free-text check-in answers: sent as a note (AI on) or parsed offline */
  submitCheckInAnswers(note: string, plain: string[]): void;
  answerAsk(label: string): void;
  backAsk(): void;
  skipAsk(): void;
  closeAsk(): void;
  moveAskHighlight(d: 1 | -1): void;
  hoverAsk(i: number): void;
  /** keyboard on web while the sheet is open and no field has focus; true when handled */
  askKey(key: string): boolean;
}

export function createComposer(deps: ComposerDeps): Composer {
  let state: ComposerState = { draft: '', phase: 'idle', query: '', seq: 0, ask: null, fellBack: false };
  const subs = new Set<() => void>();
  const set = (p: Partial<ComposerState>) => {
    state = { ...state, ...p };
    subs.forEach((l) => l());
  };

  /* per-conversation memory (the prototype's _askRound / _askGoal) */
  let round = 0;
  let goal: RunOpts['goal'] = null;
  let base = '';
  /** bumped to drop the answer of a run that has been superseded */
  let token = 0;

  const ctx = (): OpsCtx => {
    const n = deps.now();
    return { today: n.today, nowMin: n.nowMin, nowMs: n.nowMs, nextId: deps.newId, random: deps.random };
  };

  const finishApply = (res: ApplyResult, label?: string) => {
    if (res.empty) {
      deps.toast({ label: res.message });
      set({ phase: 'idle' });
      return;
    }
    deps.applyResult(res);
    deps.toast({ label: label ?? res.message, undoId: res.history?.id ?? null });
    deps.highlight(res.newIds, res.focusMin);
    set({ phase: 'idle' });
  };

  const applyResolvedNow = (r: Resolved, src: ApplySource) => {
    const c = ctx();
    const res = applyResolved(deps.getData(), r, c, src);
    finishApply(res, src === 'fallback' ? res.message.replace(/ · offline parse$/, '') + ' · using offline parsing' : undefined);
  };

  /** The on-device parser: no questions, always makes its own call. */
  const applyOffline = (text: string, src: 'local' | 'fallback') => {
    const c = ctx();
    applyResolvedNow(parseNote(text, deps.getData(), c), src);
  };

  const restoreDraft = (text: string, o: RunOpts) => {
    set({ phase: 'idle', draft: o.followUp || state.draft.trim() ? state.draft : text });
  };

  const fail = (err: AiError, o: RunOpts) => {
    if (err.usage) deps.recordUsage(err.usage);
    switch (err.kind) {
      case 'limit': {
        const reset = err.usage ? formatResetDate(err.usage.resetsOn) : 'next month';
        if (o.goal) {
          deps.toast({ label: 'Monthly notes used · goal adjustments are back on ' + reset });
          set({ phase: 'idle', fellBack: true });
          return;
        }
        set({ fellBack: true });
        deps.toast({ label: 'Monthly notes used · using offline parsing until ' + reset });
        applyOffline(o.base, 'fallback');
        return;
      }
      case 'rate_limit':
        deps.toast({ label: 'Too many notes at once · try again in ' + (err.retryAfter ?? 10) + 's' });
        restoreDraft(o.base, o);
        return;
      case 'bad_reply':
        deps.toast({ label: 'Claude returned nothing usable — try rewording' });
        restoreDraft(o.base, o);
        return;
      case 'bad_request':
        deps.toast({ label: 'That note couldn’t be sent — try something shorter' });
        restoreDraft(o.base, o);
        return;
      default: {
        if (o.goal) {
          deps.toast({ label: err.kind === 'offline' ? 'Goal adjustments need a connection' : 'Claude is unavailable right now — try again shortly' });
          set({ phase: 'idle', fellBack: true });
          return;
        }
        set({ fellBack: true });
        applyOffline(o.base, 'fallback');
      }
    }
  };

  /** One round trip to the model, then resolve and apply (or open the questions). */
  const run = async (text: string, o: RunOpts) => {
    const mine = ++token;
    const prefs = deps.getPrefs();
    const askOn = prefs.ai.ask;
    const noAsk = !!o.noAsk || (!o.goal && !askOn);
    const n = deps.now();
    const req: AiRequest = o.goal
      ? { mode: 'adjust', note: text, goalId: o.goal.id, adjustMode: o.goal.mode, noAsk, today: key(n.today), nowMin: n.nowMin, tz: deps.tz(), data: deps.getData() }
      : { mode: 'note', note: text, noAsk, today: key(n.today), nowMin: n.nowMin, tz: deps.tz(), data: deps.getData() };

    let res: AiSuccess | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await deps.call(req);
      } catch (e) {
        if (mine !== token) return;
        const err = e instanceof AiError ? e : new AiError('unknown', e instanceof Error ? e.message : String(e));
        if (err.kind === 'rate_limit' && attempt === 0 && (err.retryAfter ?? 10) <= RETRY_MAX_S) {
          if (err.usage) deps.recordUsage(err.usage);
          await deps.sleep((err.retryAfter ?? 10) * 1000);
          if (mine !== token) return;
          continue;
        }
        fail(err, o);
        return;
      }
    }
    if (!res || mine !== token) return;
    deps.recordUsage(res.usage, res.model);

    let r: ReturnType<typeof interpretReply>;
    try {
      r = interpretReply(res.ops, deps.getData(), ctx(), { noAsk, askOn, goalAdjust: !!o.goal });
    } catch {
      deps.toast({ label: 'Claude returned nothing usable — try rewording' });
      restoreDraft(o.base, o);
      return;
    }
    set({ fellBack: false });
    if ('asks' in r) {
      round++;
      const pre = !!r.rest && !isEmptyResolved(r.rest);
      if (pre && r.rest) applyResolvedNow(r.rest, 'claude');
      set({
        phase: 'asking', draft: '',
        ask: openAsk({
          qs: r.asks, goalId: o.goal?.id ?? null,
          note: pre ? text + '\n\n(The operations from your previous reply are already applied. Do not repeat them.)' : text,
        }),
      });
      return;
    }
    applyResolvedNow(r, 'claude');
  };

  const think = (query: string) => set({ phase: 'thinking', query, seq: state.seq + 1 });

  const resolveAsk = async () => {
    const s = state.ask;
    if (!s) return;
    await deps.sleep(ASK_EXIT_MS);
    if (!state.ask || !state.ask.closing) return;
    const note = followUpNote(s);
    set({ ask: null });
    think(base);
    await run(note, { noAsk: round >= MAX_ASK_ROUNDS, goal, base });
  };

  const self: Composer = {
    getState: () => state,
    subscribe(l) {
      subs.add(l);
      return () => {
        subs.delete(l);
      };
    },
    setDraft: (t) => set({ draft: t }),

    send() {
      const text = state.draft.trim();
      if (state.ask && text) {
        set({ draft: '' });
        self.answerAsk(text);
        return;
      }
      if (!text || state.phase === 'thinking') return;
      if (isRecapCommand(text)) {
        set({ draft: '' });
        deps.openRecap();
        return;
      }
      round = 0;
      goal = null;
      base = text;
      set({ draft: '' });
      think(text);
      if (deps.getPrefs().ai.on) {
        void run(text, { base: text });
      } else {
        const mine = ++token;
        void deps.sleep(OFFLINE_THINK_MS).then(() => {
          if (mine === token) applyOffline(text, 'local');
        });
      }
    },

    startGoalAdjust(goalId, mode) {
      if (state.phase !== 'idle') return;
      if (!deps.getPrefs().ai.on) {
        deps.toast({ label: 'Turn on Claude in settings to adjust goals' });
        return;
      }
      const g = deps.getData().goals.find((x) => x.id === goalId);
      if (!g) return;
      const text = adjustNote(g.title, mode === 'stretch' ? 'stretch' : 'reduce');
      round = 0;
      goal = { id: g.id, mode };
      base = text;
      think(text);
      void run(text, { goal, base: text });
    },

    submitCheckInAnswers(note, plain) {
      goal = null;
      round = 0;
      base = plain.join('\n');
      think(base);
      if (deps.getPrefs().ai.on) {
        void run(note, { noAsk: true, base, followUp: true });
      } else {
        const mine = ++token;
        void deps.sleep(500).then(() => {
          if (mine === token) applyOffline(base, 'local');
        });
      }
    },

    answerAsk(label) {
      const s = state.ask;
      if (!s || s.pick || s.closing) return;
      set({ ask: pickAnswer(s, label) });
      void deps.sleep(PICK_MS).then(async () => {
        const cur = state.ask;
        if (!cur || !cur.pick) return;
        const { state: next, done } = settle(cur);
        set({ ask: next });
        if (done) await resolveAsk();
      });
    },

    backAsk() {
      if (state.ask) set({ ask: askBack(state.ask) });
    },

    skipAsk() {
      const s = state.ask;
      if (!s) return;
      const { state: next, done } = askSkip(s);
      set({ ask: next });
      if (done) void resolveAsk();
    },

    closeAsk() {
      const s = state.ask;
      if (!s || s.closing) return;
      set({ ask: { ...s, closing: true } });
      void deps.sleep(ASK_EXIT_MS).then(() => {
        if (state.ask?.closing) set({ ask: null, phase: 'idle' });
      });
    },

    moveAskHighlight(d) {
      if (state.ask) set({ ask: moveHighlight(state.ask, d) });
    },
    hoverAsk(i) {
      if (state.ask) set({ ask: setHighlight(state.ask, i) });
    },

    askKey(k) {
      const s = state.ask;
      if (!s) return false;
      const intent = keyIntent(s, k);
      if (!intent) return false;
      if (intent.type === 'pick') self.answerAsk(intent.label);
      else if (intent.type === 'move') self.moveAskHighlight(intent.d);
      else self.closeAsk();
      return true;
    },
  };
  return self;
}

/**
 * Ask `ai-schedule` for check-in questions (mode `checkin`). Resolves null on any failure (offline,
 * limit, provider) or an empty reply: the caller then uses the local questions.
 */
export async function fetchCheckInQuestions(
  deps: Pick<ComposerDeps, 'getData' | 'now' | 'tz' | 'call' | 'recordUsage'>, lastSeen: number,
): Promise<CheckInQuestion[] | null> {
  const n = deps.now();
  try {
    const res = await deps.call({
      mode: 'checkin', today: key(n.today), nowMin: n.nowMin, tz: deps.tz(), data: deps.getData(), lastSeen,
    });
    deps.recordUsage(res.usage, res.model);
    const qs = normCheckIn(res.ops.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object'));
    return qs.length ? qs : null;
  } catch (e) {
    if (e instanceof AiError && e.usage) deps.recordUsage(e.usage);
    return null;
  }
}
