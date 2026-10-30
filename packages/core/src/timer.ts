/**
 * Event timer maths: how much of an event counts as worked time (pauses, a
 * running timer) and the timer's state transitions as pure functions.
 * The caller owns the clock and passes epoch ms.
 */
import { clamp, dayMs, minsIn, pad } from './time.ts';
import type { Pause, ProtoEvent, TimerState } from './model.ts';

/** The running-timer context goal maths needs. All optional: no timer, no clock. */
export interface TimerCtx {
  tm?: TimerState | null;
  /** epoch ms of the last timer tick */
  tmNow?: number;
  /** epoch ms "now", used when `tmNow` is not set */
  nowMs?: number;
}

export const isTiming = (e: { id: string }, t?: TimerCtx | null): boolean => !!(t && t.tm) && t!.tm!.id === e.id;

/** Stored pauses plus the one in progress, if this event's timer is paused. */
export const livePauses = (e: ProtoEvent, t?: TimerCtx | null): Pause[] => {
  const ps = (e.pauses || []).slice();
  const tm = t && t.tm;
  if (t && tm && tm.paused && tm.id === e.id && tm.pStart != null) ps.push([tm.pStart, minsIn(e.day, t.tmNow || t.nowMs || 0)]);
  return ps;
};

/**
 * Minutes of an event that count as worked: its length minus pauses. A
 * running timer only counts time up to now; `upto` (minutes past the start-day
 * midnight) overrides that.
 */
export const workedMins = (e: ProtoEvent, upto?: number | null, t?: TimerCtx | null): number => {
  if (upto == null && t && t.tm && t.tm.id === e.id) upto = minsIn(e.day, t.tmNow || t.nowMs || 0);
  const s0 = e.start || 0;
  const e0 = upto == null ? (e.end || 0) : clamp(upto, s0, e.end || 0);
  let m = Math.max(0, e0 - s0);
  livePauses(e, t).forEach((p) => {
    const x = Math.max(p[0], s0);
    const y = Math.min(p[1], e0);
    if (y > x) m -= y - x;
  });
  return Math.max(0, m);
};

/** Display info for the timer pill: remaining ms, whether it overran, and "m:ss" / "+m:ss" / "h:mm:ss" text. */
export const timerInfo = (tm: TimerState, tmNow: number): { rem: number; over: boolean; txt: string } => {
  const rem = tm.paused ? tm.rem : tm.endMs - tmNow;
  const over = rem < 0;
  const s = over ? Math.floor(-rem / 1000) : Math.ceil(rem / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return { rem, over, txt: (over ? '+' : '') + (h ? h + ':' + pad(m) : m) + ':' + pad(x) };
};

/**
 * Start timing an event. An upcoming event moves to start now and keeps its
 * length. Returns the new timer and the start/end patch for the event.
 */
export const startTimer = (ev: ProtoEvent, nowMs: number, todayKey: string): { tm: TimerState; patch: { start: number; end: number } } => {
  const m = Math.round(minsIn(todayKey, nowMs));
  let start = ev.start, end = ev.end, endMs: number;
  if (ev.start > m) {
    const len = ev.end - ev.start;
    start = m; end = m + len; endMs = nowMs + len * 60000;
  } else endMs = dayMs(ev.day) + ev.end * 60000;
  const tm: TimerState = { id: ev.id, endMs, total: (end - start) * 60000, evEnd: end, evDay: ev.day, rang: false, paused: false, rem: 0, open: true };
  return { tm, patch: { start, end } };
};

/** Pause a running timer (no-op if already paused). */
export const pauseTimer = (tm: TimerState, ev: ProtoEvent, nowMs: number): TimerState =>
  tm.paused ? tm : Object.assign({}, tm, { paused: true, rem: tm.endMs - nowMs, pStart: +minsIn(ev.day, nowMs).toFixed(2) });

/** Resume a paused timer. Returns the new timer and the event's pauses with the finished one appended. */
export const resumeTimer = (tm: TimerState, ev: ProtoEvent, nowMs: number): { tm: TimerState; pauses: Pause[] } | null => {
  if (!tm.paused) return null;
  const pe = +minsIn(ev.day, nowMs).toFixed(2);
  const ps = tm.pStart as number;
  const pauses = (ev.pauses || []).concat(pe - ps >= 0.05 ? [[ps, pe] as Pause] : []);
  return {
    tm: Object.assign({}, tm, { paused: false, pStart: null, endMs: nowMs + tm.rem, evEnd: ev.end, evDay: ev.day }),
    pauses,
  };
};

/** Patch that finishes a timed event: marks it done and cuts its end at the stop point. */
export const finishTimer = (tm: TimerState, ev: ProtoEvent, nowMs: number): { done: true; end: number } => ({
  done: true,
  end: Math.max(ev.start + 1, Math.round(tm.paused ? (tm.pStart as number) : minsIn(ev.day, nowMs))),
});

export type TickResult =
  | { kind: 'finish' }
  | { kind: 'idle' }
  | { kind: 'update'; tm: TimerState; evPatch: { end: number } | null; ding: boolean };

/**
 * One timer tick. While paused, the timer finishes once the clock passes the
 * event's end. While running it follows edits/drags of the event, rings once at
 * the end and then extends the event as time overruns.
 */
export const tickTimer = (tm: TimerState, ev: ProtoEvent, nowMs: number): TickResult => {
  if (tm.paused) return minsIn(ev.day, nowMs) >= ev.end ? { kind: 'finish' } : { kind: 'idle' };
  let t = tm;
  let evPatch: { end: number } | null = null;
  let ding = false;
  if (ev.end !== t.evEnd || ev.day !== t.evDay) {
    const endMs = dayMs(ev.day) + ev.end * 60000;
    t = Object.assign({}, t, { endMs, total: Math.max(60000, t.total + endMs - t.endMs), evEnd: ev.end, evDay: ev.day, rang: endMs > nowMs ? false : t.rang });
  }
  if (nowMs >= t.endMs && !t.rang) { ding = true; t = Object.assign({}, t, { rang: true }); }
  if (nowMs > t.endMs) {
    const cur = Math.ceil(minsIn(ev.day, nowMs));
    if (cur > ev.end) { evPatch = { end: cur }; t = Object.assign({}, t, { evEnd: cur }); }
  }
  if (t === tm) return { kind: 'idle' };
  return { kind: 'update', tm: t, evPatch, ding };
};
