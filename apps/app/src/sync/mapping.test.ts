import {
  defaultCats,
  deleteCat,
  deleteEvent,
  editEvent,
  patchGoal,
  renameCat,
  toggleDone,
  type CalendarData,
  type ProtoEvent,
  type ProtoGoal,
  type Series,
} from '@calendar/core';

import {
  buildCatIndex,
  diffData,
  diffSeries,
  rowToPrefs,
  rowsToData,
  rowsToSeries,
  type DiffContext,
} from './mapping';
import { EPOCH, emptyAliases, emptyRows, type DbCategory, type DbEvent, type DbGoal, type DbSeriesRow, type Rows } from './types';

const U = '00000000-0000-4000-8000-0000000000a1';
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const T0 = Date.parse('2026-10-30T09:00:00.000Z');

const cat = (name: string, hue: number, i: number): DbCategory => ({
  id: uid(),
  user_id: U,
  name,
  hue,
  default_visibility: 'private',
  default_targets: [],
  created_at: new Date(T0 + i * 1000).toISOString(),
  updated_at: '2026-10-30T09:00:00.000Z',
});

function seedRows(): { rows: Rows; ids: Record<string, string> } {
  const rows = emptyRows();
  const ids: Record<string, string> = {};
  Object.entries(defaultCats()).forEach(([name, hue], i) => {
    const c = cat(name, hue, i);
    rows.categories[c.id] = c;
    ids[name] = c.id;
  });
  return { rows, ids };
}

const evRow = (over: Partial<DbEvent> & { id: string }): DbEvent => ({
  user_id: U,
  title: 'Standup',
  category_id: null,
  day: '2026-10-30',
  start_min: 540,
  end_min: 570,
  all_day: false,
  days: 1,
  done: false,
  pauses: [],
  win: null,
  win_asked: false,
  series_id: null,
  visibility: 'private',
  source: 'app',
  google_calendar_id: null,
  google_event_id: null,
  etag: null,
  organizer_email: null,
  is_mine: true,
  created_at: '2026-10-30T09:00:00.000Z',
  updated_at: '2026-10-30T09:00:00.000Z',
  deleted_at: null,
  legacy_id: null,
  ...over,
});

const goalRow = (over: Partial<DbGoal> & { id: string }): DbGoal => ({
  user_id: U,
  title: 'Novel',
  outcome: 'Finish draft',
  deadline: '2026-12-01',
  hours: 40,
  hue: 350,
  category_id: null,
  start_date: '2026-10-01',
  legacy_id: null,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  ...over,
});

const ctx = (rows: Rows, aliases = emptyAliases(), extra: Partial<DiffContext> = {}): DiffContext => ({
  userId: U,
  rows,
  aliases,
  goalLinks: {},
  newId: uid,
  now: T0 + 60_000,
  ...extra,
});

/** Apply a diff's upserts to rows like the engine does (rows only, no outbox). */
function applyUpserts(rows: Rows, d: ReturnType<typeof diffData>): Rows {
  const next: Rows = { ...rows, categories: { ...rows.categories }, goals: { ...rows.goals }, events: { ...rows.events }, series: { ...rows.series } };
  d.upserts.forEach((u) => {
    (next[u.table] as Record<string, unknown>)[u.id] = u.row;
  });
  d.removes.forEach((r) => {
    if (r.table === 'events') next.events[r.id] = { ...next.events[r.id], deleted_at: 'x' };
    else delete (next[r.table] as Record<string, unknown>)[r.id];
  });
  return next;
}

describe('rows -> CalendarData', () => {
  it('maps categories by name, events by category name, goals by category', () => {
    const { rows, ids } = seedRows();
    const e = evRow({ id: uid(), category_id: ids.Work, title: 'Plan', visibility: 'public' });
    rows.events[e.id] = e;
    const g = goalRow({ id: uid(), category_id: ids.Health, title: 'Run' });
    rows.goals[g.id] = g;
    const data = rowsToData(rows, emptyAliases());
    expect(Object.keys(data.cats)).toEqual(['Work', 'Food', 'Health', 'Family', 'Social', 'Routine', 'Pets']);
    expect(data.cats.Work).toBe(255);
    expect(data.events[0]).toMatchObject({ id: e.id, cat: 'Work', title: 'Plan', start: 540, end: 570, visibility: 'public', source: 'app', isMine: true });
    expect(data.goals[0]).toMatchObject({ id: g.id, cat: 'Health', title: 'Run', hours: 40 });
  });

  it('orders default categories by created_at, ties by the default order', () => {
    const rows = emptyRows();
    ['Pets', 'Work', 'Food'].forEach((name, i) => {
      const c = { ...cat(name, 1, 0), created_at: '2026-10-30T09:00:00.000Z' };
      void i;
      rows.categories[c.id] = c;
    });
    expect(Object.keys(rowsToData(rows, emptyAliases()).cats)).toEqual(['Work', 'Food', 'Pets']);
  });

  it('hides soft-deleted events and keeps google / someone-else events read-only-flagged', () => {
    const { rows } = seedRows();
    const gone = evRow({ id: uid(), deleted_at: '2026-10-30T10:00:00.000Z' });
    const g = evRow({ id: uid(), source: 'google', google_calendar_id: uid(), google_event_id: 'abc', is_mine: false, visibility: 'public', title: 'Dentist' });
    rows.events[gone.id] = gone;
    rows.events[g.id] = g;
    const data = rowsToData(rows, emptyAliases());
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ source: 'google', isMine: false, visibility: 'public' });
  });

  it('shows the app id for aliased rows and the device-local goal link', () => {
    const { rows } = seedRows();
    const dbId = uid();
    rows.events[dbId] = evRow({ id: dbId });
    const aliases = emptyAliases();
    aliases.toDb.e7 = dbId;
    aliases.fromDb[dbId] = 'e7';
    const data = rowsToData(rows, aliases, { [dbId]: 'g9' });
    expect(data.events[0]).toMatchObject({ id: 'e7', goalId: 'g9' });
  });

  it('series rows map to core Series', () => {
    const rows = emptyRows();
    const s: DbSeriesRow = { id: uid(), user_id: U, freq: 'weekly', weekdays: [1, 3], start_day: '2026-10-26', until: null, legacy_id: null, created_at: '2026-10-30T09:00:00.000Z', updated_at: '2026-10-30T09:00:00.000Z' };
    rows.series[s.id] = s;
    expect(rowsToSeries(rows, emptyAliases())).toEqual([{ id: s.id, freq: 'weekly', weekdays: [1, 3], startDay: '2026-10-26', until: null }]);
  });

  it('prefs: partial jsonb is completed with defaults', () => {
    expect(rowToPrefs({ prefs: { view: 'week' } as never }).view).toBe('week');
    expect(rowToPrefs(null).font).toBe('serif');
    expect(rowToPrefs({ prefs: {} as never }).ai.on).toBe(true);
  });

  it('round trip: rows -> data -> diff against itself is empty', () => {
    const { rows, ids } = seedRows();
    const e = evRow({ id: uid(), category_id: ids.Food, pauses: [[10, 20]], win: { text: 'x', at: 5 } });
    rows.events[e.id] = e;
    rows.goals[uid()] = goalRow({ id: uid(), category_id: ids.Health });
    const data = rowsToData(rows, emptyAliases());
    const d = diffData(data, data, ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.removes).toEqual([]);
  });
});

describe('diffData: events', () => {
  const base = () => {
    const { rows, ids } = seedRows();
    const e = evRow({ id: uid(), category_id: ids.Work });
    rows.events[e.id] = e;
    return { rows, ids, e, data: rowsToData(rows, emptyAliases()) };
  };

  it('create: a new event becomes one insert with only client-owned columns', () => {
    const { rows, ids, data } = base();
    const id = uid();
    const ev: ProtoEvent = { id, day: '2026-10-31', cat: 'Food', title: 'Lunch', start: 720, end: 765, at: T0 };
    const d = diffData(data, { ...data, events: [...data.events, ev] }, ctx(rows));
    expect(d.removes).toEqual([]);
    expect(d.upserts).toHaveLength(1);
    const u = d.upserts[0];
    expect(u).toMatchObject({ table: 'events', id });
    expect(u.payload).toMatchObject({ id, title: 'Lunch', category_id: ids.Food, day: '2026-10-31', start_min: 720, end_min: 765, all_day: false, deleted_at: null, visibility: 'private' });
    for (const k of ['source', 'is_mine', 'user_id', 'updated_at', 'google_event_id', 'legacy_id', 'etag']) expect(u.payload).not.toHaveProperty(k);
  });

  it('update: only the changed event is written', () => {
    const { rows, e, data } = base();
    const other = evRow({ id: uid(), title: 'Other' });
    rows.events[other.id] = other;
    const prev = rowsToData(rows, emptyAliases());
    const next = toggleDone(prev, e.id);
    const d = diffData(prev, next, ctx(rows));
    expect(d.upserts.map((u) => u.id)).toEqual([e.id]);
    expect(d.upserts[0].payload.done).toBe(true);
    void data;
  });

  it('title edit keeps created_at of the cached row', () => {
    const { rows, e, data } = base();
    const d = diffData(data, editEvent(data, e.id, { title: 'Renamed' }), ctx(rows));
    expect(d.upserts[0].payload.created_at).toBe(e.created_at);
  });

  it('delete: becomes a soft delete, not a payload', () => {
    const { rows, e, data } = base();
    const d = diffData(data, deleteEvent(data, e.id), ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.removes).toEqual([{ table: 'events', id: e.id }]);
  });

  it('undo of a delete revives the tombstone with deleted_at null', () => {
    const { rows, e, data } = base();
    rows.events[e.id] = { ...e, deleted_at: '2026-10-30T10:00:00.000Z' };
    const gone = rowsToData(rows, emptyAliases());
    expect(gone.events).toHaveLength(0);
    const d = diffData(gone, data, ctx(rows));
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0].payload.deleted_at).toBeNull();
    expect(d.upserts[0].id).toBe(e.id);
  });

  it('non-uuid ids get a stable uuid alias', () => {
    const { rows, data } = base();
    const ev: ProtoEvent = { id: 'e42', day: '2026-10-31', cat: null, title: 'Alias', start: 60, end: 90 };
    const d1 = diffData(data, { ...data, events: [...data.events, ev] }, ctx(rows));
    const dbId = d1.aliases.toDb.e42;
    expect(dbId).toMatch(/^[0-9a-f-]{36}$/);
    expect(d1.aliases.fromDb[dbId]).toBe('e42');
    expect(d1.upserts[0].id).toBe(dbId);
    // second commit reuses the alias
    const rows2 = applyUpserts(rows, d1);
    const prev2 = rowsToData(rows2, d1.aliases);
    expect(prev2.events.find((e) => e.id === 'e42')).toBeTruthy();
    const d2 = diffData(prev2, deleteEvent(prev2, 'e42'), ctx(rows2, d1.aliases));
    expect(d2.removes).toEqual([{ table: 'events', id: dbId }]);
    expect(Object.keys(d2.aliases.toDb)).toEqual(['e42']);
  });

  it('device-local goal link is tracked without a row change', () => {
    const { rows, e, data } = base();
    const d = diffData(data, editEvent(data, e.id, { goalId: 'g1' }), ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.goalLinks).toEqual({ [e.id]: 'g1' });
  });
});

describe('diffData: read-only events never produce writes', () => {
  const setup = () => {
    const { rows } = seedRows();
    const g = evRow({ id: uid(), source: 'google', google_calendar_id: uid(), google_event_id: 'g1', is_mine: false, title: 'Imported', visibility: 'public' });
    const mine = evRow({ id: uid(), title: 'Mine' });
    rows.events[g.id] = g;
    rows.events[mine.id] = mine;
    return { rows, g, mine, data: rowsToData(rows, emptyAliases()) };
  };

  it('editing a google event is dropped', () => {
    const { rows, g, data } = setup();
    const d = diffData(data, editEvent(toggleDone(data, g.id), g.id, { title: 'Hacked' }), ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.removes).toEqual([]);
    expect(d.ignored).toEqual([g.id]);
  });

  it('deleting a google event is dropped', () => {
    const { rows, g, data } = setup();
    const d = diffData(data, deleteEvent(data, g.id), ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.removes).toEqual([]);
    expect(d.ignored).toEqual([g.id]);
  });

  it('a new event claiming source google, or isMine false, is not written', () => {
    const { rows, data } = setup();
    const fake: ProtoEvent[] = [
      { id: uid(), day: '2026-10-31', cat: null, title: 'a', start: 0, end: 60, source: 'google' },
      { id: uid(), day: '2026-10-31', cat: null, title: 'b', start: 0, end: 60, isMine: false },
    ];
    const d = diffData(data, { ...data, events: [...data.events, ...fake] }, ctx(rows));
    expect(d.upserts).toEqual([]);
    expect(d.ignored).toHaveLength(2);
  });

  it('a whole-calendar commit that only touches my event leaves the imported one alone', () => {
    const { rows, mine, data } = setup();
    const d = diffData(data, editEvent(data, mine.id, { title: 'Mine 2' }), ctx(rows));
    expect(d.upserts.map((u) => u.id)).toEqual([mine.id]);
    expect(d.ignored).toEqual([]);
  });
});

describe('diffData: categories', () => {
  it('create: a new category is a new row with a fresh id and increasing created_at', () => {
    const { rows } = seedRows();
    const data = rowsToData(rows, emptyAliases());
    const next: CalendarData = { ...data, cats: { ...data.cats, Novel: 200, Garden: 90 } };
    const d = diffData(data, next, ctx(rows));
    const cats = d.upserts.filter((u) => u.table === 'categories');
    expect(cats.map((u) => u.payload.name)).toEqual(['Novel', 'Garden']);
    expect(new Set(cats.map((u) => u.id)).size).toBe(2);
    expect(Date.parse(String(cats[1].payload.created_at))).toBeGreaterThan(Date.parse(String(cats[0].payload.created_at)));
    expect(cats[0].payload).not.toHaveProperty('default_visibility');
  });

  it('rename (core renameCat): same row id, new name, events untouched', () => {
    const { rows, ids } = seedRows();
    const e = evRow({ id: uid(), category_id: ids.Work });
    rows.events[e.id] = e;
    const data = rowsToData(rows, emptyAliases());
    const d = diffData(data, renameCat(data, 'Work', 'Job'), ctx(rows));
    expect(d.removes).toEqual([]);
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0]).toMatchObject({ table: 'categories', id: ids.Work });
    expect(d.upserts[0].payload).toMatchObject({ name: 'Job', hue: 255 });
  });

  it('rename keeps the row position (created_at is not rewritten)', () => {
    const { rows, ids } = seedRows();
    const data = rowsToData(rows, emptyAliases());
    const d = diffData(data, renameCat(data, 'Food', 'Meals'), ctx(rows));
    expect(d.upserts[0].payload.created_at).toBe(rows.categories[ids.Food].created_at);
  });

  it('delete (core deleteCat): category row removed, its events move to the next category', () => {
    const { rows, ids } = seedRows();
    const e = evRow({ id: uid(), category_id: ids.Food });
    rows.events[e.id] = e;
    const data = rowsToData(rows, emptyAliases());
    const { data: next } = deleteCat(data, 'Food');
    const d = diffData(data, next, ctx(rows));
    expect(d.removes).toEqual([{ table: 'categories', id: ids.Food, name: 'Food' }]);
    const ev = d.upserts.find((u) => u.table === 'events');
    expect(ev?.payload.category_id).toBe(ids.Health);
  });

  it('hue change only updates the row', () => {
    const { rows, ids } = seedRows();
    const data = rowsToData(rows, emptyAliases());
    const d = diffData(data, { ...data, cats: { ...data.cats, Pets: 300 } }, ctx(rows));
    expect(d.upserts).toHaveLength(1);
    expect(d.upserts[0]).toMatchObject({ id: ids.Pets });
    expect(d.upserts[0].payload.hue).toBe(300);
  });

  it('an event moved to a brand new category points at the new row id', () => {
    const { rows } = seedRows();
    const e = evRow({ id: uid() });
    rows.events[e.id] = e;
    const data = rowsToData(rows, emptyAliases());
    const next = { ...editEvent(data, e.id, { cat: 'Novel' }), cats: { ...data.cats, Novel: 200 } };
    const d = diffData(data, next, ctx(rows));
    const c = d.upserts.find((u) => u.table === 'categories');
    const ev = d.upserts.find((u) => u.table === 'events');
    expect(c).toBeTruthy();
    expect(ev?.payload.category_id).toBe(c?.id);
  });

  it('id <-> name index', () => {
    const { rows, ids } = seedRows();
    const idx = buildCatIndex(rows.categories);
    expect(idx.idOf('Pets')).toBe(ids.Pets);
    expect(idx.nameOf(ids.Work)).toBe('Work');
    expect(idx.idOf('nope')).toBeNull();
  });
});

describe('diffData: goals', () => {
  const setup = () => {
    const { rows, ids } = seedRows();
    const g = goalRow({ id: uid(), title: 'Novel', category_id: null, hue: 350 });
    const c: DbCategory = { ...cat('Novel', 350, 20) };
    rows.categories[c.id] = c;
    rows.goals[g.id] = { ...g, category_id: c.id };
    return { rows, ids, c, g, data: rowsToData(rows, emptyAliases()) };
  };

  it('goal -> category_id by name', () => {
    const { rows, c } = setup();
    const data = rowsToData(rows, emptyAliases());
    expect(data.goals[0].cat).toBe('Novel');
    const g2: ProtoGoal = { id: 'g-new', title: 'Garden', cat: 'Garden', outcome: '', hours: 10, start: '2026-10-30', deadline: '2026-12-01', hue: 90, at: T0 };
    const next: CalendarData = { ...data, goals: [...data.goals, g2], cats: { ...data.cats, Garden: 90 } };
    const d = diffData(data, next, ctx(rows));
    const goal = d.upserts.find((u) => u.table === 'goals');
    const newCat = d.upserts.find((u) => u.table === 'categories');
    expect(goal?.payload.category_id).toBe(newCat?.id);
    expect(goal?.payload.category_id).not.toBe(c.id);
    expect(d.aliases.toDb['g-new']).toBe(goal?.id);
    expect(goal?.payload).toMatchObject({ title: 'Garden', hours: 10, start_date: '2026-10-30', deadline: '2026-12-01' });
  });

  it('goal rename (core patchGoal) renames the category row and rewrites the goal, events keep their category', () => {
    const { rows, c, g } = setup();
    const e = evRow({ id: uid(), category_id: c.id });
    rows.events[e.id] = e;
    const data = rowsToData(rows, emptyAliases());
    const next = patchGoal(data, g.id, { title: 'Memoir' });
    expect(Object.keys(next.cats)).toContain('Memoir');
    const d = diffData(data, next, ctx(rows));
    expect(d.removes).toEqual([]);
    const catUp = d.upserts.filter((u) => u.table === 'categories');
    expect(catUp).toHaveLength(1);
    expect(catUp[0]).toMatchObject({ id: c.id });
    expect(catUp[0].payload.name).toBe('Memoir');
    expect(d.upserts.filter((u) => u.table === 'events')).toEqual([]);
    const gl = d.upserts.find((u) => u.table === 'goals');
    expect(gl?.payload).toMatchObject({ id: g.id, title: 'Memoir', category_id: c.id });
  });

  it('goal removal is a hard delete of the goal row; its category is separate', () => {
    const { rows, g, data } = setup();
    const d = diffData(data, { ...data, goals: [] }, ctx(rows));
    expect(d.removes).toEqual([{ table: 'goals', id: g.id }]);
  });
});

describe('diffSeries and series ids on events', () => {
  it('a new series is an upsert; events reference it by row id', () => {
    const { rows } = seedRows();
    const s: Series = { id: 's1', freq: 'weekly', weekdays: [1, 3], startDay: '2026-10-26', until: null };
    const ds = diffSeries([], [s], ctx(rows));
    expect(ds.upserts).toHaveLength(1);
    const sid = ds.upserts[0].id;
    expect(ds.aliases.toDb.s1).toBe(sid);
    expect(ds.upserts[0].payload).toMatchObject({ freq: 'weekly', weekdays: [1, 3], start_day: '2026-10-26', until: null });

    // after the series is in the cache, events that carry the app series id map to its row id
    const rows2: Rows = { ...rows, series: { [sid]: ds.upserts[0].row as DbSeriesRow } };
    const data = rowsToData(rows2, ds.aliases);
    const ev: ProtoEvent = { id: uid(), day: '2026-10-26', cat: null, title: 'Gym', start: 420, end: 480, seriesId: 's1' };
    const de = diffData(data, { ...data, events: [ev] }, ctx(rows2, ds.aliases));
    expect(de.upserts[0].payload.series_id).toBe(sid);
    // and back
    const rows3 = applyUpserts(rows2, de);
    expect(rowsToData(rows3, ds.aliases).events[0].seriesId).toBe('s1');
  });

  it('an event pointing at an unknown series is written without a series id (the FK would reject it)', () => {
    const { rows } = seedRows();
    const data = rowsToData(rows, emptyAliases());
    const ev: ProtoEvent = { id: uid(), day: '2026-10-26', cat: null, title: 'Gym', start: 420, end: 480, seriesId: 'nope' };
    const d = diffData(data, { ...data, events: [ev] }, ctx(rows));
    expect(d.upserts[0].payload.series_id).toBeNull();
  });

  it('ending a series updates until; removing it deletes the row', () => {
    const { rows } = seedRows();
    const sid = uid();
    const row: DbSeriesRow = { id: sid, user_id: U, freq: 'weekly', weekdays: [2], start_day: '2026-10-27', until: null, legacy_id: null, created_at: '2026-10-30T09:00:00.000Z', updated_at: '2026-10-30T09:00:00.000Z' };
    rows.series[sid] = row;
    const prev = rowsToSeries(rows, emptyAliases());
    const ended = diffSeries(prev, [{ ...prev[0], until: '2026-11-30' }], ctx(rows));
    expect(ended.upserts[0].payload.until).toBe('2026-11-30');
    expect(ended.upserts[0].payload.created_at).toBe(row.created_at);
    const removed = diffSeries(prev, [], ctx(rows));
    expect(removed.removes).toEqual([{ table: 'series', id: sid }]);
    expect(diffSeries(prev, prev, ctx(rows)).upserts).toEqual([]);
  });
});

describe('helpers', () => {
  it('EPOCH marks never-synced rows', () => {
    expect(EPOCH).toBe('1970-01-01T00:00:00.000Z');
  });
});
