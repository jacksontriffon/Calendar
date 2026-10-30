/**
 * The ask flow as pure transitions (the prototype's `openAsk` / `answerAsk` / `backAsk` / `skipAsk` /
 * `resolveAsk` / `askKey`). The scheduler may reply with up to two multiple-choice questions;
 * they are shown one at a time, and the answers are sent back with the original note.
 *
 * Timing (the 190 ms "picked" beat before moving on, the 200 ms exit) belongs to the caller: it
 * calls `pickAnswer`, waits, then `settle`.
 */
import type { Ask } from '@calendar/core';

export interface AskState {
  qs: Ask[];
  /** the question showing */
  idx: number;
  /** answer per question (undefined = unanswered) */
  ans: (string | undefined)[];
  /** the label just picked, while the row animates; blocks further input */
  pick: string | null;
  /** keyboard highlight within the options */
  hi: number;
  /** slide direction of the last move: 1 forward, -1 back */
  dir: 1 | -1;
  /** exit animation running; blocks further input */
  closing: boolean;
  /** the note being clarified: it is re-sent with the answers */
  note: string;
  /** set when the questions come from a goal adjustment (the sheet shows the goal) */
  goalId: string | null;
}

export function openAsk(o: { qs: Ask[]; note: string; goalId?: string | null }): AskState {
  return { qs: o.qs, idx: 0, ans: [], pick: null, hi: 0, dir: 1, closing: false, note: o.note, goalId: o.goalId ?? null };
}

/** Choose an option (or a typed answer) for the current question. Ignored while a pick or the exit is running. */
export function pickAnswer(s: AskState, label: string): AskState {
  if (s.pick || s.closing) return s;
  const ans = s.ans.slice();
  ans[s.idx] = label;
  return { ...s, ans, pick: label };
}

/**
 * After a pick: move to the next question, or, past the last one, start closing and report `done`
 * (the caller then sends the answers).
 */
export function settle(s: AskState): { state: AskState; done: boolean } {
  if (s.idx + 1 < s.qs.length) return { state: { ...s, idx: s.idx + 1, hi: 0, dir: 1, pick: null }, done: false };
  return { state: { ...s, pick: null, closing: true }, done: true };
}

export function back(s: AskState): AskState {
  if (s.idx <= 0 || s.pick || s.closing) return s;
  return { ...s, idx: s.idx - 1, hi: 0, dir: -1 };
}

/** Skip resolves with whatever has been answered so far (unanswered ones become "you decide"). */
export function skip(s: AskState): { state: AskState; done: boolean } {
  if (s.closing) return { state: s, done: false };
  return { state: { ...s, closing: true, pick: null }, done: true };
}

export function moveHighlight(s: AskState, d: 1 | -1): AskState {
  const n = s.qs[s.idx]?.options.length ?? 0;
  if (!n || s.pick || s.closing) return s;
  return { ...s, hi: (s.hi + d + n) % n };
}

export function setHighlight(s: AskState, i: number): AskState {
  return s.pick || s.closing || s.hi === i ? s : { ...s, hi: i };
}

/** `- <question> → <answer>` for each question; an unanswered one reads "you decide". */
export const answerLines = (s: AskState): string[] => s.qs.map((q, i) => '- ' + q.q + ' → ' + (s.ans[i] || 'you decide'));

/** The note to send back to the scheduler once the questions are answered. */
export const followUpNote = (s: AskState): string => s.note + '\n\nAnswers to your questions:\n' + answerLines(s).join('\n');

export type AskKeyIntent =
  | { type: 'pick'; label: string }
  | { type: 'move'; d: 1 | -1 }
  | { type: 'close' };

/**
 * What a key press means while the sheet is open and no text field has focus: arrows move the
 * highlight, Enter picks it, 1-9 pick that option, Escape dismisses.
 */
export function keyIntent(s: AskState, key: string): AskKeyIntent | null {
  const opts = s.qs[s.idx]?.options ?? [];
  if (key === 'ArrowDown') return { type: 'move', d: 1 };
  if (key === 'ArrowUp') return { type: 'move', d: -1 };
  if (key === 'Escape') return { type: 'close' };
  if (key === 'Enter') {
    const o = opts[s.hi];
    return o ? { type: 'pick', label: o.label } : null;
  }
  if (/^[1-9]$/.test(key)) {
    const o = opts[Number(key) - 1];
    return o ? { type: 'pick', label: o.label } : null;
  }
  return null;
}
