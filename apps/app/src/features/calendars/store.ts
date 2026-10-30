/**
 * Calendars data: Google accounts and calendars, the event targets, hidden events, imported-event
 * metadata and category defaults, loaded through supabase-js with Realtime, plus the writes the
 * Calendars screens and the visibility picker make. One shared store (`getCalendarsStore()`), so the
 * calendar view, the event sheet and Settings read the same rows and open one Realtime channel.
 *
 * What the client may write (supabase/README.md, RLS):
 *   google_calendars  only `show_in_app` / `can_publish`; then call `google-sync` `sync_now`
 *   hidden_items      full CRUD on own rows
 *   categories        `default_visibility` / `default_targets` (the sync layer never sends them)
 *   event_targets     read only for `google` rows; picked with the `set_event_google_targets` RPC
 *
 * It is a plain subscribable object (no React) so it can be tested against a fake client; the hooks
 * are in ./data.ts.
 */
import type { Visibility } from '@calendar/core';
import type { Database, EventTarget, GoogleAccountPublic, GoogleCalendar, HiddenItem } from '@calendar/db';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import type { LocalOp } from '../visibility/status';
import type { TargetsRpcArgs } from '../visibility/payload';
import { hiddenKey, type GoogleEventMeta } from './hidden';

export type CalendarsClient = SupabaseClient<Database>;

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface CategoryDefaults {
  id: string;
  name: string;
  visibility: Visibility;
  /** `google_calendars.id`s */
  targets: string[];
}

/** The client's own in-flight work on an event's Google targets. */
export interface TargetOp {
  state: Exclude<LocalOp, null | undefined>;
  calendarIds: string[];
  error?: string;
}

export interface CalendarsState {
  load: LoadState;
  /** why the first load failed (or the last refresh did) */
  error: string | null;
  accounts: GoogleAccountPublic[];
  calendars: GoogleCalendar[];
  targets: EventTarget[];
  hidden: HiddenItem[];
  /** imported events: calendar, Google event id and organizer, by `events.id` */
  meta: Record<string, GoogleEventMeta>;
  /** by category name */
  categories: Record<string, CategoryDefaults>;
  /** by event id */
  ops: Record<string, TargetOp>;
  syncing: boolean;
}

const initial = (): CalendarsState => ({
  load: 'idle',
  error: null,
  accounts: [],
  calendars: [],
  targets: [],
  hidden: [],
  meta: {},
  categories: {},
  ops: {},
  syncing: false,
});

const PAGE = 1000;
/** Retry delays (ms) while an event hasn't reached the server yet or the network is down. */
export const RETRY_DELAYS = [1500, 3000, 6000, 12000, 20000];

interface PgErr {
  message?: string;
  code?: string;
}

export interface StoreOptions {
  client: CalendarsClient;
  /** test hook: replaces setTimeout-based waiting */
  sleep?: (ms: number) => Promise<void>;
  retryDelays?: number[];
  /** ms to wait before `sync_now` after a toggle (so several toggles make one call) */
  syncDebounceMs?: number;
}

type Listener = () => void;

export class CalendarsStore {
  private state: CalendarsState = initial();
  private listeners = new Set<Listener>();
  private refs = 0;
  private channel: RealtimeChannel | null = null;
  private authUnsub: (() => void) | null = null;
  private userId: string | null = null;
  private loading: Promise<void> | null = null;
  private refetchTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private opToken: Record<string, number> = {};
  private readonly client: CalendarsClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delays: number[];
  private readonly syncDebounceMs: number;

  constructor(opts: StoreOptions) {
    this.client = opts.client;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.delays = opts.retryDelays ?? RETRY_DELAYS;
    this.syncDebounceMs = opts.syncDebounceMs ?? 800;
  }

  /* ---------------- subscribable ---------------- */

  getState = (): CalendarsState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private set(patch: Partial<CalendarsState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /* ---------------- lifecycle ---------------- */

  /** A screen or hook is using the data. Loads on the first user; the returned function releases. */
  acquire = (): (() => void) => {
    this.refs += 1;
    if (this.refs === 1) void this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs === 0) this.stop();
    };
  };

  private async start(): Promise<void> {
    try {
      const { data } = await this.client.auth.getSession();
      this.userId = data.session?.user.id ?? null;
    } catch {
      this.userId = null;
    }
    if (this.refs === 0) return;
    this.watchAuth();
    this.openChannel();
    await this.refresh();
  }

  private stop(): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.authUnsub?.();
    this.authUnsub = null;
    Object.values(this.refetchTimers).forEach((t) => t && clearTimeout(t));
    this.refetchTimers = {};
  }

  private watchAuth(): void {
    if (this.authUnsub || typeof this.client.auth?.onAuthStateChange !== 'function') return;
    const { data } = this.client.auth.onAuthStateChange((_e, session) => {
      const next = session?.user.id ?? null;
      if (next === this.userId) return;
      this.userId = next;
      this.state = initial();
      this.listeners.forEach((l) => l());
      if (this.channel) {
        void this.client.removeChannel(this.channel);
        this.channel = null;
      }
      if (this.refs > 0 && next) {
        this.openChannel();
        void this.refresh();
      }
    });
    this.authUnsub = () => data.subscription.unsubscribe();
  }

  /* ---------------- loading ---------------- */

  /** (Re)load everything. Safe to call often: concurrent calls share one load. */
  refresh = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.state.load === 'idle' || this.state.load === 'error') this.set({ load: 'loading', error: null });
    const run = async () => {
      const results = await Promise.allSettled([
        this.fetchAll<GoogleAccountPublic>('google_accounts_public', '*', 'created_at'),
        this.fetchAll<GoogleCalendar>('google_calendars', '*', 'created_at'),
        this.fetchAll<EventTarget>('event_targets', '*', 'created_at'),
        this.fetchAll<HiddenItem>('hidden_items', '*', 'hidden_at'),
        this.fetchMeta(),
        this.fetchCategories(),
      ]);
      const patch: Partial<CalendarsState> = {};
      let failure: string | null = null;
      const take = <T,>(i: number, apply: (v: T) => void) => {
        const r = results[i];
        if (r.status === 'fulfilled') apply(r.value as T);
        else failure = failure ?? errMessage(r.reason);
      };
      take<GoogleAccountPublic[]>(0, (v) => (patch.accounts = v));
      take<GoogleCalendar[]>(1, (v) => (patch.calendars = v));
      take<EventTarget[]>(2, (v) => (patch.targets = v));
      take<HiddenItem[]>(3, (v) => (patch.hidden = v));
      take<Record<string, GoogleEventMeta>>(4, (v) => (patch.meta = v));
      take<Record<string, CategoryDefaults>>(5, (v) => (patch.categories = v));
      const wasReady = this.state.load === 'ready';
      this.set({ ...patch, load: failure && !wasReady ? 'error' : 'ready', error: failure });
    };
    this.loading = run().finally(() => {
      this.loading = null;
    });
    return this.loading;
  };

  private async fetchAll<T>(table: string, cols: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const res = await (this.client.from(table as never) as never as {
        select(c: string): { order(c: string, o: { ascending: boolean }): { range(a: number, b: number): PromiseLike<{ data: T[] | null; error: PgErr | null }> } };
      })
        .select(cols)
        .order(order, { ascending: true })
        .range(from, from + PAGE - 1);
      if (res.error) throw new Error(res.error.message || 'Request failed');
      const rows = res.data ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  private async fetchMeta(): Promise<Record<string, GoogleEventMeta>> {
    const out: Record<string, GoogleEventMeta> = {};
    for (let from = 0; ; from += PAGE) {
      const res = await this.client
        .from('events')
        .select('id, google_calendar_id, google_event_id, organizer_email')
        .eq('source', 'google')
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (res.error) throw new Error(res.error.message || 'Request failed');
      const rows = res.data ?? [];
      rows.forEach((r) => {
        out[r.id] = { calendarId: r.google_calendar_id, googleEventId: r.google_event_id, organizerEmail: r.organizer_email };
      });
      if (rows.length < PAGE) break;
    }
    return out;
  }

  private async fetchCategories(): Promise<Record<string, CategoryDefaults>> {
    const res = await this.client.from('categories').select('id, name, default_visibility, default_targets');
    if (res.error) throw new Error(res.error.message || 'Request failed');
    const out: Record<string, CategoryDefaults> = {};
    (res.data ?? []).forEach((c) => {
      out[c.name] = { id: c.id, name: c.name, visibility: c.default_visibility === 'public' ? 'public' : 'private', targets: c.default_targets ?? [] };
    });
    return out;
  }

  /** Refetch one slice soon (debounced): used when Realtime can't tell us enough. */
  private refetchSoon(what: 'accounts' | 'targets', ms = 400): void {
    if (this.refetchTimers[what]) return;
    this.refetchTimers[what] = setTimeout(() => {
      this.refetchTimers[what] = undefined;
      if (what === 'accounts') {
        void this.fetchAll<GoogleAccountPublic>('google_accounts_public', '*', 'created_at').then((v) => this.set({ accounts: v })).catch(() => undefined);
      } else {
        void this.fetchAll<EventTarget>('event_targets', '*', 'created_at').then((v) => this.set({ targets: v })).catch(() => undefined);
      }
    }, ms);
  }

  /** Reload the accounts and calendars (after Connect / Disconnect / Sync now). */
  async reloadAccounts(): Promise<void> {
    try {
      const [accounts, calendars] = await Promise.all([
        this.fetchAll<GoogleAccountPublic>('google_accounts_public', '*', 'created_at'),
        this.fetchAll<GoogleCalendar>('google_calendars', '*', 'created_at'),
      ]);
      this.set({ accounts, calendars });
    } catch (e) {
      this.set({ error: errMessage(e) });
    }
  }

  /* ---------------- realtime ---------------- */

  private openChannel(): void {
    if (this.channel) return;
    const filter = this.userId ? { filter: `user_id=eq.${this.userId}` } : {};
    const on = (table: string, handler: (type: string, row: Record<string, unknown> | undefined, old: Record<string, unknown> | undefined) => void) => {
      this.channel!.on('postgres_changes', { event: '*', schema: 'public', table, ...filter } as never, ((p: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) =>
        handler(p.eventType, p.new, p.old)) as never);
    };
    this.channel = this.client.channel(`calendars-data-${++channelSeq}`);
    on('google_calendars', (type, row, old) => {
      this.set({ calendars: applyChange(this.state.calendars, type, row as GoogleCalendar | undefined, old) });
      // accounts live in a view Realtime can't watch; their status changes with their calendars
      this.refetchSoon('accounts');
    });
    on('event_targets', (type, row, old) => this.set({ targets: applyChange(this.state.targets, type, row as EventTarget | undefined, old) }));
    on('hidden_items', (type, row, old) => this.set({ hidden: applyChange(this.state.hidden, type, row as HiddenItem | undefined, old) }));
    on('events', (type, row, old) => {
      if (type === 'DELETE') {
        const id = old?.id as string | undefined;
        if (id && this.state.meta[id]) this.dropMeta(id);
        return;
      }
      if (!row || row.source !== 'google') return;
      const id = row.id as string;
      if (row.deleted_at) {
        if (this.state.meta[id]) this.dropMeta(id);
        return;
      }
      this.set({
        meta: {
          ...this.state.meta,
          [id]: {
            calendarId: (row.google_calendar_id as string | null) ?? null,
            googleEventId: (row.google_event_id as string | null) ?? null,
            organizerEmail: (row.organizer_email as string | null) ?? null,
          },
        },
      });
    });
    on('categories', (type, row) => {
      if (type === 'DELETE' || !row) {
        this.refetchCategoriesSoon();
        return;
      }
      const name = row.name as string;
      this.set({
        categories: {
          ...this.state.categories,
          [name]: {
            id: row.id as string,
            name,
            visibility: row.default_visibility === 'public' ? 'public' : 'private',
            targets: (row.default_targets as string[] | null) ?? [],
          },
        },
      });
    });
    this.channel.subscribe();
  }

  private dropMeta(id: string): void {
    const meta = { ...this.state.meta };
    delete meta[id];
    this.set({ meta });
  }

  private refetchCategoriesSoon(): void {
    void this.fetchCategories().then((categories) => this.set({ categories })).catch(() => undefined);
  }

  /* ---------------- google_calendars: Show in app / Can publish to ---------------- */

  /**
   * Toggle one of the two columns the client may update. Optimistic; reverts and rethrows on failure.
   * Then `sync_now`, debounced, so the change takes effect without waiting for the 15 minute sweep.
   */
  async setCalendarFlag(calendarId: string, patch: { show_in_app?: boolean; can_publish?: boolean }): Promise<void> {
    const before = this.state.calendars.find((c) => c.id === calendarId);
    if (!before) return;
    this.set({ calendars: this.state.calendars.map((c) => (c.id === calendarId ? { ...c, ...patch } : c)) });
    const res = await this.client.from('google_calendars').update(patch).eq('id', calendarId);
    if (res.error) {
      this.set({ calendars: this.state.calendars.map((c) => (c.id === calendarId ? before : c)) });
      throw new Error(res.error.message || 'Couldn’t save');
    }
    this.syncSoon();
  }

  private syncSoon(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      void this.syncNow().catch(() => undefined);
    }, this.syncDebounceMs);
  }

  /** "Sync now": `google-sync` `sync_now` for all of the user's calendars, then reload them. */
  async syncNow(): Promise<void> {
    this.set({ syncing: true });
    try {
      const { error } = await this.client.functions.invoke('google-sync', { body: { action: 'sync_now' } });
      if (error) throw new Error(errMessage(error));
    } finally {
      this.set({ syncing: false });
      await this.reloadAccounts();
    }
  }

  /** Disconnect an account: imported events go; copies already published stay on Google. */
  async disconnect(accountId: string): Promise<void> {
    const { error } = await this.client.functions.invoke('google-connect', { body: { action: 'disconnect', account_id: accountId } });
    if (error) throw new Error(errMessage(error));
    await Promise.all([this.reloadAccounts(), this.refresh()]);
  }

  /* ---------------- hidden events ---------------- */

  /** Hide an imported event. Optimistic: it leaves every view at once. Returns the row for Undo. */
  async hide(source: 'google' | 'device', externalKey: string): Promise<HiddenItem> {
    const existing = this.state.hidden.find((h) => h.source === source && h.external_key === externalKey);
    if (existing) return existing;
    const temp: HiddenItem = { id: 'local:' + hiddenKey(source, externalKey), user_id: this.userId ?? '', source, external_key: externalKey, hidden_at: new Date().toISOString() };
    this.set({ hidden: [...this.state.hidden, temp] });
    const res = await this.client.from('hidden_items').insert({ source, external_key: externalKey }).select().single();
    if (res.error || !res.data) {
      // a unique violation means it is already hidden: fine
      const dup = res.error?.code === '23505';
      if (!dup) {
        this.set({ hidden: this.state.hidden.filter((h) => h.id !== temp.id) });
        throw new Error(res.error?.message || 'Couldn’t hide the event');
      }
      void this.fetchAll<HiddenItem>('hidden_items', '*', 'hidden_at').then((hidden) => this.set({ hidden })).catch(() => undefined);
      return temp;
    }
    const row = res.data as HiddenItem;
    this.set({ hidden: this.state.hidden.map((h) => (h.id === temp.id ? row : h.id === row.id ? row : h)).filter((h, i, all) => all.findIndex((x) => x.id === h.id) === i) });
    return row;
  }

  /** Unhide: delete the row. Optimistic. */
  async unhide(item: Pick<HiddenItem, 'id' | 'source' | 'external_key'>): Promise<void> {
    const before = this.state.hidden;
    this.set({ hidden: before.filter((h) => !(h.source === item.source && h.external_key === item.external_key)) });
    if (item.id.startsWith('local:')) {
      // never confirmed by the server: delete by key
      const res = await this.client.from('hidden_items').delete().eq('source', item.source).eq('external_key', item.external_key);
      if (res.error) {
        this.set({ hidden: before });
        throw new Error(res.error.message || 'Couldn’t unhide');
      }
      return;
    }
    const res = await this.client.from('hidden_items').delete().eq('id', item.id);
    if (res.error) {
      this.set({ hidden: before });
      throw new Error(res.error.message || 'Couldn’t unhide');
    }
  }

  /* ---------------- event targets ---------------- */

  /**
   * Make `args.p_calendar_ids` the Google calendars the event is published to
   * (`set_event_google_targets`). Retry on the failures that heal: the event hasn't reached the
   * server yet (P0002), or the network is down. Anything else is a failure to show with Retry.
   * A newer call for the same event replaces one that is still waiting.
   */
  async setEventGoogleTargets(args: TargetsRpcArgs): Promise<'ok' | 'failed'> {
    const id = args.p_event_id;
    const token = (this.opToken[id] ?? 0) + 1;
    this.opToken[id] = token;
    const setOp = (op: TargetOp | null) => {
      if (this.opToken[id] !== token) return;
      const ops = { ...this.state.ops };
      if (op) ops[id] = op;
      else delete ops[id];
      this.set({ ops });
    };
    const ids = args.p_calendar_ids;
    setOp({ state: 'pending', calendarIds: ids });
    for (let attempt = 0; ; attempt++) {
      let err: PgErr | null = null;
      try {
        const res = await this.client.rpc('set_event_google_targets', args);
        err = res.error as PgErr | null;
      } catch (e) {
        err = { message: errMessage(e) };
      }
      if (this.opToken[id] !== token) return 'ok';
      if (!err) {
        setOp(null);
        this.refetchSoon('targets', 200);
        return 'ok';
      }
      const heals = err.code === 'P0002' || isNetworkError(err);
      if (!heals || attempt >= this.delays.length) {
        setOp({ state: 'failed', calendarIds: ids, error: err.message });
        return 'failed';
      }
      setOp({ state: err.code === 'P0002' ? 'pending' : 'queued', calendarIds: ids });
      await this.sleep(this.delays[attempt]);
      if (this.opToken[id] !== token) return 'ok';
    }
  }

  /* ---------------- category defaults (EV 06) ---------------- */

  async setCategoryDefault(categoryId: string, patch: { default_visibility?: Visibility; default_targets?: string[] }): Promise<void> {
    const res = await this.client.from('categories').update(patch).eq('id', categoryId);
    if (res.error) throw new Error(res.error.message || 'Couldn’t save');
    const name = Object.keys(this.state.categories).find((n) => this.state.categories[n].id === categoryId);
    if (name) {
      const cur = this.state.categories[name];
      this.set({
        categories: {
          ...this.state.categories,
          [name]: { ...cur, visibility: patch.default_visibility ?? cur.visibility, targets: patch.default_targets ?? cur.targets },
        },
      });
    }
  }
}

let channelSeq = 0;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : (e as PgErr | null)?.message || 'Request failed');

/** supabase-js reports a failed fetch without a Postgres code; so does a dropped connection. */
export function isNetworkError(e: PgErr | null | undefined): boolean {
  if (!e) return false;
  if (e.code) return false;
  return /fetch|network|failed to|timeout|offline|load failed/i.test(e.message ?? '');
}

/** Merge a Realtime change into a list of rows with `id`. */
export function applyChange<T extends { id: string }>(list: T[], type: string, row: T | undefined, old: Record<string, unknown> | undefined): T[] {
  if (type === 'DELETE') {
    const id = old?.id as string | undefined;
    return id ? list.filter((r) => r.id !== id) : list;
  }
  if (!row?.id) return list;
  const i = list.findIndex((r) => r.id === row.id);
  if (i < 0) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}
