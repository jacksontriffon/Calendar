/**
 * legacy-import: a one-time, idempotent conversion of the caller's old web calendar
 * (`legacy_calendar_blobs.data`, the `aical.v1` JSON) into categories, goals, series and events,
 * plus the old Google sync links (`gcal_links.map`) as `event_targets`. POST, JWT required, no body.
 *
 *   200 { status: 'none' }                                      the user has no (usable) blob
 *   200 { status: 'done', events, goals, categories, series, targets, skipped, settings, created }
 *   500 { error: 'import_failed', stage, message }              stopped at `stage`; safe to retry
 *
 * Counts describe what the blob now has in the new tables (so a re-run reports the same numbers);
 * `created` is what this call actually inserted. `skipped` is the number of items left out
 * (`skippedDetail` has them by kind): events/goals/series that fail validation or are duplicates,
 * and Google links that can't be mapped (no primary Google calendar connected, an unknown event, or
 * an unusable entry).
 *
 * Idempotency: every row keeps the old id in `legacy_id` (unique per user), categories are matched
 * by name, targets by (event, calendar). Existing rows are never overwritten, so edits made in the
 * new app survive a re-run; a re-run only fills in what is missing.
 *
 * Google links: the old sync only ever used the primary calendar, so links map to the user's
 * primary `google_calendars` row (the oldest one if several accounts are connected). An event
 * that was on Google becomes `public`, so it stays linked to its Google copy; without a matching
 * calendar the link is skipped and counted. The old blob is never modified.
 */
import { dnum } from '@calendar/core';
import { errorResponse, HttpError, json, preflight } from '../_shared/http.ts';
import { MissingEnvError } from '../_shared/env.ts';
import type { BaseDeps, SupabaseClient } from '../_shared/supabase.ts';
import { catName, categoryInsert, eventInsert, goalInsert, isCalendarBlob, parseLinks, plan, seriesInsert } from './convert.ts';

export type LegacyImportDeps = BaseDeps;

const CHUNK = 200;
const chunks = <T>(a: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

type Stage = 'reading' | 'categories' | 'series' | 'goals' | 'events' | 'targets' | 'settings';

const fail = (stage: Stage, error: { message?: string } | null): never => {
  console.error(`[legacy-import] stopped at ${stage}`, error);
  throw new HttpError(500, 'import_failed', `Stopped while copying ${stage}. Nothing was lost; try again.`, { stage });
};

/** Run a query, throwing `import_failed` at `stage` on a database error. */
const ok = async <T>(stage: Stage, q: PromiseLike<{ data: T; error: { message?: string } | null }>): Promise<T> => {
  const r = await q;
  if (r.error) fail(stage, r.error);
  return r.data;
};

/** legacy_id -> row id, for the given legacy ids (queried in chunks, so PostgREST's row cap never matters). */
const legacyIds = async (admin: SupabaseClient, table: 'goals' | 'events' | 'series', userId: string, ids: string[], stage: Stage): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  for (const part of chunks(ids)) {
    const rows = await ok<Array<{ id: string; legacy_id: string }> | null>(stage, admin.from(table).select('id, legacy_id').eq('user_id', userId).in('legacy_id', part));
    for (const r of rows ?? []) out.set(r.legacy_id, r.id);
  }
  return out;
};

/** Insert the rows whose legacy id has no row yet. Returns the full legacy_id -> id map and how many were new. */
const insertMissing = async <R extends { legacy_id: string }>(
  admin: SupabaseClient, table: 'goals' | 'events' | 'series', userId: string, rows: R[], stage: Stage,
): Promise<{ ids: Map<string, string>; created: number }> => {
  const have = await legacyIds(admin, table, userId, rows.map((r) => r.legacy_id), stage);
  const fresh = rows.filter((r) => !have.has(r.legacy_id));
  for (const part of chunks(fresh, 500)) {
    // ignoreDuplicates: a concurrent run that got there first wins instead of failing this one.
    await ok(stage, admin.from(table).upsert(part, { onConflict: 'user_id,legacy_id', ignoreDuplicates: true }));
  }
  const ids = fresh.length ? await legacyIds(admin, table, userId, rows.map((r) => r.legacy_id), stage) : have;
  return { ids, created: fresh.length };
};

export const handle = async (req: Request, deps: LegacyImportDeps): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
    const user = await deps.auth(req);
    return json(await run(user.id, deps));
  } catch (e) {
    if (e instanceof MissingEnvError) return errorResponse(new HttpError(500, 'server_config', e.message));
    return errorResponse(e);
  }
};

const run = async (userId: string, deps: LegacyImportDeps) => {
  const admin = deps.admin();
  const now = deps.now();
  const nowIso = now.toISOString();

  const blobRow = await ok<{ data: unknown } | null>('reading', admin.from('legacy_calendar_blobs').select('data').eq('user_id', userId).maybeSingle());
  if (!blobRow || !isCalendarBlob(blobRow.data)) return { status: 'none' };
  const p = plan(blobRow.data, dnum(nowIso.slice(0, 10)));
  const skipped = { ...p.skipped };

  // ---- categories: reuse the user's existing rows by name, create the rest
  const names = p.categories.map((c) => c.name);
  const catIds = new Map<string, string>();
  const loadCats = async () => {
    for (const part of chunks(names, 100)) {
      const rows = await ok<Array<{ id: string; name: string }> | null>('categories', admin.from('categories').select('id, name').eq('user_id', userId).in('name', part));
      for (const r of rows ?? []) catIds.set(r.name, r.id);
    }
  };
  await loadCats();
  const missing = p.categories.filter((c) => !catIds.has(c.name));
  for (const part of chunks(missing, 200)) {
    await ok('categories', admin.from('categories').upsert(part.map((c) => categoryInsert(userId, c)), { onConflict: 'user_id,name', ignoreDuplicates: true }));
  }
  if (missing.length) await loadCats();
  const catId = (name: string | null | undefined): string | null => {
    const n = catName(name);
    return n ? catIds.get(n) ?? null : null;
  };

  // ---- series (before the events that point at them)
  const series = await insertMissing(admin, 'series', userId, p.series.map((s) => seriesInsert(s, userId)), 'series');

  // ---- goals
  const goals = await insertMissing(admin, 'goals', userId, p.goals.map((g) => goalInsert(g, { userId, catId: (n) => catId(n), nowIso })), 'goals');

  // ---- which events were on Google (they become public so they stay linked), and where
  const linkRow = await ok<{ map: unknown } | null>('targets', admin.from('gcal_links').select('map').eq('user_id', userId).maybeSingle());
  const { links, bad } = parseLinks(linkRow?.map);
  const cals = await ok<Array<{ id: string; created_at: string }> | null>('targets', admin.from('google_calendars').select('id, created_at').eq('user_id', userId).eq('is_primary', true));
  const calendarId = (cals ?? []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]?.id ?? null;
  const eventIds = new Set(p.events.map((e) => e.id));
  const linked = new Map([...links].filter(([id]) => calendarId !== null && eventIds.has(id)));
  skipped.targets = bad + (links.size - linked.size);

  // ---- events
  const events = await insertMissing(admin, 'events', userId, p.events.map((e) => ({
    ...eventInsert(e, {
      userId, catId: (n) => catId(n), seriesId: e.seriesId ? series.ids.get(e.seriesId) ?? null : null,
      visibility: linked.has(e.id) ? 'public' : 'private', nowIso,
    }),
    legacy_id: e.id,
  })), 'events');

  // ---- targets: the old Google links, onto the primary calendar
  let targets = 0;
  const targetRows = [...linked].flatMap(([eventLegacyId, l]) => {
    const eventId = events.ids.get(eventLegacyId);
    if (!eventId) { skipped.targets++; return []; }
    return [{
      user_id: userId, event_id: eventId, kind: 'google', google_calendar_id: calendarId, external_id: l.googleId,
      fingerprint: l.fingerprint, status: 'synced', synced_at: nowIso,
    }];
  });
  for (const part of chunks(targetRows, 500)) {
    await ok('targets', admin.from('event_targets').upsert(part, { onConflict: 'event_id,google_calendar_id', ignoreDuplicates: true }));
    targets += part.length;
  }

  // ---- settings: take the old view/font/zoom/sun/AI toggles only if the profile has none yet
  let settings = 0;
  const profile = await ok<{ prefs: unknown } | null>('settings', admin.from('profiles').select('prefs').eq('id', userId).maybeSingle());
  const prefs = profile?.prefs;
  if (profile && (!prefs || (typeof prefs === 'object' && !Object.keys(prefs as object).length))) {
    await ok('settings', admin.from('profiles').update({ prefs: p.hydrated.prefs }).eq('id', userId));
    settings = 1;
  }

  return {
    status: 'done',
    events: events.ids.size,
    goals: goals.ids.size,
    categories: p.categories.length,
    series: series.ids.size,
    targets,
    skipped: skipped.events + skipped.goals + skipped.series + skipped.targets,
    skippedDetail: skipped,
    settings,
    created: { events: events.created, goals: goals.created, series: series.created },
  };
};
