import { describe, expect, it } from 'vitest';
import { finishTimer, pauseTimer, resumeTimer, startTimer, tickTimer, timerInfo, workedMins } from '../src/index.ts';
import type { TimerState } from '../src/index.ts';
import { NOW_MS, TODAY_KEY, ev } from './helpers.ts';

const MIN = 60000;
const dayStart = new Date(2026, 9, 30).getTime();
const at = (m: number) => dayStart + m * MIN;

describe('workedMins', () => {
  const e = ev('e1', TODAY_KEY, 'Work', 'Block', 540, 660); // 09:00-11:00
  it('is the event length', () => expect(workedMins(e)).toBe(120));
  it('subtracts stored pauses', () => expect(workedMins({ ...e, pauses: [[560, 570], [600, 615]] })).toBe(95));
  it('clamps pauses to the event', () => expect(workedMins({ ...e, pauses: [[500, 560]] })).toBe(100));
  it('upto limits the end, clamped to the event', () => {
    expect(workedMins(e, 600)).toBe(60);
    expect(workedMins(e, 100)).toBe(0);
    expect(workedMins(e, 9999)).toBe(120);
  });
  it('a running timer only counts up to now', () => {
    const tm: TimerState = { id: 'e1', endMs: at(660), total: 7200000, evEnd: 660, evDay: TODAY_KEY, rang: false, paused: false, rem: 0 };
    expect(workedMins(e, null, { tm, tmNow: at(570) })).toBe(30);
    expect(workedMins(e, null, { tm, nowMs: at(600) })).toBe(60);
    expect(workedMins(e, null, { tm: { ...tm, id: 'other' }, tmNow: at(570) })).toBe(120);
  });
  it('a paused timer excludes the pause in progress', () => {
    const tm: TimerState = { id: 'e1', endMs: at(660), total: 7200000, evEnd: 660, evDay: TODAY_KEY, rang: false, paused: true, rem: 3600000, pStart: 580 };
    // now is 10:00 (600), paused since 9:40: worked = (600-540) - (600-580) = 40
    expect(workedMins(e, null, { tm, tmNow: at(600) })).toBe(40);
  });
});

describe('timer transitions', () => {
  it('starting an upcoming event moves it to now and keeps its length', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Later', 900, 960);
    const { tm, patch } = startTimer(e, NOW_MS, TODAY_KEY); // 14:20
    expect(patch).toEqual({ start: 860, end: 920 });
    expect(tm).toMatchObject({ id: 'e1', endMs: NOW_MS + 60 * MIN, total: 60 * MIN, evEnd: 920, paused: false, rang: false });
  });
  it('starting an event already under way keeps its times', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm, patch } = startTimer(e, NOW_MS, TODAY_KEY);
    expect(patch).toEqual({ start: 800, end: 900 });
    expect(tm.endMs).toBe(at(900));
  });
  it('pause then resume records the pause', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    const p = pauseTimer(tm, e, at(850));
    expect(p).toMatchObject({ paused: true, rem: 50 * MIN, pStart: 850 });
    expect(pauseTimer(p, e, at(851))).toBe(p);
    const r = resumeTimer(p, e, at(860))!;
    expect(r.pauses).toEqual([[850, 860]]);
    expect(r.tm).toMatchObject({ paused: false, pStart: null, endMs: at(860) + 50 * MIN });
    expect(resumeTimer(tm, e, at(860))).toBeNull();
  });
  it('a sub-3-second pause is not recorded', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    const p = pauseTimer(tm, e, at(850));
    expect(resumeTimer(p, e, at(850) + 1000)!.pauses).toEqual([]);
  });
  it('finish cuts the event at the stop point and marks it done', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    expect(finishTimer(tm, e, at(871.4))).toEqual({ done: true, end: 871 });
    expect(finishTimer(tm, e, at(800))).toEqual({ done: true, end: 801 }); // never shorter than a minute
    const paused = pauseTimer(tm, e, at(860));
    expect(finishTimer(paused, e, at(880))).toEqual({ done: true, end: 860 });
  });
  it('tick: idle, ring once at the end, then extend while overrunning', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    expect(tickTimer(tm, e, at(860)).kind).toBe('idle');
    const r1 = tickTimer(tm, e, at(900)) as Extract<ReturnType<typeof tickTimer>, { kind: 'update' }>;
    expect(r1.kind).toBe('update');
    expect(r1.ding).toBe(true);
    expect(r1.tm.rang).toBe(true);
    expect(r1.evPatch).toBeNull();
    const r2 = tickTimer(r1.tm, e, at(903.5)) as Extract<ReturnType<typeof tickTimer>, { kind: 'update' }>;
    expect(r2.ding).toBe(false);
    expect(r2.evPatch).toEqual({ end: 904 });
    expect(r2.tm.evEnd).toBe(904);
  });
  it('tick follows an edit of the event end', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    const r = tickTimer(tm, { ...e, end: 960 }, at(855)) as Extract<ReturnType<typeof tickTimer>, { kind: 'update' }>;
    expect(r.tm.evEnd).toBe(960);
    expect(r.tm.endMs).toBe(at(960));
    expect(r.tm.total).toBe(tm.total + 60 * MIN);
  });
  it('tick while paused finishes once the clock passes the event end', () => {
    const e = ev('e1', TODAY_KEY, 'Work', 'Now', 800, 900);
    const { tm } = startTimer(e, at(850), TODAY_KEY);
    const p = pauseTimer(tm, e, at(850));
    expect(tickTimer(p, e, at(880)).kind).toBe('idle');
    expect(tickTimer(p, e, at(900)).kind).toBe('finish');
  });
});

describe('timerInfo', () => {
  const base: TimerState = { id: 'e', endMs: 10 * 60 * MIN, total: 0, evEnd: 0, evDay: 'x', rang: false, paused: false, rem: 0 };
  it('counts down as m:ss, h:mm:ss, then overruns with a plus', () => {
    expect(timerInfo(base, base.endMs - 125 * 1000).txt).toBe('2:05');
    expect(timerInfo(base, base.endMs - 3725 * 1000).txt).toBe('1:02:05');
    expect(timerInfo(base, base.endMs + 61 * 1000)).toMatchObject({ over: true, txt: '+1:01' });
  });
  it('paused shows the stored remaining time', () => expect(timerInfo({ ...base, paused: true, rem: 90000 }, 0).txt).toBe('1:30'));
});
