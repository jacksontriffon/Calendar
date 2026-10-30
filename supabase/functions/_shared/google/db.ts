/**
 * The database interface the Google functions work against, and its Supabase (service-role)
 * implementation. All the sync logic depends on {@link GoogleDb} only, so tests run it against an
 * in-memory fake (testing/fake_db.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarFields } from './mapping.ts';
import type {
  AccountRow, AccountStatus, AppEvent, CalendarRow, ImportedEventRow, SeriesInfo, TargetPatch, TargetRow,
} from './types.ts';

export interface OAuthStateRow {
  user_id: string;
  account_id: string | null;
  return_url: string;
}

export interface GoogleDb {
  /* profile */
  getTz(userId: string): Promise<string>;

  /* accounts */
  getAccount(id: string): Promise<AccountRow | null>;
  listAccounts(userId: string): Promise<AccountRow[]>;
  findAccountByEmail(userId: string, email: string): Promise<AccountRow | null>;
  insertAccount(userId: string, email: string): Promise<AccountRow>;
  setAccountStatus(id: string, status: AccountStatus): Promise<void>;
  getRefreshToken(accountId: string): Promise<string | null>;
  /** Stores the refresh token in Vault and marks the account `ok`. */
  setRefreshToken(accountId: string, token: string): Promise<void>;
  /** Deletes the account; calendars, imported events and targets cascade, and the Vault secret goes with it. */
  deleteAccount(id: string): Promise<void>;

  /* calendars */
  getCalendar(id: string): Promise<CalendarRow | null>;
  listCalendars(accountId: string): Promise<CalendarRow[]>;
  listUserCalendars(userId: string): Promise<CalendarRow[]>;
  insertCalendar(userId: string, accountId: string, f: CalendarFields & { show_in_app: boolean; can_publish: boolean }): Promise<CalendarRow>;
  updateCalendar(id: string, patch: Partial<Omit<CalendarRow, 'id' | 'user_id' | 'account_id'>>): Promise<void>;
  deleteCalendar(id: string): Promise<void>;
  findCalendarByChannel(channelId: string): Promise<CalendarRow | null>;
  enqueueImport(calendarId: string): Promise<void>;
  /** After a reconnect: targets that failed because the account needed sign-in go back to pending (and are queued). */
  retryFailedTargets(accountId: string): Promise<number>;

  /* lock and queue */
  tryLock(userId: string): Promise<boolean>;
  releaseLock(userId: string): Promise<void>;
  ack(queue: 'publish' | 'import', msgIds: number[]): Promise<void>;

  /* imported events */
  getImportedStates(calendarId: string, googleEventIds: string[]): Promise<Map<string, { etag: string | null; deleted: boolean }>>;
  upsertImported(rows: ImportedEventRow[]): Promise<void>;
  softDeleteImported(calendarId: string, googleEventIds: string[]): Promise<void>;
  listLiveImportedIds(calendarId: string, fromDay: string, toDay: string): Promise<string[]>;
  purgeImported(calendarId: string): Promise<void>;

  /* app events and their Google targets */
  getEvent(userId: string, id: string): Promise<AppEvent | null>;
  listSeriesEvents(userId: string, seriesId: string): Promise<AppEvent[]>;
  getSeries(id: string): Promise<SeriesInfo | null>;
  listGoogleTargets(eventIds: string[]): Promise<TargetRow[]>;
  /** Google ids of our own published copies on a calendar (to suppress echoes on import). */
  listOwnExternalIds(calendarId: string): Promise<Set<string>>;
  updateTarget(id: string, patch: TargetPatch): Promise<void>;
  deleteTarget(id: string): Promise<void>;
  /** Events of a user that have a Google target which is not `synced` (pending, failed, queued). */
  listUnsyncedTargetEventIds(userId: string): Promise<string[]>;

  /* OAuth state */
  createOAuthState(o: { hash: string; userId: string; returnUrl: string; accountId?: string | null; ttlSeconds: number }): Promise<void>;
  consumeOAuthState(hash: string): Promise<OAuthStateRow | null>;
}

/* ===================================================================== Supabase */

class DbError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`${what}: ${cause.message}${cause.code ? ' (' + cause.code + ')' : ''}`);
    this.name = 'DbError';
  }
}

// deno-lint-ignore no-explicit-any
type Res<T = any> = { data: T; error: { message: string; code?: string } | null };

const ok = <T>(what: string, r: Res<T>): T => {
  if (r.error) throw new DbError(what, r.error);
  return r.data;
};

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const CAL_COLS = 'id,user_id,account_id,google_id,name,color,access_role,is_primary,shared,show_in_app,can_publish,sync_token,channel_id,channel_resource_id,channel_expires_at,last_synced_at,full_synced_at';
const EV_COLS = 'id,user_id,title,day,start_min,end_min,all_day,days,visibility,source,series_id,deleted_at';
const TARGET_COLS = 'id,user_id,event_id,google_calendar_id,external_id,fingerprint,status,error,synced_at,remove_requested';

export const supabaseDb = (admin: SupabaseClient): GoogleDb => ({
  async getTz(userId) {
    const r = await admin.from('profiles').select('tz').eq('id', userId).maybeSingle();
    return ok('profiles', r)?.tz ?? 'UTC';
  },

  async getAccount(id) {
    return ok('google_accounts', await admin.from('google_accounts').select('id,user_id,email,status').eq('id', id).maybeSingle());
  },
  async listAccounts(userId) {
    return ok('google_accounts', await admin.from('google_accounts').select('id,user_id,email,status').eq('user_id', userId).order('created_at')) ?? [];
  },
  async findAccountByEmail(userId, email) {
    return ok('google_accounts', await admin.from('google_accounts').select('id,user_id,email,status').eq('user_id', userId).eq('email', email).maybeSingle());
  },
  async insertAccount(userId, email) {
    return ok('google_accounts', await admin.from('google_accounts').insert({ user_id: userId, email }).select('id,user_id,email,status').single()) as AccountRow;
  },
  async setAccountStatus(id, status) {
    ok('google_accounts', await admin.from('google_accounts').update({ status }).eq('id', id));
  },
  async getRefreshToken(accountId) {
    const t = ok('get_google_refresh_token', await admin.rpc('get_google_refresh_token', { p_account_id: accountId }));
    return typeof t === 'string' && t ? t : null;
  },
  async setRefreshToken(accountId, token) {
    ok('set_google_refresh_token', await admin.rpc('set_google_refresh_token', { p_account_id: accountId, p_token: token }));
  },
  async deleteAccount(id) {
    ok('google_accounts', await admin.from('google_accounts').delete().eq('id', id));
  },

  async getCalendar(id) {
    return ok('google_calendars', await admin.from('google_calendars').select(CAL_COLS).eq('id', id).maybeSingle());
  },
  async listCalendars(accountId) {
    return ok('google_calendars', await admin.from('google_calendars').select(CAL_COLS).eq('account_id', accountId).order('is_primary', { ascending: false }).order('name')) ?? [];
  },
  async listUserCalendars(userId) {
    return ok('google_calendars', await admin.from('google_calendars').select(CAL_COLS).eq('user_id', userId)) ?? [];
  },
  async insertCalendar(userId, accountId, f) {
    return ok('google_calendars', await admin.from('google_calendars').insert({ user_id: userId, account_id: accountId, ...f }).select(CAL_COLS).single()) as CalendarRow;
  },
  async updateCalendar(id, patch) {
    ok('google_calendars', await admin.from('google_calendars').update(patch).eq('id', id));
  },
  async deleteCalendar(id) {
    ok('google_calendars', await admin.from('google_calendars').delete().eq('id', id));
  },
  async findCalendarByChannel(channelId) {
    return ok('google_calendars', await admin.from('google_calendars').select(CAL_COLS).eq('channel_id', channelId).maybeSingle());
  },
  async enqueueImport(calendarId) {
    ok('enqueue_import', await admin.rpc('enqueue_import', { p_calendar_id: calendarId }));
  },
  async retryFailedTargets(accountId) {
    const cals = await this.listCalendars(accountId);
    if (!cals.length) return 0;
    const rows = ok('event_targets', await admin.from('event_targets')
      .update({ status: 'pending', error: null })
      .in('google_calendar_id', cals.map((c) => c.id)).eq('kind', 'google').eq('status', 'failed')
      .select('event_id,user_id'));
    const seen = new Set<string>();
    for (const r of (rows ?? []) as Array<{ event_id: string; user_id: string }>) {
      if (seen.has(r.event_id)) continue;
      seen.add(r.event_id);
      ok('queue', await admin.rpc('enqueue_publish', { p_event_id: r.event_id, p_user_id: r.user_id }));
    }
    return seen.size;
  },

  async tryLock(userId) {
    return ok('try_sync_lock', await admin.rpc('try_sync_lock', { p_user_id: userId })) === true;
  },
  async releaseLock(userId) {
    ok('release_sync_lock', await admin.rpc('release_sync_lock', { p_user_id: userId }));
  },
  async ack(queue, msgIds) {
    if (!msgIds.length) return;
    ok('queue_ack', await admin.rpc('queue_ack', { p_queue: queue, p_msg_ids: msgIds }));
  },

  async getImportedStates(calendarId, ids) {
    const out = new Map<string, { etag: string | null; deleted: boolean }>();
    for (const part of chunks(ids, 100)) {
      const rows = ok('events', await admin.from('events').select('google_event_id,etag,deleted_at')
        .eq('google_calendar_id', calendarId).in('google_event_id', part));
      for (const r of (rows ?? []) as Array<{ google_event_id: string; etag: string | null; deleted_at: string | null }>) {
        out.set(r.google_event_id, { etag: r.etag, deleted: !!r.deleted_at });
      }
    }
    return out;
  },
  async upsertImported(rows) {
    for (const part of chunks(rows, 200)) {
      ok('events', await admin.from('events').upsert(part, { onConflict: 'google_calendar_id,google_event_id' }));
    }
  },
  async softDeleteImported(calendarId, ids) {
    const now = new Date().toISOString();
    for (const part of chunks(ids, 100)) {
      ok('events', await admin.from('events').update({ deleted_at: now })
        .eq('google_calendar_id', calendarId).eq('source', 'google').is('deleted_at', null).in('google_event_id', part));
    }
  },
  async listLiveImportedIds(calendarId, fromDay, toDay) {
    const out: string[] = [];
    for (let from = 0; ; from += 1000) {
      const rows = ok('events', await admin.from('events').select('google_event_id')
        .eq('google_calendar_id', calendarId).eq('source', 'google').is('deleted_at', null)
        .gte('day', fromDay).lte('day', toDay).order('id').range(from, from + 999)) as Array<{ google_event_id: string }> | null;
      for (const r of rows ?? []) out.push(r.google_event_id);
      if (!rows || rows.length < 1000) break;
    }
    return out;
  },
  async purgeImported(calendarId) {
    ok('events', await admin.from('events').delete().eq('google_calendar_id', calendarId).eq('source', 'google'));
  },

  async getEvent(userId, id) {
    return ok('events', await admin.from('events').select(EV_COLS).eq('id', id).eq('user_id', userId).maybeSingle());
  },
  async listSeriesEvents(userId, seriesId) {
    return ok('events', await admin.from('events').select(EV_COLS).eq('user_id', userId).eq('series_id', seriesId).eq('source', 'app').order('day').order('start_min')) ?? [];
  },
  async getSeries(id) {
    return ok('series', await admin.from('series').select('id,weekdays,start_day,until').eq('id', id).maybeSingle());
  },
  async listGoogleTargets(eventIds) {
    const out: TargetRow[] = [];
    for (const part of chunks(eventIds, 100)) {
      out.push(...((ok('event_targets', await admin.from('event_targets').select(TARGET_COLS).eq('kind', 'google').in('event_id', part)) ?? []) as TargetRow[]));
    }
    return out;
  },
  async listOwnExternalIds(calendarId) {
    const out = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const rows = ok('event_targets', await admin.from('event_targets').select('external_id')
        .eq('kind', 'google').eq('google_calendar_id', calendarId).not('external_id', 'is', null).order('id').range(from, from + 999)) as Array<{ external_id: string }> | null;
      for (const r of rows ?? []) out.add(r.external_id);
      if (!rows || rows.length < 1000) break;
    }
    return out;
  },
  async updateTarget(id, patch) {
    ok('event_targets', await admin.from('event_targets').update(patch).eq('id', id));
  },
  async deleteTarget(id) {
    ok('event_targets', await admin.from('event_targets').delete().eq('id', id));
  },
  async listUnsyncedTargetEventIds(userId) {
    const rows = ok('event_targets', await admin.from('event_targets').select('event_id')
      .eq('user_id', userId).eq('kind', 'google').neq('status', 'synced').limit(1000)) as Array<{ event_id: string }> | null;
    return [...new Set((rows ?? []).map((r) => r.event_id))];
  },

  async createOAuthState(o) {
    ok('create_google_oauth_state', await admin.rpc('create_google_oauth_state', {
      p_state_hash: o.hash, p_user_id: o.userId, p_return_url: o.returnUrl, p_account_id: o.accountId ?? null, p_ttl_seconds: o.ttlSeconds,
    }));
  },
  async consumeOAuthState(hash) {
    const rows = ok('consume_google_oauth_state', await admin.rpc('consume_google_oauth_state', { p_state_hash: hash })) as OAuthStateRow[] | null;
    return rows && rows.length ? rows[0] : null;
  },
});
