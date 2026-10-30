/**
 * The running event timer. Like the prototype's `tm` it is device-local state
 * (never synced); the event it times lives in the calendar store, where the
 * timer writes its start shift, pauses and finish through `commit`.
 * All the maths is core `timer.ts`.
 */
import { useSyncExternalStore } from 'react';
import {
  editEvent, finishTimer as coreFinish, key, pauseTimer as corePause, resumeTimer as coreResume,
  startTimer as coreStart, tickTimer,
  type CalendarData, type ProtoEvent, type TimerState,
} from '@calendar/core';

import { showToast } from '@/components/toast';
import { getStore } from '@/store';
import { deviceGet, deviceSet } from '../checkin/state';

export interface TimerSlice {
  tm: TimerState | null;
  /** epoch ms of the last tick, drives the countdown text */
  tmNow: number;
}

const KEY = 'aical.timer.v1';

function load(): TimerState | null {
  try {
    const t = JSON.parse(deviceGet(KEY) || 'null');
    return t && t.id && typeof t.endMs === 'number' ? (t as TimerState) : null;
  } catch {
    return null;
  }
}

let slice: TimerSlice = { tm: load(), tmNow: Date.now() };
const listeners = new Set<() => void>();

function set(next: Partial<TimerSlice>): void {
  slice = { ...slice, ...next };
  if ('tm' in next) deviceSet(KEY, JSON.stringify(slice.tm));
  listeners.forEach((l) => l());
}

export const getTimer = (): TimerSlice => slice;
export const subscribeTimer = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useTimer = (): TimerSlice => useSyncExternalStore(subscribeTimer, getTimer, getTimer);

const dataOf = (): CalendarData => getStore().getState().data;
const eventOf = (id: string): ProtoEvent | undefined => dataOf().events.find((e) => e.id === id);

/** Start timing an event (or reopen its running timer). An upcoming event moves to start now. */
export function startTimer(evId: string): void {
  const ev = eventOf(evId);
  if (!ev) return;
  const now = Date.now();
  if (slice.tm && slice.tm.id === ev.id) {
    set({ tm: { ...slice.tm, open: true } });
    return;
  }
  if (slice.tm) finishTimer(true);
  const { tm, patch } = coreStart(ev, now, key(new Date()));
  getStore().commit(editEvent(dataOf(), ev.id, patch), 'Timer · ' + ev.title, 'edit');
  set({ tm, tmNow: now });
}

export function pauseTimer(): void {
  const { tm } = slice;
  if (!tm || tm.paused) return;
  const ev = eventOf(tm.id);
  if (!ev) return;
  const now = Date.now();
  set({ tm: corePause(tm, ev, now), tmNow: now });
}

export function resumeTimer(): void {
  const { tm } = slice;
  if (!tm || !tm.paused) return;
  const ev = eventOf(tm.id);
  if (!ev) return;
  const now = Date.now();
  const r = coreResume(tm, ev, now);
  if (!r) return;
  getStore().commit(editEvent(dataOf(), ev.id, { pauses: r.pauses }), 'Resumed · ' + ev.title, 'edit');
  set({ tm: r.tm, tmNow: now });
}

/** Mark the timed event done, cutting its end at the stop point. */
export function finishTimer(silent = false): void {
  const { tm } = slice;
  if (!tm) return;
  const ev = eventOf(tm.id);
  const now = Date.now();
  set({ tm: null });
  if (!ev) return;
  getStore().commit(editEvent(dataOf(), ev.id, coreFinish(tm, ev, now)), 'Finished · ' + ev.title, 'edit');
  if (!silent) {
    const head = getStore().getState().history[0];
    showToast({ label: 'Finished · ' + ev.title, undoId: head ? head.id : null });
  }
}

export const closeTimer = (): void => {
  if (slice.tm) set({ tm: { ...slice.tm, open: false } });
};
export const openTimer = (): void => {
  if (slice.tm) set({ tm: { ...slice.tm, open: true } });
};

/** Last minute an overrun was written back to the event, to keep History from filling up. */
let lastExtend = 0;

/** One 500 ms tick: follows edits of the event, rings once at the end, extends it as time overruns. */
export function tickTimerNow(onDing?: () => void): void {
  const { tm } = slice;
  const now = Date.now();
  if (!tm) return;
  const ev = eventOf(tm.id);
  if (!ev) {
    set({ tm: null });
    return;
  }
  const r = tickTimer(tm, ev, now);
  if (r.kind === 'finish') {
    finishTimer();
    return;
  }
  if (r.kind === 'idle') {
    set({ tmNow: now });
    return;
  }
  if (r.ding) onDing?.();
  if (r.evPatch) {
    /* write the overrun back at most once a minute (every write is a History entry) */
    if (now - lastExtend >= 60000) {
      lastExtend = now;
      getStore().commit(editEvent(dataOf(), ev.id, r.evPatch), 'Timer extended · ' + ev.title, 'sync');
    } else {
      set({ tmNow: now });
      return;
    }
  }
  set({ tm: r.tm, tmNow: now });
}

/** Test hook. */
export const __resetTimer = (): void => {
  slice = { tm: null, tmNow: Date.now() };
  lastExtend = 0;
};
