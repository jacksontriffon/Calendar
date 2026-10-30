/**
 * Import: Google -> `events` (source = 'google') for calendars with `show_in_app`.
 *
 * Sync flow per calendar
 *  1. No `sync_token` (or the last full sync is older than {@link FULL_RESYNC_DAYS}, because a sync
 *     token keeps the time window of its first request): full sync of a bounded window, 30 days back
 *     to 180 days ahead, `singleEvents=true` (recurring events arrive as instances). After a full
 *     sync, live imported events inside the window that Google did not return are soft-deleted
 *     (they were deleted while we were not looking).
 *  2. Otherwise incremental sync with the stored `syncToken`; changes include cancellations.
 *  3. `410 Gone` (token expired): clear the token and do a full sync.
 *  4. The new `nextSyncToken` is stored only after every page has been applied.
 *
 * Skipped on purpose: our own published copies (echo suppression), working-location markers, events
 * with no start. Cancelled events, and events this account declined, soft-delete the imported row.
 * Unchanged events (same etag) are not rewritten, so `updated_at` only moves for real changes.
 */
import { GoogleApiError } from './api.ts';
import type { SyncDeps } from './deps.ts';
import { isGone, isOwnCopy, mapGoogleEvent } from './mapping.ts';
import { safeTz, shiftDay, utcDay } from './tz.ts';
import { channelNeedsRenewal, renewWatch, stopWatch } from './watch.ts';
import { NeedsSigninError } from './tokens.ts';
import type { GoogleEvent, ImportedEventRow } from './types.ts';

export const BACK_DAYS = 30;
export const AHEAD_DAYS = 180;
export const FULL_RESYNC_DAYS = 14;

export interface ImportResult {
  status: 'ok' | 'skipped' | 'purged' | 'gone';
  reason?: string;
  full?: boolean;
  upserted: number;
  deleted: number;
}

export async function importCalendar(deps: SyncDeps, calendarId: string, o: { forceFull?: boolean } = {}): Promise<ImportResult> {
  const { db, api, tokens, now } = deps;
  const cal = await db.getCalendar(calendarId);
  if (!cal) return { status: 'gone', upserted: 0, deleted: 0 };
  const account = await db.getAccount(cal.account_id);
  if (!account) return { status: 'gone', upserted: 0, deleted: 0 };

  // Turned off: forget what we imported, drop the token and stop the channel.
  if (!cal.show_in_app) {
    let token: string | null = null;
    if (account.status === 'ok' && cal.channel_id) {
      try { token = await tokens.get(account.id); } catch (e) { if (!(e instanceof NeedsSigninError)) throw e; }
    }
    await stopWatch(deps, cal, token);
    await db.purgeImported(cal.id);
    if (cal.sync_token || cal.full_synced_at) await db.updateCalendar(cal.id, { sync_token: null, full_synced_at: null });
    return { status: 'purged', upserted: 0, deleted: 0 };
  }

  if (account.status !== 'ok') return { status: 'skipped', reason: 'needs_signin', upserted: 0, deleted: 0 };
  const token = await tokens.get(account.id);
  const tz = safeTz(await db.getTz(cal.user_id));
  const own = await db.listOwnExternalIds(cal.id);
  const email = account.email;

  const t0 = now();
  const timeMin = new Date(t0 - BACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(t0 + AHEAD_DAYS * 86400000).toISOString();
  const stale = !cal.full_synced_at || Date.parse(cal.full_synced_at) < t0 - FULL_RESYNC_DAYS * 86400000;

  let upserted = 0;
  let deleted = 0;

  const run = async (full: boolean): Promise<string | null> => {
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let next: string | null = null;
    do {
      const page = await api.listEvents(token, cal.google_id, full
        ? { timeMin, timeMax, pageToken }
        : { syncToken: cal.sync_token, pageToken });
      const r = await applyPage(page.items ?? [], seen);
      upserted += r.upserted;
      deleted += r.deleted;
      pageToken = page.nextPageToken;
      if (!pageToken) next = page.nextSyncToken ?? null;
    } while (pageToken);

    if (full) {
      // Imported events in the window that Google no longer returns were deleted at the source.
      const live = await db.listLiveImportedIds(cal.id, shiftDay(utcDay(Date.parse(timeMin)), 1), shiftDay(utcDay(Date.parse(timeMax)), -1));
      const missing = live.filter((id) => !seen.has(id));
      if (missing.length) {
        await db.softDeleteImported(cal.id, missing);
        deleted += missing.length;
      }
    }
    return next;
  };

  const applyPage = async (items: GoogleEvent[], seen: Set<string>): Promise<{ upserted: number; deleted: number }> => {
    const rows = new Map<string, ImportedEventRow>();
    const remove = new Set<string>();
    for (const item of items) {
      if (isOwnCopy(item, own)) {
        remove.add(item.id); // drop a stale echo row if one was imported before the copy was recognised
        continue;
      }
      if (isGone(item, email)) {
        remove.add(item.id);
        rows.delete(item.id);
        continue;
      }
      const row = mapGoogleEvent(item, { tz, accountEmail: email, userId: cal.user_id, calendarId: cal.id });
      if (!row) continue;
      seen.add(item.id);
      remove.delete(item.id);
      rows.set(item.id, row);
    }

    let wrote = 0;
    if (rows.size) {
      const states = await db.getImportedStates(cal.id, [...rows.keys()]);
      const changed = [...rows.values()].filter((r) => {
        const s = states.get(r.google_event_id);
        return !(s && !s.deleted && r.etag && s.etag === r.etag);
      });
      if (changed.length) await db.upsertImported(changed);
      wrote = changed.length;
    }
    if (remove.size) await db.softDeleteImported(cal.id, [...remove]);
    return { upserted: wrote, deleted: remove.size };
  };

  let full = o.forceFull || !cal.sync_token || stale;
  let nextToken: string | null;
  try {
    nextToken = await run(full);
  } catch (e) {
    if (!full && e instanceof GoogleApiError && e.status === 410) {
      deps.log('sync token expired, doing a full sync', cal.id);
      await db.updateCalendar(cal.id, { sync_token: null });
      full = true;
      nextToken = await run(true);
    } else {
      throw e;
    }
  }

  const stamp = new Date(now()).toISOString();
  await db.updateCalendar(cal.id, {
    sync_token: nextToken,
    last_synced_at: stamp,
    ...(full ? { full_synced_at: stamp } : {}),
  });

  // Keep the push channel alive (best effort: a failure here must not fail the import).
  try {
    if (channelNeedsRenewal(cal, now())) await renewWatch(deps, cal);
  } catch (e) {
    if (e instanceof NeedsSigninError) throw e;
    deps.log('could not create/renew the watch channel', e instanceof Error ? e.message : String(e));
  }

  return { status: 'ok', full, upserted, deleted };
}
