/**
 * The local-first sync engine (hand-written outbox + pull sync; see SPIKE.md for
 * why this and not Legend-State).
 *
 *  - The user's rows are cached locally (`Rows`) and the app's `CalendarData` is
 *    derived from them. Every write updates the cache first (optimistic), then
 *    goes into an ordered outbox that is persisted and flushed to Supabase.
 *  - Writes are sent in dependency order (categories and series before goals before
 *    events; deletes last), one batch at a time. Network failures keep the outbox
 *    and retry with backoff and whenever connectivity returns.
 *  - Remote changes arrive through a pull (start, reconnect, foreground) and
 *    Supabase Realtime. Conflicts are last-write-wins per row: the server's
 *    `updated_at` against the time of the local edit. When the remote change wins
 *    over a local edit that had not synced yet, `onConflict` fires so the UI can
 *    tell the user and offer Undo.
 *  - Events are soft-deleted (`deleted_at`); categories, goals and series are
 *    hard-deleted, so those tables are re-read in full on every pull.
 *
 * Everything platform specific (Supabase, storage, connectivity) is injected.
 */
import { DEFAULT_PREFS, type CalendarData, type Prefs, type Series } from '@calendar/core';

import {
  cloneAliases,
  diffData,
  diffSeries,
  isReadOnlyRow,
  iso,
  payloadMatchesRow,
  payloadOfRow,
  rowLabel,
  rowToPrefs,
  rowsToData,
  rowsToSeries,
  ts,
  type DiffContext,
  type DiffResult,
} from './mapping';
import {
  EPOCH,
  RemoteError,
  emptyAliases,
  emptyRows,
  type Aliases,
  type KeyValueStore,
  type NetworkMonitor,
  type OutboxOp,
  type RealtimeStatus,
  type RemoteApi,
  type RemoteChange,
  type RemoteRow,
  type Rows,
  type SyncTable,
  type TableName,
  type WriteResult,
} from './types';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface ConflictInfo {
  table: TableName;
  rowId: string;
  label: string;
  /** Put the dropped local edit back (it is newer than the remote change now, so it wins). */
  undo: () => void;
}

export interface EngineOptions {
  userId: string;
  /** Storage already scoped to this user (see `scopedStore`). */
  kv: KeyValueStore;
  remote: RemoteApi;
  net: NetworkMonitor;
  now?: () => number;
  newId?: () => string;
  onConflict?: (c: ConflictInfo) => void;
  /** The server rejected our token (401). The controller refreshes or signs out. */
  onAuthError?: () => void;
  /** Backoff for retryable failures. `enabled: false` turns the timer off (tests). */
  retry?: { enabled?: boolean; baseMs?: number; maxMs?: number };
  /** Delay before changes are written to storage. */
  persistDelayMs?: number;
}

export interface RejectedWrite {
  table: TableName;
  id: string;
  message: string;
  at: number;
}

const STORAGE_KEY = 'state';
const STATE_VERSION = 1;
const PULL_OVERLAP_MS = 5000;
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;
const BATCH_SIZE = 50;

/** Send order: a lower rank goes first. */
function rankOf(op: OutboxOp, upsertNames: Set<string>): number {
  if (op.table === 'categories') {
    if (op.kind === 'upsert') return 1;
    return upsertNames.has(String(op.payload.name)) ? 0 : 6;
  }
  if (op.table === 'series') return op.kind === 'upsert' ? 1 : 5;
  if (op.table === 'goals') return op.kind === 'upsert' ? 2 : 4;
  return 3; // events and profiles
}

interface PersistedState {
  v: number;
  rows: Rows;
  aliases: Aliases;
  goalLinks: Record<string, string>;
  cursors: { events: string | null };
  outbox: OutboxOp[];
  seq: number;
}

const opKey = (table: TableName, id: string) => `${table}:${id}`;

export class SyncEngine {
  private readonly o: EngineOptions;
  private readonly now: () => number;
  private readonly newId: () => string;

  private rows: Rows = emptyRows();
  private aliases: Aliases = emptyAliases();
  private goalLinks: Record<string, string> = {};
  private cursors: { events: string | null } = { events: null };
  private outbox = new Map<string, OutboxOp>();
  private seq = 0;
  private inflight = new Set<string>();

  private listeners = new Set<() => void>();
  private cow: Set<string> | null = null;

  // derived caches
  private dataKey: unknown[] = [];
  private dataCache: CalendarData | null = null;
  private seriesKey: unknown[] = [];
  private seriesCache: Series[] | null = null;
  private prefsKey: unknown = null;
  private prefsCache: Prefs = DEFAULT_PREFS;

  // sync state
  private started = false;
  private stopped = false;
  private wiped = false;
  private busy = 0;
  private lastError: string | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private syncQueued: Promise<void> | null = null;
  private flushQueued: Promise<void> | null = null;
  private authBlocked = false;
  private resync = new Set<SyncTable>();
  private unsubs: (() => void)[] = [];
  private realtimeDown = false;
  private skew = 0;
  private skewSamples = 0;
  private statusCache: SyncStatus = 'idle';
  private rejected: RejectedWrite[] = [];
  private pulled = false;
  /** Set after being offline or out of touch with the server: the next flush pulls first, so last-write-wins sees remote changes. */
  private needsPull = true;
  private cacheLoaded = false;

  private constructor(o: EngineOptions) {
    this.o = o;
    this.now = o.now ?? (() => Date.now());
    this.newId =
      o.newId ??
      (() =>
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            }));
  }

  /** Build an engine and load its persisted state. Does not touch the network. */
  static async create(options: EngineOptions): Promise<SyncEngine> {
    const e = new SyncEngine(options);
    await e.load();
    return e;
  }

  get userId(): string {
    return this.o.userId;
  }

  /* ------------------------------------------------------------------
   * state access
   * ------------------------------------------------------------------ */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getData(): CalendarData {
    const key = [this.rows.categories, this.rows.goals, this.rows.events, this.aliases, this.goalLinks];
    if (!this.dataCache || key.some((k, i) => k !== this.dataKey[i])) {
      this.dataCache = rowsToData(this.rows, this.aliases, this.goalLinks);
      this.dataKey = key;
    }
    return this.dataCache;
  }

  getSeries(): Series[] {
    const key = [this.rows.series, this.aliases];
    if (!this.seriesCache || key.some((k, i) => k !== this.seriesKey[i])) {
      this.seriesCache = rowsToSeries(this.rows, this.aliases);
      this.seriesKey = key;
    }
    return this.seriesCache;
  }

  getPrefs(): Prefs {
    if (this.prefsKey !== this.rows.profile) {
      this.prefsCache = rowToPrefs(this.rows.profile);
      this.prefsKey = this.rows.profile;
    }
    return this.prefsCache;
  }

  getStatus(): SyncStatus {
    if (!this.o.net.isOnline() || this.lastError === 'network') return 'offline';
    if (this.lastError) return 'error';
    if (this.busy > 0 || (this.started && this.outbox.size > 0)) return 'syncing';
    return 'idle';
  }

  /** Writes that have not reached the server yet. */
  pendingCount(): number {
    return this.outbox.size;
  }

  getRejected(): readonly RejectedWrite[] {
    return this.rejected;
  }

  /** The persisted rows (read-only view, for tests and diagnostics). */
  getRows(): Rows {
    return this.rows;
  }

  getOutbox(): OutboxOp[] {
    return [...this.outbox.values()].sort((a, b) => a.seq - b.seq);
  }

  /** True when there was a local cache, or the first pull has completed. */
  isReady(): boolean {
    return this.cacheLoaded || this.pulled;
  }

  /* ------------------------------------------------------------------
   * local writes (optimistic)
   * ------------------------------------------------------------------ */

  private diffCtx(): DiffContext {
    return {
      userId: this.o.userId,
      rows: this.rows,
      aliases: this.aliases,
      goalLinks: this.goalLinks,
      newId: this.newId,
      now: this.now(),
    };
  }

  /** Apply the change from the current data to `next`. Returns the app ids of read-only events that were left alone. */
  applyData(next: CalendarData): { ignored: string[] } {
    const prev = this.getData();
    const diff = diffData(prev, next, this.diffCtx());
    this.applyDiff(diff);
    return { ignored: diff.ignored };
  }

  applySeries(next: Series[]): void {
    const diff = diffSeries(this.getSeries(), next, this.diffCtx());
    this.applyDiff(diff);
  }

  applyPrefs(next: Prefs): void {
    const cur = this.rows.profile;
    if (cur && JSON.stringify(cur.prefs) === JSON.stringify(next)) return;
    const at = this.now();
    this.batch(() => {
      this.rows = {
        ...this.rows,
        profile: { id: this.o.userId, prefs: next, updated_at: cur?.updated_at ?? EPOCH },
      };
      this.enqueue('profiles', this.o.userId, 'upsert', { prefs: next }, at, cur && cur.updated_at !== EPOCH ? cur.updated_at : null);
    });
    this.requestFlush();
  }

  private applyDiff(diff: DiffResult): void {
    const at = this.now();
    const changed =
      diff.upserts.length > 0 ||
      diff.removes.length > 0 ||
      Object.keys(diff.goalLinks).length > 0 ||
      Object.keys(diff.aliases.toDb).length !== Object.keys(this.aliases.toDb).length;
    if (!changed) return;
    this.batch(() => {
      this.aliases = diff.aliases;
      if (Object.keys(diff.goalLinks).length) {
        const links = { ...this.goalLinks };
        Object.entries(diff.goalLinks).forEach(([id, goal]) => {
          if (goal) links[id] = goal;
          else delete links[id];
        });
        this.goalLinks = links;
      }
      diff.upserts.forEach((u) => {
        const prevRow = this.rows[u.table][u.id] as { updated_at?: string } | undefined;
        const baseAt = prevRow && prevRow.updated_at && prevRow.updated_at !== EPOCH ? prevRow.updated_at : null;
        this.table(u.table)[u.id] = u.row as never;
        this.enqueue(u.table, u.id, 'upsert', u.payload, at, baseAt);
      });
      diff.removes.forEach((r) => {
        const row = this.rows[r.table][r.id] as { updated_at?: string; deleted_at?: string | null } | undefined;
        const baseAt = row && row.updated_at && row.updated_at !== EPOCH ? row.updated_at : null;
        const payload = r.table === 'events' ? { deleted_at: iso(at) } : r.name ? { name: r.name } : {};
        const dropped = this.enqueue(r.table, r.id, 'delete', payload, at, baseAt);
        if (r.table === 'events' && row && !dropped) {
          this.table('events')[r.id] = { ...(row as object), deleted_at: iso(at) } as never;
        } else {
          delete this.table(r.table)[r.id];
        }
      });
    });
    this.requestFlush();
  }

  /**
   * Put an op in the outbox, merging with a pending one for the same row.
   * Returns true when the op cancelled itself out (created and deleted before it was ever sent).
   */
  private enqueue(table: TableName, id: string, kind: OutboxOp['kind'], payload: Record<string, unknown>, editedAt: number, baseAt: string | null): boolean {
    const key = opKey(table, id);
    const existing = this.outbox.get(key);
    const base = existing ? existing.baseAt : baseAt;
    if (existing && kind === 'delete' && base === null && !this.inflight.has(key) && table !== 'profiles') {
      this.outbox.delete(key);
      return true;
    }
    if (!existing && kind === 'delete' && baseAt === null && table !== 'profiles') {
      // the row never reached the server and nothing is pending for it
      return true;
    }
    this.outbox.set(key, {
      table,
      id,
      kind,
      payload,
      editedAt,
      baseAt: base,
      rev: (existing?.rev ?? 0) + 1,
      seq: existing?.seq ?? ++this.seq,
    });
    return false;
  }

  /* ------------------------------------------------------------------
   * remote changes: last write wins per row
   * ------------------------------------------------------------------ */

  private clockOf(op: OutboxOp): number {
    return op.editedAt + this.skew;
  }

  /**
   * Apply one row from the server. Returns what happened:
   * `applied` (cache updated), `ignored` (stale, an echo of our own write, or the local edit is newer),
   * `conflict` (a remote change replaced a pending local edit).
   */
  private applyRemoteRow(table: TableName, remote: RemoteRow): 'applied' | 'ignored' | 'conflict' {
    const id = table === 'profiles' ? this.o.userId : remote.id;
    const key = opKey(table, id);
    const op = this.outbox.get(key);
    const local = this.getRow(table, id);
    const localAt = local ? local.updated_at : null;

    if (!op) {
      if (localAt && localAt !== EPOCH && ts(remote.updated_at) <= ts(localAt)) return 'ignored';
      this.putRow(table, id, remote);
      return 'applied';
    }

    // Our own write, seen before its response: just learn the new base.
    if (op.kind === 'upsert' && this.isEcho(op, remote)) {
      op.baseAt = remote.updated_at;
      return 'ignored';
    }
    if (op.kind === 'delete' && table === 'events' && remote.deleted_at) {
      op.baseAt = remote.updated_at;
      return 'ignored';
    }
    // Nothing newer than what the edit was based on.
    if (op.baseAt && ts(remote.updated_at) <= ts(op.baseAt)) return 'ignored';

    if (ts(remote.updated_at) > this.clockOf(op)) {
      // Remote is newer: it wins, the local edit is dropped and reported.
      const snapshot = local ? JSON.parse(JSON.stringify(local)) : null;
      const dropped = { ...op };
      this.outbox.delete(key);
      this.putRow(table, id, remote);
      this.reportConflict(table, id, snapshot, dropped, remote);
      return 'conflict';
    }
    // Local edit is newer: it stays and will overwrite the remote row.
    op.baseAt = remote.updated_at;
    return 'ignored';
  }

  private isEcho(op: OutboxOp, remote: RemoteRow): boolean {
    return payloadMatchesRow(op.payload, remote);
  }

  private reportConflict(table: TableName, id: string, localRow: unknown, op: OutboxOp, remote: RemoteRow): void {
    const labelSource = (op.kind === 'delete' ? remote : localRow ?? remote) as Record<string, unknown>;
    const label = rowLabel(table, table === 'profiles' ? null : labelSource);
    this.o.onConflict?.({
      table,
      rowId: id,
      label,
      undo: () => this.restoreLocal(table, id, localRow, op),
    });
  }

  /** Undo of a conflict: re-apply the edit that lost. It is stamped now, so it wins the next comparison. */
  private restoreLocal(table: TableName, id: string, localRow: unknown, op: OutboxOp): void {
    if (this.stopped) return;
    const current = this.getRow(table, id);
    const baseAt = current && current.updated_at !== EPOCH ? current.updated_at : null;
    const at = this.now();
    this.batch(() => {
      if (op.kind === 'delete') {
        if (table === 'events' && current) this.putRow(table, id, { ...current, deleted_at: iso(at) } as unknown as RemoteRow);
        else if (table !== 'events') this.dropRow(table, id);
      } else if (localRow) {
        this.putRow(table, id, { ...(localRow as object), updated_at: current?.updated_at ?? EPOCH } as RemoteRow);
      }
      this.enqueue(table, id, op.kind, op.payload, at, baseAt);
    });
    this.requestFlush();
  }

  private applyRemoteDelete(table: TableName, id: string): void {
    if (table === 'profiles') return;
    const key = opKey(table, id);
    const op = this.outbox.get(key);
    if (op && op.kind === 'upsert') {
      // Deleted elsewhere while we edited it. A delete carries no timestamp, so the edit wins and re-creates it.
      op.baseAt = null;
      return;
    }
    if (op) this.outbox.delete(key);
    this.dropRow(table, id);
  }

  private getRow(table: TableName, id: string): { updated_at: string } | undefined {
    if (table === 'profiles') return this.rows.profile ?? undefined;
    return this.rows[table][id] as unknown as { updated_at: string } | undefined;
  }

  private putRow(table: TableName, id: string, row: unknown): void {
    if (table === 'profiles') {
      const r = row as { prefs?: Prefs; updated_at: string };
      this.rows = { ...this.rows, profile: { id: this.o.userId, prefs: (r.prefs ?? this.rows.profile?.prefs ?? DEFAULT_PREFS) as Prefs, updated_at: r.updated_at } };
      return;
    }
    this.table(table)[id] = row as never;
  }

  private dropRow(table: TableName, id: string): void {
    if (table === 'profiles') return;
    if (this.rows[table][id]) delete this.table(table)[id];
  }

  /** The (copy-on-write) row map of a table, safe to mutate inside `batch`. */
  private table<T extends SyncTable>(t: T): Rows[T] {
    if (!this.cow) throw new Error('table() outside batch()');
    if (!this.cow.has(t)) {
      this.rows = { ...this.rows, [t]: { ...this.rows[t] } };
      this.cow.add(t);
    }
    return this.rows[t];
  }

  private batch(fn: () => void): void {
    const outer = this.cow;
    this.cow = outer ?? new Set();
    try {
      fn();
    } finally {
      if (!outer) {
        this.cow = null;
        this.changed();
      }
    }
  }

  private changed(): void {
    if (this.wiped) return;
    this.schedulePersist();
    this.emit();
  }

  private emit(): void {
    this.statusCache = this.getStatus();
    this.listeners.forEach((l) => l());
  }

  /* ------------------------------------------------------------------
   * pull
   * ------------------------------------------------------------------ */

  private async pullInner(): Promise<void> {
    if (this.stopped || !this.o.net.isOnline()) return;
    this.busy++;
    this.emit();
    try {
      const { remote } = this.o;
      const cursor = this.cursors.events;
      const haveEvents = Object.keys(this.rows.events).length > 0;
      const [cats, goals, series, profile, events] = await Promise.all([
        remote.fetchTable('categories'),
        remote.fetchTable('goals'),
        remote.fetchTable('series'),
        remote.fetchTable('profiles'),
        remote.fetchTable('events', {
          since: cursor ? iso(ts(cursor) - PULL_OVERLAP_MS) : null,
          includeDeleted: haveEvents || !!cursor,
        }),
      ]);
      if (this.stopped) return;
      this.batch(() => {
        this.reconcileFull('categories', cats);
        this.reconcileFull('series', series);
        this.reconcileFull('goals', goals);
        let max = cursor ? ts(cursor) : 0;
        let maxIso = cursor;
        events.forEach((r) => {
          this.applyRemoteRow('events', r);
          if (ts(r.updated_at) > max) {
            max = ts(r.updated_at);
            maxIso = r.updated_at;
          }
        });
        this.cursors = { events: maxIso };
        if (profile[0]) this.applyRemoteRow('profiles', profile[0]);
        this.pruneTombstones();
      });
      this.pulled = true;
      this.needsPull = false;
      this.authBlocked = false;
    } catch (e) {
      this.handleError(e);
      throw e;
    } finally {
      this.busy--;
      this.emit();
    }
  }

  /** Apply a full read of a hard-delete table: upserts, plus removal of rows that vanished remotely. */
  private reconcileFull(table: Exclude<SyncTable, 'events'>, remoteRows: RemoteRow[]): void {
    const seen = new Set<string>();
    remoteRows.forEach((r) => {
      seen.add(r.id);
      this.applyRemoteRow(table, r);
    });
    Object.keys(this.rows[table]).forEach((id) => {
      if (seen.has(id) || this.outbox.has(opKey(table, id))) return;
      this.dropRow(table, id);
    });
  }

  private pruneTombstones(): void {
    const cutoff = this.now() - TOMBSTONE_TTL_MS;
    Object.values(this.rows.events).forEach((e) => {
      if (e.deleted_at && ts(e.deleted_at) < cutoff && !this.outbox.has(opKey('events', e.id))) this.dropRow('events', e.id);
    });
  }

  /* ------------------------------------------------------------------
   * flush
   * ------------------------------------------------------------------ */

  private buildBatches(): OutboxOp[][] {
    const upsertNames = new Set<string>();
    this.outbox.forEach((op) => {
      if (op.table === 'categories' && op.kind === 'upsert') upsertNames.add(String(op.payload.name));
    });
    const ops = [...this.outbox.values()]
      .map((op) => ({ op, rank: rankOf(op, upsertNames) }))
      .sort((a, b) => a.rank - b.rank || a.op.seq - b.op.seq);
    const batches: OutboxOp[][] = [];
    let curKey = '';
    ops.forEach(({ op, rank }) => {
      const k = `${rank}|${op.table}|${op.kind}`;
      const last = batches[batches.length - 1];
      if (last && k === curKey && last.length < BATCH_SIZE && op.table !== 'profiles') last.push(op);
      else {
        batches.push([op]);
        curKey = k;
      }
    });
    return batches;
  }

  private async flushInner(): Promise<void> {
    if (this.stopped || this.authBlocked || !this.outbox.size || !this.o.net.isOnline()) return;
    this.busy++;
    this.emit();
    try {
      if (this.needsPull) await this.pullInner();
      let guard = this.outbox.size * 3 + 10;
      while (this.outbox.size && guard-- > 0 && !this.stopped) {
        const batch = this.buildBatches()[0];
        if (!batch) break;
        const ok = await this.send(batch);
        if (!ok) return;
      }
      if (this.resync.size) {
        // A write was rejected: re-read the server's version of those tables.
        if (this.resync.has('events')) this.cursors = { events: null };
        this.resync.clear();
        await this.pullInner();
      }
    } finally {
      this.busy--;
      this.emit();
    }
  }

  /** Send one batch. Returns false when the flush should stop (retryable failure). */
  private async send(batch: OutboxOp[]): Promise<boolean> {
    const first = batch[0];
    const sent = batch.map((op) => [op, op.rev] as const);
    batch.forEach((op) => this.inflight.add(opKey(op.table, op.id)));
    const t0 = this.now();
    try {
      const { remote } = this.o;
      let results: WriteResult[] = [];
      if (first.table === 'profiles') {
        results = [{ ...(await remote.saveProfile(first.payload.prefs as Prefs)), id: this.o.userId }];
      } else if (first.kind === 'upsert') {
        results = await remote.upsert(first.table, batch.map((o) => o.payload));
      } else if (first.table === 'events') {
        results = await remote.softDelete(batch.map((o) => o.id), iso(this.now()));
      } else {
        await remote.remove(first.table, batch.map((o) => o.id));
      }
      this.updateSkew(results, t0, this.now());
      this.batch(() => {
        sent.forEach(([op, rev]) => {
          const key = opKey(op.table, op.id);
          const res = results.find((r) => r.id === op.id);
          const cur = this.outbox.get(key);
          if (res) {
            const row = this.getRow(op.table, op.id);
            if (row && ts(res.updated_at) >= ts(row.updated_at)) {
              if (op.table === 'profiles') this.putRow('profiles', op.id, { ...this.rows.profile, updated_at: res.updated_at });
              else this.table(op.table as SyncTable)[op.id] = { ...(row as object), updated_at: res.updated_at } as never;
            }
          }
          if (cur && cur.rev === rev) this.outbox.delete(key);
          else if (cur && res) cur.baseAt = res.updated_at;
        });
      });
      this.lastError = null;
      this.attempt = 0;
      return true;
    } catch (e) {
      return this.onSendError(e, batch);
    } finally {
      batch.forEach((op) => this.inflight.delete(opKey(op.table, op.id)));
    }
  }

  private async onSendError(e: unknown, batch: OutboxOp[]): Promise<boolean> {
    const err = e instanceof RemoteError ? e : new RemoteError('server', e instanceof Error ? e.message : String(e));
    if (err.kind === 'rejected') {
      if (batch.length > 1) {
        for (const op of batch) {
          if (!(await this.send([op]))) return false;
        }
        return true;
      }
      this.reject(batch[0], err);
      return true;
    }
    this.handleError(err);
    return false;
  }

  /** A write the server will never accept: drop it and fall back to the server's version. */
  private reject(op: OutboxOp, err: RemoteError): void {
    this.rejected = [...this.rejected, { table: op.table, id: op.id, message: err.message, at: this.now() }].slice(-50);
    this.batch(() => {
      this.outbox.delete(opKey(op.table, op.id));
      if (op.baseAt === null && op.table !== 'profiles') this.dropRow(op.table, op.id);
      else if (op.table !== 'profiles') this.resync.add(op.table as SyncTable);
      else this.resync.add('events'); // profile: any pull refreshes it
    });
    this.lastError = `rejected: ${err.message}`;
  }

  private handleError(e: unknown): void {
    const err = e instanceof RemoteError ? e : new RemoteError(e instanceof TypeError ? 'network' : 'server', e instanceof Error ? e.message : String(e));
    if (err.kind === 'auth') {
      this.authBlocked = true;
      this.lastError = 'auth';
      this.o.onAuthError?.();
      return;
    }
    this.lastError = err.kind === 'network' ? 'network' : err.message || 'server';
    if (err.kind === 'network') this.needsPull = true;
    this.scheduleRetry();
  }

  private updateSkew(results: WriteResult[], t0: number, t1: number): void {
    const stamp = results.map((r) => ts(r.updated_at)).filter(Boolean)[0];
    if (!stamp) return;
    const sample = stamp - (t0 + t1) / 2;
    this.skew = this.skewSamples === 0 ? sample : this.skew * 0.7 + sample * 0.3;
    this.skewSamples++;
  }

  private scheduleRetry(): void {
    if (this.o.retry?.enabled === false || this.stopped || this.retryTimer) return;
    const base = this.o.retry?.baseMs ?? 1000;
    const max = this.o.retry?.maxMs ?? 30000;
    const delay = Math.min(max, base * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt = Math.min(this.attempt + 1, 10);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sync().catch(() => undefined);
    }, delay);
  }

  /* ------------------------------------------------------------------
   * scheduling
   * ------------------------------------------------------------------ */

  private run(task: () => Promise<void>): Promise<void> {
    const p = this.queue.then(task, task);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Pull remote changes, then push local ones. Safe to call any time; overlapping calls merge. */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.syncQueued) return this.syncQueued;
    this.authBlocked = false;
    const p = this.run(async () => {
      this.syncQueued = null;
      this.lastError = null;
      try {
        await this.pullInner();
        await this.flushInner();
      } catch {
        // handleError already recorded it and scheduled the retry
        return;
      }
      this.emit();
    });
    this.syncQueued = p;
    return p;
  }

  /** Push local changes (after a write). */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.flushQueued) return this.flushQueued;
    const p = this.run(async () => {
      this.flushQueued = null;
      try {
        await this.flushInner();
      } catch {
        /* recorded */
      }
    });
    this.flushQueued = p;
    return p;
  }

  private requestFlush(): void {
    if (!this.started) return;
    void this.flush();
  }

  /** Wait for everything queued so far (tests, shutdown). */
  async idle(): Promise<void> {
    await this.queue;
  }

  /** Start syncing: first pull, realtime, reconnect and retry handling. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.unsubs.push(
      this.o.net.subscribe((online) => {
        if (online) {
          this.attempt = 0;
          void this.sync();
        } else {
          this.needsPull = true;
          this.emit();
        }
      }),
    );
    this.unsubs.push(
      this.o.remote.subscribe(
        (change) => this.onRemoteChange(change),
        (status: RealtimeStatus) => {
          if (status === 'subscribed') {
            if (this.realtimeDown) void this.sync();
            this.realtimeDown = false;
          } else {
            this.realtimeDown = true;
            this.needsPull = true;
          }
        },
      ),
    );
    void this.sync().catch(() => undefined);
  }

  private onRemoteChange(change: RemoteChange): void {
    if (this.stopped) return;
    this.batch(() => {
      if (change.type === 'delete') {
        this.applyRemoteDelete(change.table, change.id);
        return;
      }
      this.applyRemoteRow(change.table, change.row);
      if (change.table === 'events' && (!this.cursors.events || ts(change.row.updated_at) > ts(this.cursors.events))) {
        this.cursors = { events: change.row.updated_at };
      }
    });
  }

  /** Called when the app returns to the foreground or the user pulls to refresh. */
  refresh(): Promise<void> {
    return this.sync().catch(() => undefined);
  }

  /** Stop timers and subscriptions and write the state out. The data stays on disk. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    await this.queue.catch(() => undefined);
    await this.flushPersist();
  }

  /** Sign-out: stop, and delete this user's cached rows, outbox and history from the device. */
  async wipe(): Promise<void> {
    this.wiped = true;
    this.stopped = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    await this.queue.catch(() => undefined);
    const keys = await this.o.kv.keys();
    await Promise.all(keys.map((k) => this.o.kv.removeItem(k)));
    this.rows = emptyRows();
    this.outbox.clear();
    this.aliases = emptyAliases();
    this.goalLinks = {};
    this.listeners.clear();
  }

  /* ------------------------------------------------------------------
   * persistence
   * ------------------------------------------------------------------ */

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.o.kv.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as PersistedState;
      if (s.v !== STATE_VERSION || !s.rows) return;
      this.rows = { ...emptyRows(), ...s.rows };
      this.aliases = s.aliases ? cloneAliases(s.aliases) : emptyAliases();
      this.goalLinks = s.goalLinks ?? {};
      this.cursors = s.cursors ?? { events: null };
      this.seq = s.seq ?? 0;
      (s.outbox ?? []).forEach((op) => this.outbox.set(opKey(op.table, op.id), op));
      this.cacheLoaded = true;
    } catch {
      // unreadable cache: start from the server
      this.rows = emptyRows();
      this.outbox.clear();
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer || this.wiped) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, this.o.persistDelayMs ?? 150);
  }

  /** Write the state to storage now. */
  async flushPersist(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.wiped) return;
    const state: PersistedState = {
      v: STATE_VERSION,
      rows: this.rows,
      aliases: this.aliases,
      goalLinks: this.goalLinks,
      cursors: this.cursors,
      outbox: [...this.outbox.values()],
      seq: this.seq,
    };
    try {
      await this.o.kv.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable: the in-memory state is still correct
    }
  }

  /** Used by tests: is a row read-only (Google import / someone else's)? */
  isReadOnly(eventRowId: string): boolean {
    const r = this.rows.events[eventRowId];
    return !!r && isReadOnlyRow(r);
  }

  /** Used by tests and diagnostics. */
  describeRow(table: SyncTable, id: string): Record<string, unknown> | null {
    const r = this.rows[table][id];
    return r ? payloadOfRow(table, r) : null;
  }
}
