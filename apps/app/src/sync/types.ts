/**
 * Shared types for the sync layer: local row cache, outbox, and the
 * interfaces the engine depends on (remote API, key-value storage, network).
 * Everything here is platform independent so it can be unit-tested.
 */
import type { Prefs } from '@calendar/core';
import type { CalendarEvent, Category, Goal, Series as DbSeries } from '@calendar/db';

/** Tables the engine syncs row by row. `profiles` (prefs) is handled separately. */
export type SyncTable = 'categories' | 'series' | 'goals' | 'events';
export type TableName = SyncTable | 'profiles';

export type DbCategory = Category;
export type DbGoal = Goal;
export type DbSeriesRow = DbSeries;
export type DbEvent = CalendarEvent;

/** The part of `profiles` the app owns. */
export interface ProfileRow {
  id: string;
  prefs: Prefs;
  updated_at: string;
}

/** Local copy of the user's rows, keyed by row id (DB uuid). Soft-deleted events stay as tombstones. */
export interface Rows {
  categories: Record<string, DbCategory>;
  series: Record<string, DbSeriesRow>;
  goals: Record<string, DbGoal>;
  events: Record<string, DbEvent>;
  profile: ProfileRow | null;
}

export const emptyRows = (): Rows => ({ categories: {}, series: {}, goals: {}, events: {}, profile: null });

/** `updated_at` of a row that exists only locally (never accepted by the server). */
export const EPOCH = '1970-01-01T00:00:00.000Z';

/** Local app id (e.g. "g1x2y", "e42") <-> database uuid, for ids that are not uuids already. */
export interface Aliases {
  toDb: Record<string, string>;
  fromDb: Record<string, string>;
}
export const emptyAliases = (): Aliases => ({ toDb: {}, fromDb: {} });

/* ---------- outbox ---------- */

export interface OutboxOp {
  table: TableName;
  /** row id (DB uuid); the user id for `profiles` */
  id: string;
  /** `upsert` writes `payload`; `delete` soft-deletes an event (sets deleted_at) or removes the row */
  kind: 'upsert' | 'delete';
  /** columns the client owns for this row; never includes `updated_at` or server-only columns */
  payload: Record<string, unknown>;
  /** client clock (epoch ms) of the edit; compared with the server's `updated_at` for last-write-wins */
  editedAt: number;
  /** server `updated_at` the edit was based on; null for rows created locally */
  baseAt: string | null;
  /** incremented whenever the op is replaced, so an in-flight ack can tell it is stale */
  rev: number;
  /** insertion order */
  seq: number;
}

/* ---------- remote ---------- */

export type RemoteRow = { id: string; updated_at: string } & Record<string, unknown>;

export type RemoteErrorKind =
  /** no connection, timeout, DNS, 408/429-ish transport failures: retry later */
  | 'network'
  /** 401 / expired JWT: the session needs a refresh or a sign-in */
  | 'auth'
  /** 5xx: the server had a problem, retry with backoff */
  | 'server'
  /** 4xx (constraint, RLS, bad payload): retrying the same write will never work */
  | 'rejected';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;
  readonly status?: number;
  readonly code?: string;
  constructor(kind: RemoteErrorKind, message: string, extra: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
  }
}

export type RemoteChange =
  | { table: TableName; type: 'upsert'; id: string; row: RemoteRow }
  | { table: TableName; type: 'delete'; id: string };

export type RealtimeStatus = 'subscribed' | 'closed' | 'error';

export interface WriteResult {
  id: string;
  updated_at: string;
}

export interface RemoteApi {
  /** All of the user's rows of a table, or only those changed since `since` (events). */
  fetchTable(table: TableName, opts?: { since?: string | null; includeDeleted?: boolean }): Promise<RemoteRow[]>;
  /** Insert-or-update by id. Returns the server `updated_at` of every row. */
  upsert(table: SyncTable, rows: Record<string, unknown>[]): Promise<WriteResult[]>;
  /** Soft delete events (`deleted_at`). */
  softDelete(ids: string[], deletedAt: string): Promise<WriteResult[]>;
  /** Hard delete rows (categories, goals, series). */
  remove(table: SyncTable, ids: string[]): Promise<void>;
  saveProfile(prefs: Prefs): Promise<WriteResult>;
  /** Realtime changes for the user's rows. Returns the unsubscribe function. */
  subscribe(onChange: (change: RemoteChange) => void, onStatus: (status: RealtimeStatus) => void): () => void;
}

/* ---------- platform pieces ---------- */

/** Async string key-value storage (MMKV on native, IndexedDB on web). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** All keys (used to wipe a user's namespace). */
  keys(): Promise<string[]>;
}

export interface NetworkMonitor {
  isOnline(): boolean;
  /** Called with the new state when connectivity changes. Returns unsubscribe. */
  subscribe(listener: (online: boolean) => void): () => void;
}
