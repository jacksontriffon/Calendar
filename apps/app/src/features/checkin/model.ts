/**
 * Check-in flow state as pure transitions over core's questions: answer, go
 * back, skip, and the final "apply". The AI-written questions arrive in phase
 * 4; until then the local ones (`ciLocalQs`) feed `assembleCheckIn`.
 */
import {
  applyCheckIn, assembleCheckIn, ciLocalQs, shouldCheckIn, winCands,
  type CalendarData, type CheckInQuestion, type CheckInResult,
} from '@calendar/core';

export interface Flow {
  qs: CheckInQuestion[];
  idx: number;
  ans: (string | undefined)[];
}

export interface Clock { today: Date; nowMin: number; nowMs: number }

/** Questions for a check-in right now (without AI): local signals merged with wins and confirmations. */
export function buildQuestions(data: CalendarData, clock: Clock, lastSeen: number): CheckInQuestion[] {
  return assembleCheckIn(ciLocalQs(data, { today: clock.today, nowMin: clock.nowMin, nowMs: clock.nowMs }), {
    events: data.events, goals: data.goals, today: clock.today, nowMs: clock.nowMs, lastSeen,
  });
}

export const startFlow = (qs: CheckInQuestion[]): Flow => ({ qs, idx: 0, ans: [] });

export const isLast = (f: Flow): boolean => f.idx >= f.qs.length - 1;

/** Record an answer (empty = skipped) and move on; `done` once the last question is answered. */
export function answer(f: Flow, a: string): { flow: Flow; done: boolean } {
  const ans = f.ans.slice();
  ans[f.idx] = a.trim() || undefined;
  const done = isLast(f);
  return { flow: { ...f, ans, idx: done ? f.idx : f.idx + 1 }, done };
}

export const back = (f: Flow): Flow => ({ ...f, idx: Math.max(0, f.idx - 1) });

export const stepLabel = (f: Flow): string => (f.qs.length > 1 ? f.idx + 1 + ' of ' + f.qs.length : '');

/** Apply a finished flow to the data (marks done, logs wins, books goal hours). */
export function finish(data: CalendarData, f: Flow, clock: Clock, nextId: () => string): CheckInResult {
  return applyCheckIn(data, f.qs, f.ans, { today: clock.today, nowMin: clock.nowMin, nowMs: clock.nowMs, nextId });
}

/** Whether a check-in should open on its own now (the prototype's `maybeCheckIn`). */
export function shouldOpen(o: {
  enabled: boolean; eodOnly: boolean; data: CalendarData; clock: Clock; lastCheckIn: number; lastWinDay: string;
}): boolean {
  return shouldCheckIn({
    enabled: o.enabled, eodOnly: o.eodOnly, nowMs: o.clock.nowMs, nowMin: o.clock.nowMin, today: o.clock.today,
    lastCheckIn: o.lastCheckIn, lastWinDay: o.lastWinDay,
    winCount: winCands(o.data.events, o.data.goals, o.clock.today, o.clock.nowMs).length,
  });
}
