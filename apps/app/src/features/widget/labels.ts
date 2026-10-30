/**
 * Text the widgets show, from the snapshot's numbers. Pure, so the Android
 * widget uses it directly and the Swift extension (`Snapshot.swift`) mirrors
 * it; the tests pin every string to the Design Spec frames.
 *
 * Time maths is always done at draw time from `s` / `e`, never stored.
 */
import { DOW, MON, dur, fmtDur, pad } from '@calendar/core';

import type { Clock, SnapshotGoal } from './types';

const DAY_MS = 86400000;

/* ---------- floating local times ---------- */

/** `YYYY-MM-DDTHH:mm` (floating local) -> Date. Null when malformed. */
export function parseLocal(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** Date -> `YYYY-MM-DDTHH:mm` from local components. */
export function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date -> `YYYY-MM-DD` from local components. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` -> local midnight. */
export function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN);
}

/* ---------- clock ---------- */

/** Minutes past midnight -> "9am", "12:30pm" (12h) or "09:00", "12:30" (24h). */
export function fmtClock(min: number, clock: Clock): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (clock === '24h') return `${pad(h)}:${pad(mm)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? ':' + pad(mm) : ''}${h >= 12 ? 'pm' : 'am'}`;
}

/** The clock on the now line and in "Now 11:48 · 6 left": no am/pm in 12h (the spec), HH:mm in 24h. */
export function fmtNow(min: number, clock: Clock): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = pad(m % 60);
  return clock === '24h' ? `${pad(h)}:${mm}` : `${h % 12 === 0 ? 12 : h % 12}:${mm}`;
}

const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** "12:30pm" for a Date. */
export const fmtTime = (d: Date, clock: Clock): string => fmtClock(minOfDay(d), clock);

/**
 * "12:30–1:15pm", "9–11:30am", "11am–12:30pm" (12h, the first am/pm is dropped
 * when both ends share it) or "12:30–13:15" (24h).
 */
export function fmtRange(s: Date, e: Date, clock: Clock): string {
  const a = minOfDay(s);
  const b = minOfDay(e);
  if (clock === '24h') return `${fmtClock(a, clock)}–${fmtClock(b, clock)}`;
  const A = fmtClock(a, clock);
  const B = fmtClock(b, clock);
  const sameHalf = A.slice(-2) === B.slice(-2);
  return `${sameHalf ? A.slice(0, -2) : A}–${B}`;
}

/** "Fri 30 Oct". */
export const dayLabel = (d: Date): string => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;

/** "Mon 9am" for the empty day's "Next:" line: weekday and start time. */
export const nextWhenLabel = (d: Date, clock: Clock): string => `${DOW[d.getDay()]} ${fmtTime(d, clock)}`;

/* ---------- goals ---------- */

/** Fraction of today's share done, 0..1 (a goal with no need today is full). Same as core `goalToday().ring`. */
export const ringOf = (todayNeed: number, todayDone: number): number => {
  if (!(todayNeed > 0)) return 1;
  return Math.max(0, Math.min(1, todayDone / todayNeed));
};

/** Less than a minute left today. */
export const doneToday = (todayNeed: number, todayDone: number): boolean => Math.max(0, todayNeed - todayDone) < 1 / 60;

/** "45m left today" / "Done today" (core `goalToday().label`). */
export function leftTodayLabel(todayNeed: number, todayDone: number): string {
  if (doneToday(todayNeed, todayDone)) return 'Done today';
  return fmtDur(Math.round(Math.max(0, todayNeed - todayDone) * 60)) + ' left today';
}

/** "73h left" / "10.5h left" / "45m left" (core `dur` of hours minus done). */
export const totalLeftLabel = (g: Pick<SnapshotGoal, 'hours' | 'done'>): string => dur(Math.max(0, g.hours - g.done)) + ' left';

export interface GoalSpan {
  total: number;
  elapsed: number;
  daysLeft: number;
  active: boolean;
  ended: boolean;
}

/** The goal's span at `today` (local midnight): same maths as core `goalStats`. */
export function goalSpanAt(g: Pick<SnapshotGoal, 'start' | 'deadline'>, today: Date): GoalSpan {
  const s0 = parseDay(g.start);
  const last = parseDay(g.deadline);
  const s1 = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  const total = Math.max(1, Math.round((s1.getTime() - s0.getTime()) / DAY_MS));
  const t = today.getTime();
  const elapsed = Math.max(0, Math.min(total, Math.round((t - s0.getTime()) / DAY_MS)));
  const active = t >= s0.getTime() && t < s1.getTime();
  return { total, elapsed, daysLeft: Math.max(0, total - elapsed), active, ended: !active && t >= s1.getTime() };
}

/** "9 weeks left" (14+ days) / "13 days left" / "1 day left" / "Ended" (core `leftShortLabel`). */
export function deadlineLabel(g: Pick<SnapshotGoal, 'start' | 'deadline'>, today: Date): string {
  const s = goalSpanAt(g, today);
  if (s.ended) return 'Ended';
  return s.daysLeft >= 14 ? Math.round(s.daysLeft / 7) + ' weeks left' : s.daysLeft + (s.daysLeft === 1 ? ' day left' : ' days left');
}

/* ---------- agenda ---------- */

/** "in 42 min" / "in 1h 5m". `mins` is whole minutes until the start. */
export const inLabel = (mins: number): string => 'in ' + (mins < 60 ? Math.max(1, Math.round(mins)) + ' min' : fmtDur(Math.round(mins)));

/** "Ends in 25 min" / "Ends in 1h 5m". */
export const endsInLabel = (mins: number): string => 'Ends in ' + (mins < 60 ? Math.max(1, Math.round(mins)) + ' min' : fmtDur(Math.round(mins)));

/** The number in "25 min left" (Small, running event). */
export const leftMinLabel = (mins: number): string => (mins < 60 ? Math.max(1, Math.round(mins)) + ' min' : fmtDur(Math.round(mins)));

/* ---------- stale ---------- */

export type StaleLevel = 'fresh' | 'stale' | 'old';

/** Under 30 min: fresh. 30 min to 24 h: stale ("Updated 3h ago"). Over 24 h: old (rings dim, "Open Calendar to refresh"). */
export function staleLevel(ageMs: number): StaleLevel {
  if (ageMs < 30 * 60000) return 'fresh';
  if (ageMs <= DAY_MS) return 'stale';
  return 'old';
}

/** "45m" / "3h" / "2d": how old, without the words around it. */
export function ageShort(ageMs: number): string {
  const min = Math.floor(ageMs / 60000);
  if (min < 60) return `${Math.max(1, min)}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** "Updated 45m ago" / "Updated 3h ago" / "Updated 2d ago". */
export function staleLabel(ageMs: number): string {
  const min = Math.floor(ageMs / 60000);
  if (min < 60) return `Updated ${Math.max(1, min)}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Updated ${h}h ago`;
  return `Updated ${Math.floor(h / 24)}d ago`;
}
