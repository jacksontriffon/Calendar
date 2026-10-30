/**
 * Pure mapping between the database rows and the app's `CalendarData`.
 *
 * The app works on core's `CalendarData` (events with string ids, categories as
 * a name -> hue map, goals that name their category). The database is
 * normalised: categories are rows with uuids, events and goals point at them
 * with `category_id`, series are separate rows. This module converts in both
 * directions and computes what to write after a commit. It has no I/O and no
 * clock or id source of its own (callers pass them in), so it is unit-testable.
 *
 * Rules worth knowing:
 *  - Ids that are not uuids (goal ids like "g1x2y", event ids like "e42") get a
 *    stable uuid alias (`Aliases`). The app keeps seeing its own id.
 *  - Imported Google events (`source = 'google'`) and `is_mine = false` events
 *    are read-only: they map onto `ProtoEvent` (visibility, source, isMine) but a
 *    commit never produces a write for them (RLS would refuse it anyway).
 *  - A category that disappears while another appears, with events or goals
 *    moving from one to the other, is a rename: the row keeps its id.
 *  - Events are soft-deleted (`deleted_at`); goals, categories and series are
 *    hard-deleted, as in the schema.
 */
import {
  DEFAULT_PREFS,
  DEFCATS,
  eventToRow,
  goalToRow,
  hydrateSaved,
  rowToEvent,
  rowToGoal,
  rowToSeries,
  rowsToCats,
  seriesToRow,
  type CalendarData,
  type CatMap,
  type EventRow,
  type GoalRow,
  type Prefs,
  type ProtoEvent,
  type ProtoGoal,
  type SavedBlob,
  type Series,
  type SeriesRow,
} from '@calendar/core';

import {
  EPOCH,
  type Aliases,
  type DbCategory,
  type DbEvent,
  type DbGoal,
  type DbSeriesRow,
  type ProfileRow,
  type Rows,
  type SyncTable,
} from './types';

/* =====================================================================
 * small helpers
 * ===================================================================== */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

export const iso = (ms: number): string => new Date(ms).toISOString();

/** Milliseconds of an ISO timestamp (Postgres gives microseconds; those are cut). NaN-safe: 0. */
export const ts = (s: string | null | undefined): number => {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
};

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Structural equality for JSON values (jsonb does not keep key order). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => hasOwn(b as object, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export const cloneAliases = (a: Aliases): Aliases => ({ toDb: { ...a.toDb }, fromDb: { ...a.fromDb } });

/** App id -> database id, minting an alias for ids that are not uuids. Mutates `aliases`. */
export function dbIdFor(aliases: Aliases, id: string, newId: () => string): string {
  if (isUuid(id)) return id;
  const known = aliases.toDb[id];
  if (known) return known;
  const minted = newId();
  aliases.toDb[id] = minted;
  aliases.fromDb[minted] = id;
  return minted;
}

/** App id -> database id without minting (null when there is no such row yet). */
export const dbIdOf = (aliases: Aliases, id: string): string | null => (isUuid(id) ? id : aliases.toDb[id] ?? null);

/** Database id -> the id the app uses. */
export const appIdOf = (aliases: Aliases, dbId: string): string => aliases.fromDb[dbId] ?? dbId;

/* =====================================================================
 * categories: the id <-> name map
 * ===================================================================== */

export interface CatIndex {
  /** in display order: created_at, then the default categories' order, then name */
  ordered: DbCategory[];
  byName: Map<string, DbCategory>;
  byId: Map<string, DbCategory>;
  idOf(name: string | null | undefined): string | null;
  nameOf(id: string | null | undefined): string | null;
}

const defaultRank = (name: string): number => {
  const i = (DEFCATS as readonly string[]).indexOf(name);
  return i < 0 ? 999 : i;
};

export function buildCatIndex(categories: Record<string, DbCategory> | readonly DbCategory[]): CatIndex {
  const list = Array.isArray(categories) ? [...categories] : Object.values(categories as Record<string, DbCategory>);
  list.sort(
    (a, b) =>
      ts(a.created_at) - ts(b.created_at) || defaultRank(a.name) - defaultRank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const byName = new Map<string, DbCategory>();
  const byId = new Map<string, DbCategory>();
  list.forEach((c) => {
    byName.set(c.name, c);
    byId.set(c.id, c);
  });
  return {
    ordered: list,
    byName,
    byId,
    idOf: (name) => (name == null ? null : byName.get(name)?.id ?? null),
    nameOf: (id) => (id == null ? null : byId.get(id)?.name ?? null),
  };
}

/* =====================================================================
 * rows -> app data
 * ===================================================================== */

/** Imported Google events and other people's events are read-only. */
export const isReadOnlyRow = (r: Pick<DbEvent, 'source' | 'is_mine'>): boolean => r.source === 'google' || r.is_mine === false;
export const isReadOnlyEvent = (e: Pick<ProtoEvent, 'source' | 'isMine'>): boolean => e.source === 'google' || e.isMine === false;

const byCreated = <T extends { created_at: string; id: string }>(a: T, b: T): number =>
  ts(a.created_at) - ts(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The app's view of the local rows. `goalLinks` holds `ProtoEvent.goalId`, which
 * has no column and so stays on this device (keyed by event row id).
 */
export function rowsToData(rows: Rows, aliases: Aliases, goalLinks: Readonly<Record<string, string>> = {}): CalendarData {
  const idx = buildCatIndex(rows.categories);
  const events: ProtoEvent[] = Object.values(rows.events)
    .filter((r) => !r.deleted_at)
    .sort(byCreated)
    .map((r) => {
      const e = rowToEvent(r as unknown as EventRow, idx.nameOf);
      e.id = appIdOf(aliases, r.id);
      if (r.series_id) e.seriesId = appIdOf(aliases, r.series_id);
      const link = goalLinks[r.id];
      if (link) e.goalId = link;
      return e;
    });
  const goals: ProtoGoal[] = Object.values(rows.goals)
    .sort(byCreated)
    .map((r) => {
      const g = rowToGoal({ ...r, deadline: r.deadline ?? r.start_date } as unknown as GoalRow, idx.nameOf);
      g.id = appIdOf(aliases, r.id);
      return g;
    });
  return { events, cats: rowsToCats(idx.ordered), goals };
}

export function rowsToSeries(rows: Rows, aliases: Aliases): Series[] {
  return Object.values(rows.series)
    .sort(byCreated)
    .map((r) => {
      const s = rowToSeries(r as unknown as SeriesRow);
      s.id = appIdOf(aliases, r.id);
      return s;
    });
}

/** `profiles.prefs` (any jsonb) -> a complete, validated `Prefs`. */
export function rowToPrefs(profile: Pick<ProfileRow, 'prefs'> | null | undefined): Prefs {
  const raw = profile && profile.prefs && typeof profile.prefs === 'object' ? (profile.prefs as unknown as SavedBlob) : null;
  return hydrateSaved(raw, new Date(), DEFAULT_PREFS).prefs;
}

/* =====================================================================
 * write payloads: the columns the client owns
 * ===================================================================== */

type Payload = Record<string, unknown>;

export function categoryPayload(r: Pick<DbCategory, 'id' | 'name' | 'hue' | 'created_at'>): Payload {
  // default_visibility / default_targets are edited elsewhere (the category editor), so they are never sent.
  return { id: r.id, name: r.name, hue: r.hue, created_at: r.created_at };
}

export function goalPayload(r: Pick<DbGoal, 'id' | 'title' | 'outcome' | 'deadline' | 'hours' | 'hue' | 'category_id' | 'start_date' | 'created_at'>): Payload {
  return {
    id: r.id,
    title: r.title,
    outcome: r.outcome,
    deadline: r.deadline,
    hours: r.hours,
    hue: r.hue,
    category_id: r.category_id,
    start_date: r.start_date,
    created_at: r.created_at,
  };
}

export function seriesPayload(r: Pick<DbSeriesRow, 'id' | 'freq' | 'weekdays' | 'start_day' | 'until' | 'created_at'>): Payload {
  return { id: r.id, freq: r.freq, weekdays: r.weekdays, start_day: r.start_day, until: r.until, created_at: r.created_at };
}

export function eventPayload(
  r: Pick<
    DbEvent,
    | 'id'
    | 'title'
    | 'category_id'
    | 'day'
    | 'start_min'
    | 'end_min'
    | 'all_day'
    | 'days'
    | 'done'
    | 'pauses'
    | 'win'
    | 'win_asked'
    | 'series_id'
    | 'visibility'
    | 'deleted_at'
    | 'created_at'
  >,
): Payload {
  // source / is_mine / google_* / etag / legacy_id are never sent: the database defaults
  // (source 'app', is_mine true) are what RLS requires for client inserts.
  return {
    id: r.id,
    title: r.title,
    category_id: r.category_id,
    day: r.day,
    start_min: r.start_min,
    end_min: r.end_min,
    all_day: r.all_day,
    days: r.days,
    done: r.done,
    pauses: r.pauses,
    win: r.win ?? null,
    win_asked: !!r.win_asked,
    series_id: r.series_id,
    visibility: r.visibility,
    deleted_at: r.deleted_at ?? null,
    created_at: r.created_at,
  };
}

/** The payload that describes a cached row (used to skip writes that change nothing). */
export function payloadOfRow(table: SyncTable, row: DbCategory | DbGoal | DbSeriesRow | DbEvent): Payload {
  switch (table) {
    case 'categories':
      return categoryPayload(row as DbCategory);
    case 'goals':
      return goalPayload(row as DbGoal);
    case 'series':
      return seriesPayload(row as DbSeriesRow);
    case 'events':
      return eventPayload(row as DbEvent);
  }
}

/** True when a remote row already says what a pending payload says (an echo of our own write). */
export function payloadMatchesRow(payload: Payload, remote: Record<string, unknown>): boolean {
  return Object.keys(payload).every((k) => k === 'created_at' || deepEqual(payload[k], remote[k] ?? null));
}

/* =====================================================================
 * diff: what to write after a commit
 * ===================================================================== */

export interface DiffContext {
  userId: string;
  /** the local rows before the commit */
  rows: Rows;
  aliases: Aliases;
  /** event ids -> goal id (device-local link) */
  goalLinks: Readonly<Record<string, string>>;
  /** new uuid (for new rows and aliases) */
  newId: () => string;
  /** epoch ms */
  now: number;
}

export type RowForTable = {
  categories: DbCategory;
  series: DbSeriesRow;
  goals: DbGoal;
  events: DbEvent;
};

export type RowUpsert = {
  [T in SyncTable]: { table: T; id: string; row: RowForTable[T]; payload: Payload };
}[SyncTable];

export interface RowRemove {
  table: SyncTable;
  id: string;
  /** categories: the name, so the sender can order a delete before a re-create of the same name */
  name?: string;
}

export interface DiffResult {
  upserts: RowUpsert[];
  removes: RowRemove[];
  /** the aliases after the diff (includes newly minted ones) */
  aliases: Aliases;
  /** event row id -> goal id (null removes the link) */
  goalLinks: Record<string, string | null>;
  /** app ids of read-only events whose local changes were dropped */
  ignored: string[];
}

const emptyDiff = (aliases: Aliases): DiffResult => ({ upserts: [], removes: [], aliases, goalLinks: {}, ignored: [] });

const newCategoryRow = (userId: string, id: string, name: string, hue: number, createdAtMs: number): DbCategory => ({
  id,
  user_id: userId,
  name,
  hue,
  default_visibility: 'private',
  default_targets: [],
  created_at: iso(createdAtMs),
  updated_at: EPOCH,
});

/**
 * Which removed category names are really renames of added ones. Evidence
 * first (events or goals that moved from the old name to the new one), then the
 * same position in the list, then a lone leftover pair with the same hue.
 */
function pairRenames(prev: CalendarData, next: CalendarData): Map<string, string> {
  const prevNames = Object.keys(prev.cats);
  const nextNames = Object.keys(next.cats);
  const removed = prevNames.filter((n) => !hasOwn(next.cats, n));
  const added = nextNames.filter((n) => !hasOwn(prev.cats, n));
  const pairs = new Map<string, string>(); // old name -> new name
  if (!removed.length || !added.length) return pairs;

  const votes = new Map<string, number>();
  const vote = (from: string | null, to: string | null) => {
    if (from == null || to == null || from === to) return;
    if (!removed.includes(from) || !added.includes(to)) return;
    const k = from + '\u0000' + to;
    votes.set(k, (votes.get(k) ?? 0) + 1);
  };
  const prevEv = new Map(prev.events.map((e) => [e.id, e]));
  next.events.forEach((e) => vote(prevEv.get(e.id)?.cat ?? null, e.cat));
  const prevGoal = new Map(prev.goals.map((g) => [g.id, g]));
  next.goals.forEach((g) => vote(prevGoal.get(g.id)?.cat ?? null, g.cat));

  const taken = new Set<string>();
  [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([k]) => {
      const [from, to] = k.split('\u0000');
      if (pairs.has(from) || taken.has(to)) return;
      pairs.set(from, to);
      taken.add(to);
    });

  removed.forEach((r) => {
    if (pairs.has(r)) return;
    const a = added.find((x) => !taken.has(x) && nextNames.indexOf(x) === prevNames.indexOf(r));
    if (a) {
      pairs.set(r, a);
      taken.add(a);
    }
  });
  const leftR = removed.filter((r) => !pairs.has(r));
  const leftA = added.filter((a) => !taken.has(a));
  if (leftR.length === 1 && leftA.length === 1 && prev.cats[leftR[0]] === next.cats[leftA[0]]) pairs.set(leftR[0], leftA[0]);
  return pairs;
}

/**
 * What a commit changes in the database: the rows to upsert and to remove,
 * computed from the data before and after. Only differences are returned, and
 * nothing for read-only (Google / someone else's) events.
 */
export function diffData(prev: CalendarData, next: CalendarData, ctx: DiffContext): DiffResult {
  const aliases = cloneAliases(ctx.aliases);
  const out = emptyDiff(aliases);
  const { rows, userId } = ctx;
  const idx0 = buildCatIndex(rows.categories);

  /* ---- categories ---- */
  const pairs = pairRenames(prev, next);
  const renamedTo = new Map<string, string>(); // new name -> old name
  pairs.forEach((to, from) => renamedTo.set(to, from));
  const nextCatId = new Map<string, string>();
  const maxCreated = Math.max(0, ...Object.values(rows.categories).map((c) => ts(c.created_at)));
  let bump = 0;
  Object.keys(next.cats).forEach((name) => {
    const hue = next.cats[name];
    const oldName = renamedTo.get(name);
    const existing = idx0.byName.get(oldName ?? name);
    if (existing) {
      nextCatId.set(name, existing.id);
      if (existing.name !== name || existing.hue !== hue) {
        const row: DbCategory = { ...existing, name, hue };
        out.upserts.push({ table: 'categories', id: row.id, row, payload: categoryPayload(row) });
      }
    } else {
      const id = ctx.newId();
      nextCatId.set(name, id);
      const row = newCategoryRow(userId, id, name, hue, Math.max(ctx.now, maxCreated + 1) + bump++);
      out.upserts.push({ table: 'categories', id, row, payload: categoryPayload(row) });
    }
  });
  Object.keys(prev.cats).forEach((name) => {
    if (hasOwn(next.cats, name) || pairs.has(name)) return;
    const existing = idx0.byName.get(name);
    if (existing) out.removes.push({ table: 'categories', id: existing.id, name });
  });

  const nextCatIdOf = (n: string | null | undefined) => (n == null ? null : nextCatId.get(n) ?? null);
  const prevCatIdOf = (n: string | null | undefined) => idx0.idOf(n);

  /* ---- goals ---- */
  const prevGoals = new Map(prev.goals.map((g) => [g.id, g]));
  const nextGoalIds = new Set(next.goals.map((g) => g.id));
  const goalRowPayload = (g: ProtoGoal, id: string, catId: (n: string | null | undefined) => string | null, cached: DbGoal | undefined): Payload => {
    const r = goalToRow(g, { userId, catId, id });
    return goalPayload({
      id: r.id,
      title: r.title,
      outcome: r.outcome,
      deadline: r.deadline,
      hours: r.hours,
      hue: r.hue,
      category_id: r.category_id,
      start_date: r.start_date,
      created_at: cached ? cached.created_at : iso(g.at ?? ctx.now),
    });
  };
  next.goals.forEach((g) => {
    const id = dbIdFor(aliases, g.id, ctx.newId);
    const cached = rows.goals[id];
    const payload = goalRowPayload(g, id, nextCatIdOf, cached);
    const pg = prevGoals.get(g.id);
    if (pg && deepEqual(goalRowPayload(pg, id, prevCatIdOf, cached), payload)) return;
    if (cached && deepEqual(payloadOfRow('goals', cached), payload)) return;
    const row: DbGoal = {
      ...(cached ?? { user_id: userId, updated_at: EPOCH, legacy_id: null }),
      ...(payload as Partial<DbGoal>),
    } as DbGoal;
    out.upserts.push({ table: 'goals', id, row, payload });
  });
  prev.goals.forEach((g) => {
    if (nextGoalIds.has(g.id)) return;
    const id = dbIdOf(aliases, g.id);
    if (id && rows.goals[id]) out.removes.push({ table: 'goals', id });
  });

  /* ---- events ---- */
  const prevEvents = new Map(prev.events.map((e) => [e.id, e]));
  const nextEventIds = new Set(next.events.map((e) => e.id));
  const seriesIdOf = (e: ProtoEvent): string | null => {
    if (!e.seriesId) return null;
    const sid = dbIdOf(aliases, e.seriesId);
    return sid && rows.series[sid] ? sid : null;
  };
  const eventPayloadFor = (e: ProtoEvent, id: string, catId: (n: string | null | undefined) => string | null, cached: DbEvent | undefined): Payload => {
    const r = eventToRow(e, {
      userId,
      catId,
      id,
      seriesId: seriesIdOf(e),
      visibility: e.visibility ?? 'private',
      updatedAt: EPOCH,
    });
    return eventPayload({
      ...r,
      pauses: r.pauses as unknown as DbEvent['pauses'],
      win: r.win as unknown as DbEvent['win'],
      win_asked: !!r.win_asked,
      created_at: cached ? cached.created_at : iso(e.at ?? ctx.now),
    });
  };
  const link = (id: string, e: ProtoEvent) => {
    const want = e.goalId ?? null;
    if ((ctx.goalLinks[id] ?? null) !== want) out.goalLinks[id] = want;
  };
  next.events.forEach((e) => {
    const id = dbIdFor(aliases, e.id, ctx.newId);
    const cached = rows.events[id];
    const pe = prevEvents.get(e.id);
    if (isReadOnlyEvent(e) || (cached && isReadOnlyRow(cached))) {
      if (!pe || JSON.stringify(pe) !== JSON.stringify(e)) out.ignored.push(e.id);
      return;
    }
    link(id, e);
    const payload = eventPayloadFor(e, id, nextCatIdOf, cached);
    if (pe && deepEqual(eventPayloadFor(pe, id, prevCatIdOf, cached), payload)) return;
    if (cached && !cached.deleted_at && deepEqual(payloadOfRow('events', cached), payload)) return;
    const row: DbEvent = {
      ...(cached ?? {
        user_id: userId,
        updated_at: EPOCH,
        source: 'app',
        is_mine: true,
        google_calendar_id: null,
        google_event_id: null,
        etag: null,
        organizer_email: null,
        legacy_id: null,
      }),
      ...(payload as Partial<DbEvent>),
    } as DbEvent;
    out.upserts.push({ table: 'events', id, row, payload });
  });
  prev.events.forEach((e) => {
    if (nextEventIds.has(e.id)) return;
    const id = dbIdOf(aliases, e.id);
    const cached = id ? rows.events[id] : undefined;
    if (!id || !cached || cached.deleted_at) return;
    if (isReadOnlyRow(cached)) {
      out.ignored.push(e.id);
      return;
    }
    out.removes.push({ table: 'events', id });
    if (ctx.goalLinks[id]) out.goalLinks[id] = null;
  });

  return out;
}

/** The same for the weekly series list (`CalendarData` has no series). */
export function diffSeries(prev: readonly Series[], next: readonly Series[], ctx: DiffContext): DiffResult {
  const aliases = cloneAliases(ctx.aliases);
  const out = emptyDiff(aliases);
  const { rows, userId } = ctx;
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const nextIds = new Set(next.map((s) => s.id));
  next.forEach((s) => {
    const id = dbIdFor(aliases, s.id, ctx.newId);
    const cached = rows.series[id];
    const r = seriesToRow({ ...s, weekdays: s.weekdays.slice() }, userId);
    const payload = seriesPayload({ id, freq: r.freq, weekdays: r.weekdays, start_day: r.start_day, until: r.until, created_at: cached ? cached.created_at : iso(ctx.now) });
    const ps = prevById.get(s.id);
    if (ps) {
      const pr = seriesToRow(ps, userId);
      if (deepEqual(pr.weekdays, r.weekdays) && pr.start_day === r.start_day && pr.until === r.until) return;
    }
    if (cached && deepEqual(payloadOfRow('series', cached), payload)) return;
    const row: DbSeriesRow = {
      ...(cached ?? { user_id: userId, updated_at: EPOCH }),
      ...(payload as Partial<DbSeriesRow>),
    } as DbSeriesRow;
    out.upserts.push({ table: 'series', id, row, payload });
  });
  prev.forEach((s) => {
    if (nextIds.has(s.id)) return;
    const id = dbIdOf(aliases, s.id);
    if (id && rows.series[id]) out.removes.push({ table: 'series', id });
  });
  return out;
}

/** A stable label for a conflict toast: what the user was editing. */
export function rowLabel(table: SyncTable | 'profiles', row: Record<string, unknown> | null | undefined): string {
  if (table === 'profiles') return 'Settings';
  if (!row) return 'item';
  switch (table) {
    case 'events':
    case 'goals':
      return String(row.title || (table === 'events' ? 'event' : 'goal'));
    case 'categories':
      return String(row.name || 'category');
    case 'series':
      return 'repeating event';
  }
}

export type { CatMap };
