/**
 * Direct user edits as pure data transforms: tick off, delete, retime,
 * categories, goals, and the day-column lane layout.
 */
import { cap, clamp, parseHM } from './time.ts';
import { builtinHue, catHue, spareHue } from './categories.ts';
import type { CatMap } from './categories.ts';
import type { CalendarData, ProtoEvent, ProtoGoal } from './model.ts';
import { newGoalSeed } from './goals.ts';
import type { GoalPatch, SeedCtx } from './goals.ts';

const mapEvent = (d: CalendarData, id: string, f: (e: ProtoEvent) => ProtoEvent): CalendarData =>
  ({ ...d, events: d.events.map((e) => (e.id === id ? f(e) : e)) });

/** Flip an event's done flag. */
export const toggleDone = (d: CalendarData, id: string): CalendarData =>
  mapEvent(d, id, (e) => Object.assign({}, e, { done: !e.done }));

/** Merge a patch into one event. */
export const editEvent = (d: CalendarData, id: string, patch: Partial<ProtoEvent>): CalendarData =>
  mapEvent(d, id, (e) => Object.assign({}, e, patch));

export const deleteEvent = (d: CalendarData, id: string): CalendarData =>
  ({ ...d, events: d.events.filter((e) => e.id !== id) });

/**
 * Patch for typing a new start or end time into the event sheet. `text` is a
 * typed time ("9", "9:30pm"); null when it doesn't parse. Moving the start
 * past the end pushes the end out (keeping at least 15 minutes, at most 24 h);
 * an end at or before the start means the next day.
 */
export const retimeFromText = (ev: Pick<ProtoEvent, 'start' | 'end'>, which: 'start' | 'end', text: string): { start?: number; end: number } | null => {
  const m = parseHM(text);
  if (m == null) return null;
  if (which === 'start') {
    let end = ev.end;
    if (end <= m) { end = (((end % 1440) + 1440) % 1440) + 1440; if (end - m > 1440) end -= 1440; }
    return { start: m, end: Math.max(end, m + 15) };
  }
  const end = m <= ev.start ? m + 1440 : m;
  return { end: clamp(end, ev.start + 15, ev.start + 1440) };
};

/**
 * Rename a category: keeps its position and hue and moves its events. Goals
 * are not touched (as in the prototype). No-op for an empty or unchanged name.
 */
export const renameCat = (d: CalendarData, from: string, raw: string): CalendarData => {
  const t = cap(String(raw).trim());
  if (!t || t === from) return d;
  const cats: CatMap = {};
  Object.keys(d.cats).forEach((k) => { cats[k === from ? t : k] = d.cats[k]; });
  return { ...d, cats, events: d.events.map((e) => (e.cat === from ? Object.assign({}, e, { cat: t }) : e)) };
};

/**
 * Delete a category; its events move to the next category in the list (or the
 * previous one if it was last, or none). `moveTo` is that category, if any.
 */
export const deleteCat = (d: CalendarData, name: string): { data: CalendarData; moveTo: string | null } => {
  const keys = Object.keys(d.cats);
  const i = keys.indexOf(name);
  const next = keys[i + 1] != null ? keys[i + 1] : (i > 0 ? keys[i - 1] : null);
  const cats = Object.assign({}, d.cats);
  delete cats[name];
  return { data: { ...d, cats, events: d.events.map((e) => (e.cat === name ? Object.assign({}, e, { cat: next }) : e)) }, moveTo: next };
};

/**
 * Add a category typed by the user (taken literally: no alias folding; an
 * existing category with the same spelling ignoring case is reused) and
 * optionally put an event into it. A new one gets its built-in hue, else the
 * first spare one, else a random multiple of 10.
 */
export const addCat = (d: CalendarData, typed: string, o: { eventId?: string | null; random: () => number }): { data: CalendarData; name: string | null } => {
  const t = cap(String(typed || '').trim());
  if (!t) return { data: d, name: null };
  const cats: CatMap = Object.assign({}, d.cats);
  const name = Object.keys(cats).find((k) => k.toLowerCase() === t.toLowerCase()) || t;
  if (catHue(cats, name) == null) {
    const b = builtinHue(name), sp = spareHue(cats);
    cats[name] = b != null ? b : (sp != null ? sp : Math.round(o.random() * 36) * 10);
  }
  return {
    data: { ...d, cats, events: d.events.map((e) => (e.id === o.eventId ? Object.assign({}, e, { cat: name }) : e)) },
    name,
  };
};

/** Add a new goal (and its category). */
export const createGoal = (d: CalendarData, patch: GoalPatch, ctx: SeedCtx): { data: CalendarData; goal: ProtoGoal } => {
  const g = newGoalSeed(patch, ctx);
  return { data: { ...d, goals: d.goals.concat([g]), cats: Object.assign({}, d.cats, { [g.cat]: g.hue }) }, goal: g };
};

/**
 * Edit a goal. Renaming it renames its category (and moves the sessions
 * booked in the old one); hours are floored at 0; the category keeps the
 * goal's hue.
 */
export const patchGoal = (d: CalendarData, id: string, patch: GoalPatch & { cat?: string }): CalendarData => {
  const old = d.goals.find((g) => g.id === id);
  if (!old) return d;
  const nw: ProtoGoal = Object.assign({}, old, patch) as ProtoGoal;
  if (patch.title != null) { nw.title = String(patch.title); nw.cat = nw.title.trim() || old.cat; }
  if (patch.hours != null) nw.hours = Math.max(0, Number(patch.hours) || 0);
  let events = d.events;
  const cats: CatMap = Object.assign({}, d.cats);
  if (old.cat !== nw.cat) {
    events = d.events.map((e) => (e.cat === old.cat ? Object.assign({}, e, { cat: nw.cat }) : e));
    delete cats[old.cat];
  }
  cats[nw.cat] = nw.hue;
  return { goals: d.goals.map((g) => (g.id === id ? nw : g)), events, cats };
};

export const removeGoal = (d: CalendarData, id: string): CalendarData => ({ ...d, goals: d.goals.filter((g) => g.id !== id) });

/* ---------- day-column layout ---------- */

export interface LaidOut<T> {
  ev: T;
  /** lane index within its cluster of overlapping events */
  lane: number;
  /** left offset as a fraction of the column (lane / lanes) */
  x: number;
  /** width as a fraction of the column (1 / lanes) */
  w: number;
}

/**
 * Side-by-side lanes for overlapping events in one day column. Events are
 * sorted by start then end; a cluster of transitively overlapping events
 * shares its lane count.
 */
export const layoutDay = <T extends { start: number; end: number }>(evs: ReadonlyArray<T>): Array<LaidOut<T>> => {
  const s = evs.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const res: Array<LaidOut<T>> = [];
  let cl: Array<{ ev: T; lane: number }> = [], clEnd = -1;
  const flush = () => {
    if (!cl.length) return;
    const lanes: number[] = [];
    cl.forEach((e) => { let i = 0; while (lanes[i] != null && lanes[i] > e.ev.start) i++; lanes[i] = e.ev.end; e.lane = i; });
    const n = lanes.length;
    cl.forEach((e) => res.push({ ev: e.ev, lane: e.lane, x: e.lane / n, w: 1 / n }));
    cl = [];
  };
  s.forEach((ev) => {
    if (cl.length && ev.start >= clEnd) { flush(); clEnd = -1; }
    cl.push({ ev, lane: 0 });
    clEnd = Math.max(clEnd, ev.end);
  });
  flush();
  return res;
};

