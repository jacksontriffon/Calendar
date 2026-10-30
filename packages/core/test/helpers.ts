import { addDays, key, makeIdGen } from '../src/index.ts';
import type { CalendarData, NowCtx, OpsCtx, ProtoEvent, ProtoGoal } from '../src/index.ts';

/** Fri 30 Oct 2026, 14:20 local. All tests run against this instant. */
export const TODAY = new Date(2026, 9, 30);
export const NOW_MIN = 14 * 60 + 20;
export const NOW_MS = new Date(2026, 9, 30, 14, 20).getTime();
export const TODAY_KEY = key(TODAY);
export const dd = (n: number): string => key(addDays(TODAY, n));

export const nowCtx = (over: Partial<NowCtx> = {}): NowCtx & { nowMs: number } => ({ today: TODAY, nowMin: NOW_MIN, nowMs: NOW_MS, ...over });

/** The same linear congruential generator the golden fixture was recorded with. */
export const lcg = (seed = 12345): (() => number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
};

export const opsCtx = (data: CalendarData, over: Partial<OpsCtx> = {}, uid?: number): OpsCtx => ({
  today: TODAY, nowMin: NOW_MIN, nowMs: NOW_MS, nextId: makeIdGen(data.events, uid), random: lcg(1), ...over,
});

export const ev = (id: string, day: string, cat: string | null, title: string, start: number, end: number, extra: Partial<ProtoEvent> = {}): ProtoEvent =>
  ({ id, day, cat, title, start, end, ...extra });

export const goal = (over: Partial<ProtoGoal> & Pick<ProtoGoal, 'id' | 'title'>): ProtoGoal => ({
  cat: over.title, outcome: '', hours: 10, start: dd(-10), deadline: dd(20), hue: 255, ...over,
});

/** Replace the "NOW" / "{now36}" placeholders the golden fixture uses for clock-dependent values. */
export const revive = <T>(x: T): T =>
  JSON.parse(JSON.stringify(x), (_k, v) => (v === 'NOW' ? NOW_MS : typeof v === 'string' ? v.split('{now36}').join(NOW_MS.toString(36)) : v));
