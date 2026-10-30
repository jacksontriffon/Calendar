/**
 * Test support: an in-memory stand-in for the Supabase backend, with the
 * behaviour the engine relies on (server-side `updated_at`, soft delete,
 * foreign keys, unique category names, RLS on events, realtime fan-out) and a
 * switch to go offline. Not part of the app bundle.
 */
import type { Prefs } from '@calendar/core';

import {
  RemoteError,
  type RealtimeStatus,
  type RemoteApi,
  type RemoteChange,
  type RemoteRow,
  type SyncTable,
  type TableName,
  type WriteResult,
} from './types';

type Row = Record<string, unknown> & { id: string; updated_at: string };

export interface FakeServer {
  tables: Record<SyncTable | 'profiles', Record<string, Row>>;
  /** every call a client made, in order: `upsert events`, `softDelete`, ... */
  log: string[];
  clock: { ms: number };
  /** Advance the server clock and return an ISO stamp. */
  tick(by?: number): string;
  /** A client (one per device) bound to a user. */
  client(userId: string): FakeClient;
  /** Write a row the way another device or a service would (bumps updated_at, notifies clients). */
  write(table: SyncTable | 'profiles', row: Record<string, unknown> & { id: string }, userId?: string): Row;
}

export interface FakeClient extends RemoteApi {
  online: boolean;
  /** Fail the next calls with this error (then clear). */
  failWith: RemoteError | null;
  /** Deliver realtime events? (a dropped websocket misses them) */
  realtime: boolean;
}

export function createFakeServer(startMs = Date.parse('2026-10-30T10:00:00.000Z')): FakeServer {
  const tables: FakeServer['tables'] = { categories: {}, series: {}, goals: {}, events: {}, profiles: {} };
  const clock = { ms: startMs };
  const log: string[] = [];
  const clients = new Set<{ userId: string; onChange: (c: RemoteChange) => void; client: FakeClient }>();
  const tick = (by = 1000) => new Date((clock.ms += by)).toISOString();

  const notify = (table: TableName, type: 'upsert' | 'delete', row: Row, userId: string) => {
    clients.forEach((c) => {
      if (c.userId !== userId || !c.client.realtime || !c.client.online) return;
      c.onChange(type === 'upsert' ? { table, type, id: row.id, row } : { table, type, id: row.id });
    });
  };

  const defaults = (table: SyncTable, userId: string): Record<string, unknown> => {
    switch (table) {
      case 'categories':
        return { user_id: userId, default_visibility: 'private', default_targets: [] };
      case 'goals':
        return { user_id: userId, outcome: '', legacy_id: null };
      case 'series':
        return { user_id: userId };
      case 'events':
        return {
          user_id: userId,
          source: 'app',
          is_mine: true,
          google_calendar_id: null,
          google_event_id: null,
          etag: null,
          organizer_email: null,
          legacy_id: null,
          deleted_at: null,
          win_asked: false,
        };
    }
  };

  const check = (table: SyncTable, row: Record<string, unknown>, userId: string, isInsert: boolean) => {
    const bad = (msg: string, code: string) => new RemoteError('rejected', msg, { status: 409, code });
    if (row.deleted_at != null && Number.isNaN(Date.parse(String(row.deleted_at)))) throw bad('invalid timestamp', '22007');
    if (table === 'events') {
      if (isInsert && row.source !== 'app') throw bad('RLS: source must be app', '42501');
      const cat = row.category_id as string | null;
      if (cat && !tables.categories[cat]) throw bad('foreign key category', '23503');
      const ser = row.series_id as string | null;
      if (ser && !tables.series[ser]) throw bad('foreign key series', '23503');
      if (Number(row.end_min) <= Number(row.start_min)) throw bad('check end_min', '23514');
    }
    if (table === 'goals') {
      const cat = row.category_id as string | null;
      if (cat && !tables.categories[cat]) throw bad('foreign key category', '23503');
    }
    if (table === 'categories') {
      const dupe = Object.values(tables.categories).find((c) => c.name === row.name && c.id !== row.id && c.user_id === userId);
      if (dupe) throw bad('unique (user_id, name)', '23505');
    }
  };

  const doWrite = (table: SyncTable | 'profiles', payload: Record<string, unknown> & { id: string }, userId: string, service = false): Row => {
    const existing = tables[table][payload.id];
    let row: Row;
    if (table === 'profiles') {
      row = { ...(existing ?? { id: payload.id }), ...payload, updated_at: tick() } as Row;
    } else {
      const merged = { ...defaults(table, userId), ...(existing ?? { created_at: tick(0) }), ...payload };
      check(table, merged, userId, !existing && !service);
      row = { ...merged, updated_at: tick() } as Row;
    }
    tables[table][payload.id] = row;
    notify(table, 'upsert', row, userId);
    return row;
  };

  const server: FakeServer = {
    tables,
    log,
    clock,
    tick,
    write: (table, row, userId) => {
      const owner = userId ?? String(row.user_id ?? tables[table][row.id]?.user_id ?? (table === 'profiles' ? row.id : ''));
      return doWrite(table, row, owner, true);
    },
    client(userId) {
      const guard = () => {
        if (!client.online) throw new RemoteError('network', 'Failed to fetch');
        if (client.failWith) {
          const e = client.failWith;
          client.failWith = null;
          throw e;
        }
      };
      const mine = (table: SyncTable | 'profiles') =>
        Object.values(tables[table]).filter((r) => (table === 'profiles' ? r.id === userId : r.user_id === userId));
      const client: FakeClient = {
        online: true,
        failWith: null,
        realtime: true,
        async fetchTable(table, opts = {}) {
          guard();
          log.push(`fetch ${table}${opts.since ? ' since' : ''}`);
          let rows = mine(table);
          if (opts.since) rows = rows.filter((r) => Date.parse(r.updated_at) >= Date.parse(opts.since as string));
          if (table === 'events' && opts.includeDeleted === false) rows = rows.filter((r) => !r.deleted_at);
          return JSON.parse(JSON.stringify(rows)) as RemoteRow[];
        },
        async upsert(table, rows) {
          guard();
          log.push(`upsert ${table} ${rows.map((r) => String(r.id)).join(',')}`);
          // all-or-nothing, like one SQL statement
          const snapshot = JSON.stringify(tables[table]);
          try {
            return rows.map((r): WriteResult => {
              const out = doWrite(table, r as Record<string, unknown> & { id: string }, userId);
              return { id: out.id, updated_at: out.updated_at };
            });
          } catch (e) {
            tables[table] = JSON.parse(snapshot);
            throw e;
          }
        },
        async softDelete(ids, deletedAt) {
          guard();
          log.push(`softDelete ${ids.join(',')}`);
          return ids
            .filter((id) => tables.events[id])
            .map((id) => {
              const out = doWrite('events', { id, deleted_at: deletedAt }, userId);
              return { id, updated_at: out.updated_at };
            });
        },
        async remove(table, ids) {
          guard();
          log.push(`remove ${table} ${ids.join(',')}`);
          ids.forEach((id) => {
            const row = tables[table][id];
            if (!row) return;
            delete tables[table][id];
            if (table === 'categories') {
              Object.values(tables.events).forEach((e) => e.category_id === id && (e.category_id = null));
              Object.values(tables.goals).forEach((g) => g.category_id === id && (g.category_id = null));
            }
            notify(table, 'delete', row, userId);
          });
        },
        async saveProfile(prefs: Prefs) {
          guard();
          log.push('saveProfile');
          const out = doWrite('profiles', { id: userId, prefs }, userId);
          return { id: out.id, updated_at: out.updated_at };
        },
        subscribe(onChange, onStatus: (s: RealtimeStatus) => void) {
          const entry = { userId, onChange, client };
          clients.add(entry);
          onStatus('subscribed');
          return () => {
            clients.delete(entry);
          };
        },
      };
      return client;
    },
  };
  return server;
}
