/**
 * Pure part of legacy-import: turn the old web app's `calendars.data` JSON (`aical.v1`, see the
 * prototype's `sbSnap`, core `SavedBlob`) into row payloads. No database access here.
 *
 * Rows are produced without `id`: the database assigns it, and re-imports find existing rows by
 * `(user_id, legacy_id)`. Every row that came out of the blob keeps the prototype id in `legacy_id`.
 */
import {
  builtinHue, eventToRow, goalToRow, hydrateSaved, seriesToRow,
} from '@calendar/core';
import type {
  CatIdLookup, CategoryRow, EventRow, GoalRow, Hydrated, ProtoEvent, ProtoGoal, SavedBlob, Series, SeriesRow,
} from '@calendar/core';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** The legacy blob, plus the optional `series` list newer web builds may carry. */
export type LegacyBlob = SavedBlob & { series?: unknown };

/** Does the stored JSON look like a calendar at all? An empty `{}` (the column default) does not. */
export const isCalendarBlob = (data: unknown): data is LegacyBlob =>
  isObj(data) && (Array.isArray(data.events) || isObj(data.cats) || Array.isArray(data.goals));

/** Category names are unique per user and 1..80 characters. */
export const catName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const n = v.trim().slice(0, 80);
  return n || null;
};

/** A hue the `categories`/`goals` check constraints accept: 0..360, or 1000 for the grey swatch. */
export const sane = (hue: unknown, fallback = 1000): number => {
  if (!finite(hue)) return fallback;
  if (hue === 1000) return 1000;
  return ((Math.round(hue) % 360) + 360) % 360;
};

export type OmitId<T> = Omit<T, 'id'>;

export interface Skipped { events: number; goals: number; series: number; targets: number }

export interface Plan {
  hydrated: Hydrated;
  /** every category name the blob mentions (in its map, or on an event/goal), with the hue to create it with */
  categories: Array<{ name: string; hue: number }>;
  /** valid events, each with the legacy ids it needs resolved to row ids */
  events: ProtoEvent[];
  goals: ProtoGoal[];
  series: Series[];
  skipped: Skipped;
}

/** Fix an event so it satisfies the table's checks, or null if it can't be imported. */
export const cleanEvent = (raw: unknown): ProtoEvent | null => {
  if (!isObj(raw)) return null;
  const id = raw.id == null ? '' : String(raw.id);
  if (!id || !validDay(raw.day)) return null;
  const allDay = !!raw.allDay;
  let start = 0, end = 1440;
  if (!allDay) {
    if (!finite(raw.start) || !finite(raw.end)) return null;
    start = Math.min(1439, Math.max(0, Math.round(raw.start)));
    end = Math.round(raw.end);
    if (end <= start) end = start + 15;       // zero/negative length: the model's minimum event
    if (end > start + 1440) end = start + 1440;
  }
  const e: ProtoEvent = {
    id, day: raw.day, cat: catName(raw.cat), title: typeof raw.title === 'string' ? raw.title : String(raw.title ?? ''),
    start, end, allDay, days: finite(raw.days) ? Math.min(366, Math.max(1, Math.round(raw.days))) : 1, done: !!raw.done,
  };
  if (Array.isArray(raw.pauses)) e.pauses = raw.pauses as ProtoEvent['pauses'];
  if (isObj(raw.win) && typeof raw.win.text === 'string') e.win = raw.win as unknown as ProtoEvent['win'];
  if (raw.winAsked) e.winAsked = true;
  if (finite(raw.at)) e.at = raw.at;
  if (typeof raw.seriesId === 'string' && raw.seriesId) e.seriesId = raw.seriesId;
  return e;
};

const cleanGoal = (g: ProtoGoal): ProtoGoal | null => {
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, 200) : '';
  if (!g.id || !title) return null;
  if (!validDay(g.start)) return null;
  return {
    ...g, id: String(g.id), title, cat: catName(g.cat) ?? title, outcome: typeof g.outcome === 'string' ? g.outcome : '',
    hours: Math.min(99999, Math.max(0, Number(g.hours) || 0)), hue: sane(g.hue, 47),
    deadline: validDay(g.deadline) ? g.deadline : (undefined as unknown as string),
  };
};

const cleanSeries = (raw: unknown): Series | null => {
  if (!isObj(raw) || raw.id == null || !validDay(raw.startDay)) return null;
  const weekdays = Array.isArray(raw.weekdays) ? [...new Set(raw.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  if (!weekdays.length) return null;
  const until = validDay(raw.until) && raw.until >= raw.startDay ? raw.until : null;
  return { id: String(raw.id), freq: 'weekly', weekdays, startDay: raw.startDay, until };
};

export const plan = (blob: LegacyBlob, today: Date): Plan => {
  const hydrated = hydrateSaved(blob, today);
  const skipped: Skipped = { events: 0, goals: 0, series: 0, targets: 0 };

  const seen = new Set<string>();
  const events: ProtoEvent[] = [];
  for (const raw of hydrated.events ?? []) {
    const e = cleanEvent(raw);
    if (!e || seen.has(e.id)) { skipped.events++; continue; }
    seen.add(e.id);
    events.push(e);
  }

  const goals: ProtoGoal[] = [];
  const gseen = new Set<string>();
  const rawGoals = hydrated.goals ?? [];
  for (const g of rawGoals) {
    const c = cleanGoal(g);
    if (!c || gseen.has(c.id)) { skipped.goals++; continue; }
    gseen.add(c.id);
    goals.push(c);
  }

  const series: Series[] = [];
  const sseen = new Set<string>();
  if (Array.isArray(blob.series)) {
    for (const raw of blob.series) {
      const s = cleanSeries(raw);
      if (!s || sseen.has(s.id)) { skipped.series++; continue; }
      sseen.add(s.id);
      series.push(s);
    }
  }
  // An event can only point at a series that came over.
  for (const e of events) if (e.seriesId && !sseen.has(e.seriesId)) delete e.seriesId;

  const hues = new Map<string, number>();
  const add = (name: string | null, hue: number | undefined) => {
    if (name && !hues.has(name)) hues.set(name, sane(hue ?? builtinHue(name)));
  };
  for (const [k, v] of Object.entries(hydrated.cats ?? {})) add(catName(k), v);
  for (const g of goals) add(catName(g.cat), g.hue);
  for (const e of events) add(e.cat, undefined);

  return { hydrated, categories: [...hues].map(([name, hue]) => ({ name, hue })), events, goals, series, skipped };
};

export const categoryInsert = (userId: string, c: { name: string; hue: number }): Pick<CategoryRow, 'user_id' | 'name' | 'hue'> => ({
  user_id: userId, name: c.name, hue: c.hue,
});

/** Row for `series`, without id, keyed by the prototype id. */
export const seriesInsert = (s: Series, userId: string): OmitId<SeriesRow> & { legacy_id: string } => {
  const { id: _id, ...row } = seriesToRow(s, userId);
  return { ...row, legacy_id: s.id };
};

export const goalInsert = (
  g: ProtoGoal, o: { userId: string; catId: CatIdLookup; nowIso: string },
): Omit<GoalRow, 'id' | 'deadline'> & { legacy_id: string; deadline: string | null } => {
  const { id: _id, ...row } = goalToRow(g, { userId: o.userId, catId: o.catId });
  // Every row in a batch carries the same keys (PostgREST bulk insert), hence the explicit created_at/deadline.
  return { ...row, deadline: g.deadline || null, created_at: row.created_at ?? o.nowIso, legacy_id: g.id };
};

export const eventInsert = (
  e: ProtoEvent, o: { userId: string; catId: CatIdLookup; seriesId: string | null; visibility: 'private' | 'public'; nowIso: string },
): OmitId<EventRow> & { created_at: string; win_asked: boolean } => {
  const { id: _id, win_asked, ...row } = eventToRow(e, {
    userId: o.userId, catId: o.catId, legacyId: e.id, seriesId: o.seriesId, visibility: o.visibility, updatedAt: o.nowIso,
  });
  return { ...row, win_asked: !!win_asked, created_at: e.at && Number.isFinite(e.at) ? new Date(e.at).toISOString() : o.nowIso };
};

/** What the old Google sync recorded for one event: the Google event id and, if present, its fingerprint. */
export interface LegacyLink { googleId: string; fingerprint: string | null }

/**
 * `gcal_links.map`: the old gcal function's `{ <app event id>: <google event id> }`. The value may also
 * be an object carrying the id (`id`/`gid`/`eventId`/`googleId`) and a fingerprint (`fp`/`fingerprint`/`hash`);
 * both shapes are accepted because the old function's source is not in this repo. Entries without a
 * usable Google event id are returned in `bad`.
 */
export const parseLinks = (map: unknown): { links: Map<string, LegacyLink>; bad: number } => {
  const links = new Map<string, LegacyLink>();
  let bad = 0;
  if (!isObj(map)) return { links, bad };
  for (const [eventId, v] of Object.entries(map)) {
    let gid: unknown = null, fp: unknown = null;
    if (typeof v === 'string') gid = v;
    else if (isObj(v)) {
      gid = v.id ?? v.gid ?? v.eventId ?? v.googleId ?? null;
      fp = v.fp ?? v.fingerprint ?? v.hash ?? null;
    }
    if (typeof gid === 'string' && gid) links.set(eventId, { googleId: gid, fingerprint: typeof fp === 'string' && fp ? fp : null });
    else bad++;
  }
  return { links, bad };
};
