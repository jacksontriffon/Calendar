import { describe, expect, it } from 'vitest';
import {
  addCat, createGoal, dataSnap, deleteCat, deleteEvent, editEvent, editLabel, historyId, layoutDay, makeHistoryEntry, patchGoal, pushHistory,
  removeGoal, renameCat, restoreEntry, retimeFromText, sanitizeHistory, toggleDone, HMAX,
} from '../src/index.ts';
import type { CalendarData, HistoryEntry } from '../src/index.ts';
import { NOW_MS, TODAY, TODAY_KEY, dd, ev, goal, lcg } from './helpers.ts';

const base = (): CalendarData => ({
  events: [ev('e1', TODAY_KEY, 'Work', 'Standup', 570, 585), ev('e2', TODAY_KEY, 'Food', 'Lunch', 720, 765), ev('e3', TODAY_KEY, 'Deep work', 'Sync', 900, 960)],
  cats: { Work: 255, Food: 72, 'Deep work': 240 },
  goals: [goal({ id: 'g1', title: 'Deep work', cat: 'Deep work', hue: 240 })],
});

describe('event edits', () => {
  it('toggleDone flips', () => {
    const d = toggleDone(base(), 'e1');
    expect(d.events[0].done).toBe(true);
    expect(toggleDone(d, 'e1').events[0].done).toBe(false);
    expect(toggleDone(base(), 'nope').events).toEqual(base().events);
  });
  it('editEvent merges, deleteEvent removes, inputs untouched', () => {
    const d = base();
    expect(editEvent(d, 'e2', { title: 'Brunch' }).events[1]).toMatchObject({ title: 'Brunch', start: 720 });
    expect(deleteEvent(d, 'e2').events.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(d.events).toHaveLength(3);
  });
});

describe('retimeFromText (typing a time into the event sheet)', () => {
  const e = { start: 600, end: 660 };
  it('invalid text', () => expect(retimeFromText(e, 'start', 'abc')).toBeNull());
  it('moving the start earlier keeps the end', () => expect(retimeFromText(e, 'start', '9')).toEqual({ start: 540, end: 660 }));
  it('moving the start to or past the end rolls the end over to the next day', () => {
    // end 660 <= new start 660: the end moves to the same time the next day (exactly 24h later)
    expect(retimeFromText(e, 'start', '11:00')).toEqual({ start: 660, end: 2100 });
    expect(retimeFromText({ start: 600, end: 700 }, 'start', '11:55')).toEqual({ start: 715, end: 2140 });
    expect(retimeFromText({ start: 600, end: 1500 }, 'start', '10:30')).toEqual({ start: 630, end: 1500 });
  });
  it('end at or before the start means the next day, limited to 24h', () => {
    expect(retimeFromText(e, 'end', '7am')).toEqual({ end: 1860 });
    expect(retimeFromText(e, 'end', '10')).toEqual({ end: 1440 + 600 });
    expect(retimeFromText(e, 'end', '10:30')).toEqual({ end: 630 });
    expect(retimeFromText(e, 'end', '10:05')).toEqual({ end: 615 });
    expect(retimeFromText(e, 'end', '10:01')).toEqual({ end: 615 }); // at least 15 minutes
  });
});

describe('categories', () => {
  it('renameCat keeps order and hue, moves events, trims and capitalises', () => {
    const d = renameCat(base(), 'Food', '  meals ');
    expect(Object.keys(d.cats)).toEqual(['Work', 'Meals', 'Deep work']);
    expect(d.cats.Meals).toBe(72);
    expect(d.events[1].cat).toBe('Meals');
    expect(renameCat(base(), 'Food', '  ')).toEqual(base());
    expect(renameCat(base(), 'Food', 'Food')).toEqual(base());
  });
  it('deleteCat moves events to the next category (or previous, or none)', () => {
    const a = deleteCat(base(), 'Food');
    expect(a.moveTo).toBe('Deep work');
    expect(a.data.events[1].cat).toBe('Deep work');
    expect(Object.keys(a.data.cats)).toEqual(['Work', 'Deep work']);
    const b = deleteCat(base(), 'Deep work');
    expect(b.moveTo).toBe('Food');
    const only = deleteCat({ events: [ev('e', TODAY_KEY, 'A', 't', 1, 2)], cats: { A: 1 }, goals: [] }, 'A');
    expect(only.moveTo).toBeNull();
    expect(only.data.events[0].cat).toBeNull();
  });
  it('addCat: literal name, reuse ignoring case, built-in or spare hue, optional event', () => {
    const r = addCat(base(), ' origami ', { eventId: 'e1', random: lcg(1) });
    expect(r.name).toBe('Origami');
    expect(r.data.cats.Origami).toBe(350);
    expect(r.data.events[0].cat).toBe('Origami');
    expect(addCat(base(), 'work', { random: lcg(1) }).name).toBe('Work');
    expect(addCat(base(), 'Pets', { random: lcg(1) }).data.cats.Pets).toBe(166); // built-in hue
    expect(addCat(base(), 'Lunch', { random: lcg(1) }).data.cats.Lunch).toBe(72); // not folded to Food
    expect(addCat(base(), '  ', { random: lcg(1) }).name).toBeNull();
    const full = { events: [], goals: [], cats: Object.fromEntries([350, 170, 290, 60, 240, 125, 28, 1000].map((h, i) => ['c' + i, h])) };
    expect(addCat(full, 'More', { random: () => 0.5 }).data.cats.More).toBe(180);
  });
});

describe('goal edits', () => {
  const sc = { today: TODAY, cats: {}, goalCount: 1, nowMs: NOW_MS, random: lcg(2) };
  it('createGoal adds the goal and its category', () => {
    const r = createGoal(base(), { title: 'Piano', hours: 10 }, { ...sc, cats: base().cats });
    expect(r.data.goals).toHaveLength(2);
    expect(r.data.cats.Piano).toBe(r.goal.hue);
    expect(r.goal.hue).toBe(350);
  });
  it('patchGoal: hours floor, other fields', () => {
    expect(patchGoal(base(), 'g1', { hours: -5 }).goals[0].hours).toBe(0);
    expect(patchGoal(base(), 'g1', { outcome: 'x', hue: 60 }).goals[0]).toMatchObject({ outcome: 'x', hue: 60 });
    expect(patchGoal(base(), 'g1', { hue: 60 }).cats['Deep work']).toBe(60);
    expect(patchGoal(base(), 'nope', { hours: 1 })).toEqual(base());
  });
  it('patchGoal: renaming moves the category and its events; blank title keeps the old category', () => {
    const d = patchGoal(base(), 'g1', { title: 'Focus' });
    expect(d.goals[0]).toMatchObject({ title: 'Focus', cat: 'Focus' });
    expect(d.cats).toEqual({ Work: 255, Food: 72, Focus: 240 });
    expect(d.events[2].cat).toBe('Focus');
    const blank = patchGoal(base(), 'g1', { title: '  ' });
    expect(blank.goals[0].cat).toBe('Deep work');
    expect(blank.events[2].cat).toBe('Deep work');
  });
  it('removeGoal leaves sessions and category alone', () => {
    const d = removeGoal(base(), 'g1');
    expect(d.goals).toEqual([]);
    expect(d.events).toHaveLength(3);
  });
});

describe('layoutDay', () => {
  const L = (evs: Array<{ id: string; start: number; end: number }>) => layoutDay(evs).map((r) => [r.ev.id, r.lane, r.x, r.w]);
  it('a lone event fills the column', () => expect(L([{ id: 'a', start: 0, end: 60 }])).toEqual([['a', 0, 0, 1]]));
  it('events that do not overlap each fill the column', () => expect(L([{ id: 'a', start: 0, end: 60 }, { id: 'b', start: 60, end: 120 }])).toEqual([['a', 0, 0, 1], ['b', 0, 0, 1]]));
  it('two overlapping events share the column', () => expect(L([{ id: 'a', start: 0, end: 90 }, { id: 'b', start: 60, end: 120 }])).toEqual([['a', 0, 0, 0.5], ['b', 1, 0.5, 0.5]]));
  it('lanes are reused within a cluster', () => {
    // sorted b(0-60), a(0-180), c(60-120): c reuses b's lane once b has ended
    expect(L([{ id: 'a', start: 0, end: 180 }, { id: 'b', start: 0, end: 60 }, { id: 'c', start: 60, end: 120 }])).toEqual([['b', 0, 0, 0.5], ['a', 1, 0.5, 0.5], ['c', 0, 0, 0.5]]);
  });
  it('sorts by start then end, and does not mutate the input', () => {
    const input = [{ id: 'b', start: 60, end: 120 }, { id: 'a', start: 0, end: 90 }];
    expect(L(input).map((r) => r[0])).toEqual(['a', 'b']);
    expect(input[0].id).toBe('b');
  });
});

describe('history', () => {
  const mkEntry = (label: string): HistoryEntry => {
    const before = base(), after = deleteEvent(before, 'e1');
    return makeHistoryEntry(label, 'delete', dataSnap(before), dataSnap(after), NOW_MS, lcg(1))!;
  };
  it('no entry when nothing changed', () => expect(makeHistoryEntry('x', 'edit', dataSnap(base()), dataSnap(base()), NOW_MS, lcg(1))).toBeNull());
  it('entry fields and id shape', () => {
    const h = mkEntry('Deleted · Standup');
    expect(h).toMatchObject({ label: 'Deleted · Standup', kind: 'delete', t: NOW_MS });
    expect(h.id).toBe(historyId(NOW_MS, lcg(1)));
    expect(h.id).toMatch(/^h[0-9a-z]+$/);
    expect(h.before.events).toHaveLength(3);
    expect(h.after.events).toHaveLength(2);
  });
  it('defaults to the edit kind', () => expect(makeHistoryEntry('x', undefined, dataSnap(base()), dataSnap(deleteEvent(base(), 'e1')), 1, lcg(1))?.kind).toBe('edit'));
  it('pushHistory is newest first and capped', () => {
    let log: HistoryEntry[] = [];
    for (let i = 0; i < HMAX + 5; i++) log = pushHistory(log, { ...mkEntry('e' + i), id: 'h' + i });
    expect(log).toHaveLength(HMAX);
    expect(log[0].id).toBe('h' + (HMAX + 4));
  });
  it('sanitizeHistory drops malformed entries', () => {
    expect(sanitizeHistory(null)).toEqual([]);
    const ok = mkEntry('ok');
    expect(sanitizeHistory([ok, { id: 'x' }, null, { id: 'y', before: {}, after: {} }])).toHaveLength(2);
  });
  it('restoreEntry puts the before snapshot back, keeps current goals if the entry has none', () => {
    const e = mkEntry('Deleted');
    const current = deleteEvent(base(), 'e1');
    const r = restoreEntry(e, current, NOW_MS, lcg(2));
    expect(r.data.events.map((x) => x.id)).toEqual(['e1', 'e2', 'e3']);
    expect(r.label).toBe('Reverted · Deleted');
    const legacy = { ...e, before: { ...e.before, goals: undefined as unknown as never } } as HistoryEntry;
    expect(restoreEntry(legacy, { ...current, goals: [] }, NOW_MS, lcg(2)).data.goals).toEqual([]);
  });
  it('editLabel: rename / re-categorise / retime / categories', () => {
    const b = base();
    const e1 = b.events[0];
    expect(editLabel(b, editEvent(b, 'e1', { title: 'Daily' }), e1)).toBe('Renamed · Daily');
    expect(editLabel(b, editEvent(b, 'e1', { cat: 'Food' }), e1)).toBe('Standup → Food');
    expect(editLabel(b, editEvent(b, 'e1', { cat: null }), e1)).toBe('Standup → no category');
    expect(editLabel(b, editEvent(b, 'e1', { start: 600 }), e1)).toBe('Retimed · Standup');
    expect(editLabel(b, { ...b, cats: { ...b.cats, New: 1 } }, e1)).toBe('Categories updated');
    expect(editLabel(b, b, e1)).toBe('Edited · Standup');
    expect(editLabel(b, b, null)).toBe('Edited · event');
  });
  it('dd helper sanity', () => expect(dd(0)).toBe(TODAY_KEY));
});
