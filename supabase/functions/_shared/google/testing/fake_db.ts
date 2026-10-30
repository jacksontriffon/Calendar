/** In-memory GoogleDb for tests. Mirrors the relevant constraints (cascades, unique keys, soft deletes). */
import type { GoogleDb, OAuthStateRow } from '../db.ts';
import type { CalendarFields } from '../mapping.ts';
import type {
  AccountRow, AccountStatus, AppEvent, CalendarRow, ImportedEventRow, SeriesInfo, TargetPatch, TargetRow,
} from '../types.ts';

export type StoredImported = Omit<ImportedEventRow, 'deleted_at'> & { id: string; deleted_at: string | null; done?: boolean };

/** copies, like rows read from a database (no aliasing with the fake's own state) */
const cp = <T extends object>(x: T | null): T | null => (x ? { ...x } : null);

let seq = 0;
export const uid = (): string => {
  seq++;
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

export class FakeDb implements GoogleDb {
  tz = new Map<string, string>();
  accounts: AccountRow[] = [];
  tokens = new Map<string, string>();
  calendars: CalendarRow[] = [];
  imported: StoredImported[] = [];
  appEvents: AppEvent[] = [];
  series: SeriesInfo[] = [];
  targets: TargetRow[] = [];
  states = new Map<string, OAuthStateRow & { expires: number }>();
  locks = new Set<string>();
  /** every lock acquisition and release, in order */
  lockLog: string[] = [];
  acked: Array<{ queue: string; ids: number[] }> = [];
  importQueued: string[] = [];
  publishQueued: string[] = [];
  /** categories' default targets, to check disconnect clean-up is the database's job */
  now = () => Date.now();

  /* ---- fixtures ---- */
  addAccount(userId: string, email: string, status: AccountStatus = 'ok', refresh = 'refresh-' + email): AccountRow {
    const a: AccountRow = { id: uid(), user_id: userId, email, status };
    this.accounts.push(a);
    if (refresh) this.tokens.set(a.id, refresh);
    return a;
  }
  addCalendar(account: AccountRow, p: Partial<CalendarRow> & { google_id: string }): CalendarRow {
    const c: CalendarRow = {
      id: uid(), user_id: account.user_id, account_id: account.id, name: p.google_id, color: null, access_role: 'owner',
      is_primary: false, shared: false, show_in_app: true, can_publish: false, sync_token: null, channel_id: null,
      channel_resource_id: null, channel_expires_at: null, last_synced_at: null, full_synced_at: null, ...p,
    };
    this.calendars.push(c);
    return c;
  }
  addEvent(p: Partial<AppEvent> & { user_id: string }): AppEvent {
    const e: AppEvent = {
      id: uid(), title: 'Event', day: '2026-11-03', start_min: 540, end_min: 600, all_day: false, days: 1,
      visibility: 'private', source: 'app', series_id: null, deleted_at: null, ...p,
    };
    this.appEvents.push(e);
    return e;
  }
  addSeries(p: Partial<SeriesInfo>): SeriesInfo {
    const s: SeriesInfo = { id: uid(), weekdays: [1], start_day: '2026-11-02', until: null, ...p };
    this.series.push(s);
    return s;
  }
  addTarget(ev: AppEvent, cal: CalendarRow, p: Partial<TargetRow> = {}): TargetRow {
    const t: TargetRow = {
      id: uid(), user_id: ev.user_id, event_id: ev.id, google_calendar_id: cal.id, external_id: null, fingerprint: null,
      status: 'pending', error: null, synced_at: null, remove_requested: false, ...p,
    };
    this.targets.push(t);
    return t;
  }
  cal(id: string): CalendarRow { return this.calendars.find((c) => c.id === id)!; }
  target(id: string): TargetRow | undefined { return this.targets.find((t) => t.id === id); }
  liveImported(calendarId?: string): StoredImported[] {
    return this.imported.filter((e) => !e.deleted_at && (!calendarId || e.google_calendar_id === calendarId));
  }

  /* ---- GoogleDb ---- */
  getTz(userId: string) { return Promise.resolve(this.tz.get(userId) ?? 'UTC'); }

  getAccount(id: string) { return Promise.resolve(cp(this.accounts.find((a) => a.id === id) ?? null)); }
  listAccounts(userId: string) { return Promise.resolve(this.accounts.filter((a) => a.user_id === userId).map((a) => ({ ...a }))); }
  findAccountByEmail(userId: string, email: string) {
    return Promise.resolve(this.accounts.find((a) => a.user_id === userId && a.email === email) ?? null);
  }
  insertAccount(userId: string, email: string) {
    if (this.accounts.some((a) => a.user_id === userId && a.email === email)) throw new Error('duplicate account');
    const a: AccountRow = { id: uid(), user_id: userId, email, status: 'ok' };
    this.accounts.push(a);
    return Promise.resolve(a);
  }
  setAccountStatus(id: string, status: AccountStatus) {
    const a = this.accounts.find((x) => x.id === id);
    if (a) a.status = status;
    return Promise.resolve();
  }
  getRefreshToken(accountId: string) { return Promise.resolve(this.tokens.get(accountId) ?? null); }
  setRefreshToken(accountId: string, token: string) {
    this.tokens.set(accountId, token);
    return this.setAccountStatus(accountId, 'ok');
  }
  deleteAccount(id: string) {
    for (const c of this.calendars.filter((c) => c.account_id === id)) this.dropCalendar(c.id);
    this.accounts = this.accounts.filter((a) => a.id !== id);
    this.tokens.delete(id);
    return Promise.resolve();
  }

  getCalendar(id: string) { return Promise.resolve(cp(this.calendars.find((c) => c.id === id) ?? null)); }
  listCalendars(accountId: string) { return Promise.resolve(this.calendars.filter((c) => c.account_id === accountId).map((c) => ({ ...c }))); }
  listUserCalendars(userId: string) { return Promise.resolve(this.calendars.filter((c) => c.user_id === userId).map((c) => ({ ...c }))); }
  insertCalendar(userId: string, accountId: string, f: CalendarFields & { show_in_app: boolean; can_publish: boolean }) {
    const c: CalendarRow = {
      id: uid(), user_id: userId, account_id: accountId, sync_token: null, channel_id: null, channel_resource_id: null,
      channel_expires_at: null, last_synced_at: null, full_synced_at: null, ...f,
    };
    this.calendars.push(c);
    return Promise.resolve(c);
  }
  updateCalendar(id: string, patch: Partial<CalendarRow>) {
    const c = this.calendars.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
    return Promise.resolve();
  }
  private dropCalendar(id: string) {
    this.calendars = this.calendars.filter((c) => c.id !== id);
    this.imported = this.imported.filter((e) => e.google_calendar_id !== id);
    this.targets = this.targets.filter((t) => t.google_calendar_id !== id);
  }
  deleteCalendar(id: string) { this.dropCalendar(id); return Promise.resolve(); }
  findCalendarByChannel(channelId: string) { return Promise.resolve(cp(this.calendars.find((c) => c.channel_id === channelId) ?? null)); }
  enqueueImport(calendarId: string) { this.importQueued.push(calendarId); return Promise.resolve(); }
  retryFailedTargets(accountId: string) {
    const ids = new Set(this.calendars.filter((c) => c.account_id === accountId).map((c) => c.id));
    let n = 0;
    for (const t of this.targets) {
      if (ids.has(t.google_calendar_id) && t.status === 'failed') {
        t.status = 'pending';
        t.error = null;
        this.publishQueued.push(t.event_id);
        n++;
      }
    }
    return Promise.resolve(n);
  }

  tryLock(userId: string) {
    this.lockLog.push('try:' + userId);
    if (this.locks.has(userId)) return Promise.resolve(false);
    this.locks.add(userId);
    this.lockLog.push('lock:' + userId);
    return Promise.resolve(true);
  }
  releaseLock(userId: string) {
    this.locks.delete(userId);
    this.lockLog.push('release:' + userId);
    return Promise.resolve();
  }
  ack(queue: 'publish' | 'import', ids: number[]) {
    if (ids.length) this.acked.push({ queue, ids });
    return Promise.resolve();
  }

  getImportedStates(calendarId: string, ids: string[]) {
    const m = new Map<string, { etag: string | null; deleted: boolean }>();
    for (const e of this.imported) {
      if (e.google_calendar_id === calendarId && ids.includes(e.google_event_id)) m.set(e.google_event_id, { etag: e.etag, deleted: !!e.deleted_at });
    }
    return Promise.resolve(m);
  }
  upsertImported(rows: ImportedEventRow[]) {
    for (const r of rows) {
      const ex = this.imported.find((e) => e.google_calendar_id === r.google_calendar_id && e.google_event_id === r.google_event_id);
      if (ex) Object.assign(ex, r); // keeps id and user fields such as `done`
      else this.imported.push({ ...r, id: uid() });
    }
    return Promise.resolve();
  }
  softDeleteImported(calendarId: string, ids: string[]) {
    for (const e of this.imported) {
      if (e.google_calendar_id === calendarId && ids.includes(e.google_event_id) && !e.deleted_at) e.deleted_at = new Date(this.now()).toISOString();
    }
    return Promise.resolve();
  }
  listLiveImportedIds(calendarId: string, fromDay: string, toDay: string) {
    return Promise.resolve(this.imported
      .filter((e) => e.google_calendar_id === calendarId && !e.deleted_at && e.day >= fromDay && e.day <= toDay)
      .map((e) => e.google_event_id));
  }
  purgeImported(calendarId: string) {
    this.imported = this.imported.filter((e) => e.google_calendar_id !== calendarId);
    return Promise.resolve();
  }

  getEvent(userId: string, id: string) { return Promise.resolve(cp(this.appEvents.find((e) => e.id === id && e.user_id === userId) ?? null)); }
  listSeriesEvents(userId: string, seriesId: string) {
    return Promise.resolve(this.appEvents.filter((e) => e.user_id === userId && e.series_id === seriesId && e.source === 'app').map((e) => ({ ...e })));
  }
  getSeries(id: string) { return Promise.resolve(this.series.find((s) => s.id === id) ?? null); }
  listGoogleTargets(eventIds: string[]) { return Promise.resolve(this.targets.filter((t) => eventIds.includes(t.event_id)).map((t) => ({ ...t }))); }
  listOwnExternalIds(calendarId: string) {
    return Promise.resolve(new Set(this.targets.filter((t) => t.google_calendar_id === calendarId && t.external_id).map((t) => t.external_id!)));
  }
  updateTarget(id: string, patch: TargetPatch) {
    const t = this.targets.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    return Promise.resolve();
  }
  deleteTarget(id: string) { this.targets = this.targets.filter((t) => t.id !== id); return Promise.resolve(); }
  listUnsyncedTargetEventIds(userId: string) {
    return Promise.resolve([...new Set(this.targets.filter((t) => t.user_id === userId && t.status !== 'synced').map((t) => t.event_id))]);
  }

  createOAuthState(o: { hash: string; userId: string; returnUrl: string; accountId?: string | null; ttlSeconds: number }) {
    this.states.set(o.hash, { user_id: o.userId, account_id: o.accountId ?? null, return_url: o.returnUrl, expires: this.now() + o.ttlSeconds * 1000 });
    return Promise.resolve();
  }
  consumeOAuthState(hash: string) {
    const s = this.states.get(hash);
    this.states.delete(hash);
    if (!s || s.expires <= this.now()) return Promise.resolve(null);
    return Promise.resolve({ user_id: s.user_id, account_id: s.account_id, return_url: s.return_url });
  }
}
