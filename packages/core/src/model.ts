/**
 * Data model.
 *
 * Two layers live here:
 *
 *  1. The prototype's in-memory shapes (`ProtoEvent`, `ProtoGoal`, `CalendarData`, …).
 *     Everything else in this package (goal maths, ops, check-in) works on these.
 *  2. The Supabase row shapes from docs/expo-plan.md section 4 (`EventRow`, `GoalRow`, …),
 *     plus mappers between the two layers.
 *
 * Times stay floating local time: `day` is `YYYY-MM-DD`, `start`/`end` (rows:
 * `start_min`/`end_min`) are minutes past midnight measured from the start day,
 * and `end` may exceed 1440 for events that run past midnight.
 */
import { addDays, clamp, dnum, endOfPeriod, hm, key, zNear, ZMAX, ZMIN } from './time.ts';
import type { CatMap } from './categories.ts';

/* =====================================================================
 * Prototype in-memory shapes
 * ===================================================================== */

/** `[from, to]` in minutes past the event's start-day midnight. */
export type Pause = [number, number];

/** A logged achievement for a session. */
export interface Win {
  text: string;
  /** epoch ms when it was logged */
  at: number;
  /** user-marked "core" win in the recap */
  core?: boolean | string;
}

export interface ProtoEvent {
  id: string;
  /** `YYYY-MM-DD` of the start day */
  day: string;
  /** category name (null when its category was deleted and none was left) */
  cat: string | null;
  title: string;
  /** minutes past midnight of `day` */
  start: number;
  /** minutes past midnight of `day`; up to start + 1440 */
  end: number;
  /** all-day events use start 0 / end 1440 */
  allDay?: boolean;
  /** consecutive days covered by an all-day event (1..60) */
  days?: number;
  done?: boolean;
  pauses?: Pause[];
  win?: Win;
  /** a win question has already been asked for this session */
  winAsked?: boolean;
  /** epoch ms the event was created ("logged after the fact" check) */
  at?: number;
  /** explicit link to a goal, in addition to category/title matching */
  goalId?: string;
  /* --- fields the Expo app adds on top of the prototype --- */
  seriesId?: string | null;
  visibility?: Visibility;
  /** `'device'`: a read-only phone-calendar event, held in memory by the app and never stored or synced */
  source?: EventSource | 'device';
  isMine?: boolean;
}

export interface ProtoGoal {
  id: string;
  title: string;
  /** category its sessions are booked in; equals `title` for goals made in the app */
  cat: string;
  outcome: string;
  /** total hours estimated to reach the outcome */
  hours: number;
  /** `YYYY-MM-DD` the goal was set (pace starts here) */
  start: string;
  /** `YYYY-MM-DD`, inclusive */
  deadline: string;
  hue: number;
  /** epoch ms created */
  at?: number;
  /** legacy: goals used to cover a day/week/month/... instead of having a deadline */
  scope?: string;
}

/** The part of the app state that history/undo snapshots and the AI ops touch. */
export interface CalendarData {
  events: ProtoEvent[];
  cats: CatMap;
  goals: ProtoGoal[];
}

/** One undo entry. `before`/`after` are {@link CalendarData} snapshots. */
export interface HistoryEntry {
  id: string;
  t: number;
  label: string;
  kind: HistoryKind;
  before: CalendarData;
  after: CalendarData;
}
export type HistoryKind = 'claude' | 'parse' | 'delete' | 'drag' | 'edit' | 'undo' | 'sync';
export const KINDL: Record<HistoryKind, string> = {
  claude: 'Claude', parse: 'Parsed note', delete: 'Deleted', drag: 'Dragged', edit: 'Edited', undo: 'Reverted', sync: 'Synced',
};
/** History entries kept on the device. */
export const HMAX = 40;

/** Running event timer (device-local state). Times are epoch ms unless noted. */
export interface TimerState {
  id: string;
  endMs: number;
  total: number;
  evEnd: number;
  evDay: string;
  rang: boolean;
  paused: boolean;
  /** remaining ms while paused */
  rem: number;
  /** minutes-in-day where the current pause began */
  pStart?: number | null;
  open?: boolean;
}

/* ---------- user preferences (profiles.prefs) ---------- */

export type ViewKey = 'day3' | 'week';
export type ModelKey = 'haiku' | 'sonnet' | 'offline';

export interface ModelInfo { k: ModelKey; id: string; name: string; short: string; desc: string }
export const MODELS: readonly ModelInfo[] = [
  { k: 'haiku', id: 'claude-haiku-4-5', name: 'Haiku 4.5', short: 'Haiku 4.5', desc: 'Fastest for quick notes' },
  { k: 'sonnet', id: 'claude-sonnet-4-5', name: 'Sonnet 4.5', short: 'Sonnet 4.5', desc: 'For long or messy notes' },
  { k: 'offline', id: '', name: 'Offline parser', short: 'Offline', desc: 'On device, no network needed' },
];
export const modelInfo = (k: string): ModelInfo => MODELS.filter((m) => m.k === k)[0] || MODELS[0];

export interface SunPrefs { region: string; sunrise: number; sunset: number }

/** Everything the prototype keeps in `aical.v1` except the data itself, minus secrets (key/proxy/skills). */
export interface Prefs {
  view: ViewKey;
  font: string;
  zoom: number;
  sun: SunPrefs;
  ai: { on: boolean; model: ModelKey; ask: boolean; checkin: boolean };
}

export const DEFAULT_PREFS: Prefs = {
  view: 'day3',
  font: 'serif',
  zoom: 1,
  sun: { region: 'London', sunrise: 398, sunset: 1163 },
  ai: { on: true, model: 'haiku', ask: true, checkin: true },
};

/** The `aical.v1` localStorage blob / the legacy `calendars.data` JSON. All fields optional. */
export interface SavedBlob {
  v?: number;
  events?: unknown;
  cats?: CatMap;
  goals?: unknown;
  view?: string;
  font?: string;
  zoom?: number;
  sun?: { region?: string; sunrise?: number | null; sunset?: number | null };
  ai?: { on?: boolean; model?: string; ask?: boolean; checkin?: boolean; [k: string]: unknown };
}

/** Fill in the defaults a saved goal may be missing (legacy goals had `scope` instead of `deadline`). */
export const normalizeGoals = (list: unknown, today: Date): ProtoGoal[] => {
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown>>)
    .filter((g) => g && g.id && g.title)
    .map((g) => {
      const n = Object.assign({ cat: g.title, hours: 0, hue: 47, outcome: '' }, g) as Record<string, unknown> & ProtoGoal;
      if (!n.start) n.start = key(today);
      if (!n.deadline) n.deadline = key(addDays(endOfPeriod((n.scope as string) || 'week', dnum(n.start)), -1));
      delete n.scope;
      return n as ProtoGoal;
    });
};

export interface Hydrated {
  events?: ProtoEvent[];
  cats?: CatMap;
  goals?: ProtoGoal[];
  prefs: Prefs;
}

/**
 * Apply a saved blob over the defaults, the way the prototype's constructor
 * (and `sbApply`) did: only well-formed fields are taken, zoom snaps to a
 * level, goals get their defaults, the AI toggles are reconciled
 * (`offline` model means AI off, AI off means `offline` model).
 */
export const hydrateSaved = (saved: SavedBlob | null | undefined, today: Date, base: Prefs = DEFAULT_PREFS): Hydrated => {
  const prefs: Prefs = { ...base, sun: { ...base.sun }, ai: { ...base.ai } };
  const out: Hydrated = { prefs };
  if (!saved) return out;
  if (Array.isArray(saved.events)) out.events = saved.events as ProtoEvent[];
  if (saved.cats && Object.keys(saved.cats).length) out.cats = saved.cats;
  if (saved.view === 'week' || saved.view === 'day3') prefs.view = saved.view;
  if (saved.font) prefs.font = saved.font;
  if (typeof saved.zoom === 'number' && saved.zoom > 0) prefs.zoom = zNear(clamp(saved.zoom, ZMIN, ZMAX));
  if (Array.isArray(saved.goals)) out.goals = normalizeGoals(saved.goals, today);
  if (saved.ai) {
    if (saved.ai.on === false) prefs.ai.on = false;
    if (typeof saved.ai.model === 'string' && MODELS.some((m) => m.k === saved.ai!.model)) prefs.ai.model = saved.ai.model as ModelKey;
    if (prefs.ai.model === 'offline') prefs.ai.on = false;
    if (!prefs.ai.on) prefs.ai.model = 'offline';
    if (typeof saved.ai.ask === 'boolean') prefs.ai.ask = saved.ai.ask;
    if (typeof saved.ai.checkin === 'boolean') prefs.ai.checkin = saved.ai.checkin;
  }
  if (saved.sun && saved.sun.sunrise != null && saved.sun.sunset != null) {
    prefs.sun = { region: saved.sun.region || prefs.sun.region, sunrise: saved.sun.sunrise, sunset: saved.sun.sunset };
  }
  return out;
};

/** "6:38" / "19:23" labels for the sun settings. */
export const sunLabels = (sun: SunPrefs): { sunrise: string; sunset: string } => ({ sunrise: hm(sun.sunrise), sunset: hm(sun.sunset) });

/* ---------- snapshots (history / persistence) ---------- */

/** Persisted/snapshot form of an event: only the data fields, defaults filled (`allDay`, `days`, `done`). */
export const eventSnap = (e: ProtoEvent, withWinAsked = false): ProtoEvent => {
  const o: ProtoEvent = {
    id: e.id, day: e.day, cat: e.cat, title: e.title, start: e.start, end: e.end,
    allDay: !!e.allDay, days: e.days || 1, done: !!e.done,
    pauses: e.pauses && e.pauses.length ? e.pauses : undefined,
    win: e.win || undefined,
  };
  if (withWinAsked) o.winAsked = e.winAsked || undefined;
  return o;
};

/** The prototype's `dataSnap()`: a deep-enough copy of the data for history entries. */
export const dataSnap = (d: CalendarData): CalendarData => ({
  events: d.events.map((e) => eventSnap(e)),
  cats: Object.assign({}, d.cats),
  goals: (d.goals || []).map((g) => Object.assign({}, g)),
});

/** True when two snapshots are identical (the prototype compared JSON). */
export const sameSnap = (a: CalendarData, b: CalendarData): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Highest numeric part of the event ids ("e41" -> 41): where a new id counter should start. */
export const maxEventNum = (events: ReadonlyArray<{ id: string }>): number => {
  let max = 0;
  events.forEach((e) => {
    const n = parseInt(String(e.id).replace(/\D/g, ''), 10);
    if (n > max) max = n;
  });
  return max;
};

/** Counter-based id generator continuing from the existing events: "e1", "e2", … */
export const makeIdGen = (events: ReadonlyArray<{ id: string }>, start?: number): (() => string) => {
  let n = start != null ? start : maxEventNum(events);
  return () => 'e' + ++n;
};

/* =====================================================================
 * Supabase rows (docs/expo-plan.md section 4)
 * ===================================================================== */

export type Visibility = 'private' | 'public';
export type EventSource = 'app' | 'google';
export type TargetKind = 'google' | 'device';
export type TargetStatus = 'pending' | 'synced' | 'failed' | 'queued';

export interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** IANA time zone; floating times are converted with it at the Google boundary */
  tz: string;
  prefs: Prefs;
}

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  hue: number;
  default_visibility: Visibility;
  default_targets: string[];
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  outcome: string;
  deadline: string;
  hours: number;
  hue: number;
  category_id: string | null;
  start_date: string;
  created_at?: string;
}

export interface SeriesRow {
  id: string;
  user_id: string;
  freq: 'weekly';
  /** 0 = Sunday … 6 = Saturday (JS `getDay`) */
  weekdays: number[];
  start_day: string;
  until: string | null;
}

export interface EventRow {
  id: string;
  user_id: string;
  title: string;
  category_id: string | null;
  day: string;
  start_min: number;
  end_min: number;
  all_day: boolean;
  days: number;
  done: boolean;
  pauses: Pause[];
  win: Win | null;
  series_id: string | null;
  visibility: Visibility;
  source: EventSource;
  google_calendar_id: string | null;
  google_event_id: string | null;
  etag: string | null;
  organizer_email: string | null;
  is_mine: boolean;
  updated_at: string;
  deleted_at: string | null;
  legacy_id: string | null;
  /** Not in the plan's column list: db default `now()`; feeds `ProtoEvent.at`. */
  created_at?: string;
  /** Not in the plan's column list: whether the "what came out of this?" question was asked. */
  win_asked?: boolean;
}

export interface EventTargetRow {
  event_id: string;
  kind: TargetKind;
  google_calendar_id: string | null;
  device_id: string | null;
  device_calendar_key: string | null;
  external_id: string | null;
  fingerprint: string | null;
  status: TargetStatus;
  error: string | null;
  synced_at: string | null;
}

/** Same as {@link EventTargetRow} (the plan's `event_targets` table). */
export type EventTarget = EventTargetRow;

export interface HiddenItemRow {
  user_id: string;
  source: 'google' | 'device';
  external_key: string;
  hidden_at: string;
}

/** A weekly repeat, the in-memory twin of {@link SeriesRow}. */
export interface Series {
  id: string;
  freq: 'weekly';
  weekdays: number[];
  startDay: string;
  until: string | null;
}

/* ---------- mappers ---------- */

/** Looks a category name up in the user's category rows (name -> id). */
export type CatIdLookup = (name: string | null | undefined) => string | null;
/** Looks a category id up (id -> name). */
export type CatNameLookup = (id: string | null | undefined) => string | null;

export const catIdLookup = (rows: ReadonlyArray<Pick<CategoryRow, 'id' | 'name'>>): CatIdLookup => {
  const m = new Map<string, string>();
  rows.forEach((r) => m.set(r.name, r.id));
  return (name) => (name == null ? null : m.get(name) ?? null);
};
export const catNameLookup = (rows: ReadonlyArray<Pick<CategoryRow, 'id' | 'name'>>): CatNameLookup => {
  const m = new Map<string, string>();
  rows.forEach((r) => m.set(r.id, r.name));
  return (id) => (id == null ? null : m.get(id) ?? null);
};

export interface EventRowOpts {
  userId: string;
  catId: CatIdLookup;
  /** row id (uuid); defaults to the prototype id */
  id?: string;
  /** keep the prototype id here when migrating legacy data */
  legacyId?: string | null;
  seriesId?: string | null;
  visibility?: Visibility;
  /** ISO timestamp for `updated_at` (the caller owns the clock) */
  updatedAt: string;
}

/** Prototype event -> `events` row. All-day events keep start 0 / end 1440. */
export const eventToRow = (e: ProtoEvent, o: EventRowOpts): EventRow => ({
  id: o.id ?? e.id,
  user_id: o.userId,
  title: e.title,
  category_id: o.catId(e.cat),
  day: e.day,
  start_min: e.start,
  end_min: e.end,
  all_day: !!e.allDay,
  days: e.days || 1,
  done: !!e.done,
  pauses: e.pauses && e.pauses.length ? e.pauses : [],
  win: e.win || null,
  series_id: o.seriesId !== undefined ? o.seriesId : e.seriesId ?? null,
  visibility: o.visibility ?? e.visibility ?? 'private',
  source: e.source === 'google' ? 'google' : 'app',
  google_calendar_id: null,
  google_event_id: null,
  etag: null,
  organizer_email: null,
  is_mine: e.isMine ?? true,
  updated_at: o.updatedAt,
  deleted_at: null,
  legacy_id: o.legacyId !== undefined ? o.legacyId : null,
  win_asked: !!e.winAsked,
});

/** `events` row -> prototype event. Soft-deleted rows are the caller's to filter. */
export const rowToEvent = (r: EventRow, catName: CatNameLookup): ProtoEvent => {
  const e: ProtoEvent = {
    id: r.id,
    day: r.day,
    cat: catName(r.category_id),
    title: r.title,
    start: r.start_min,
    end: r.end_min,
    allDay: r.all_day,
    days: r.days || 1,
    done: r.done,
  };
  if (r.pauses && r.pauses.length) e.pauses = r.pauses;
  if (r.win) e.win = r.win;
  if (r.win_asked) e.winAsked = true;
  if (r.created_at) e.at = Date.parse(r.created_at) || undefined;
  if (r.series_id) e.seriesId = r.series_id;
  e.visibility = r.visibility;
  e.source = r.source;
  e.isMine = r.is_mine;
  return e;
};

/** Category map -> rows. Visibility defaults to private with no default targets. */
export const catsToRows = (
  cats: CatMap, userId: string, ids: (name: string) => string,
  existing: ReadonlyArray<CategoryRow> = [],
): CategoryRow[] =>
  Object.keys(cats).map((name) => {
    const prev = existing.find((r) => r.name === name);
    return {
      id: prev ? prev.id : ids(name),
      user_id: userId,
      name,
      hue: cats[name],
      default_visibility: prev ? prev.default_visibility : 'private',
      default_targets: prev ? prev.default_targets : [],
    };
  });

/** Category rows -> `{name: hue}` in the order given. */
export const rowsToCats = (rows: ReadonlyArray<Pick<CategoryRow, 'name' | 'hue'>>): CatMap => {
  const out: CatMap = {};
  rows.forEach((r) => { out[r.name] = r.hue; });
  return out;
};

export const goalToRow = (g: ProtoGoal, o: { userId: string; catId: CatIdLookup; id?: string }): GoalRow => ({
  id: o.id ?? g.id,
  user_id: o.userId,
  title: g.title,
  outcome: g.outcome || '',
  deadline: g.deadline,
  hours: Math.max(0, Number(g.hours) || 0),
  hue: g.hue,
  category_id: o.catId(g.cat),
  start_date: g.start,
  ...(g.at ? { created_at: new Date(g.at).toISOString() } : {}),
});

export const rowToGoal = (r: GoalRow, catName: CatNameLookup): ProtoGoal => {
  const g: ProtoGoal = {
    id: r.id,
    title: r.title,
    cat: catName(r.category_id) || r.title,
    outcome: r.outcome || '',
    hours: r.hours,
    start: r.start_date,
    deadline: r.deadline,
    hue: r.hue,
  };
  if (r.created_at) g.at = Date.parse(r.created_at) || undefined;
  return g;
};

export const seriesToRow = (s: Series, userId: string): SeriesRow => ({
  id: s.id, user_id: userId, freq: 'weekly', weekdays: s.weekdays.slice(), start_day: s.startDay, until: s.until,
});
export const rowToSeries = (r: SeriesRow): Series => ({
  id: r.id, freq: 'weekly', weekdays: r.weekdays.slice(), startDay: r.start_day, until: r.until,
});
