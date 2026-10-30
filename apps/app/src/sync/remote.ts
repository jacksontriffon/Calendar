/**
 * `RemoteApi` on supabase-js: the only place that knows table and column
 * names on the wire. Failures are classified (`RemoteError.kind`) so the engine
 * can decide between retrying, refreshing the session and dropping a write.
 */
import type { Prefs } from '@calendar/core';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

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

const PAGE_SIZE = 1000;

interface PgError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Turn a PostgREST / transport failure into a `RemoteError`. */
export function toRemoteError(error: PgError | Error | unknown, status?: number): RemoteError {
  const e = (error ?? {}) as PgError & { name?: string; status?: number };
  const message = String(e.message || 'Request failed');
  const code = e.code ? String(e.code) : undefined;
  const http = status ?? e.status;
  if (http === 401 || code === 'PGRST301' || code === 'PGRST303' || /\bJWT\b/i.test(message)) {
    return new RemoteError('auth', message, { status: http, code });
  }
  // postgrest-js reports a failed fetch as status 0 (or throws with no status at all).
  if (http === 0 || (http === undefined && !code)) return new RemoteError('network', message, { status: http, code });
  if (http === 408 || http === 429 || (http !== undefined && http >= 500) || (code && /^(08|53|57|XX)/.test(code))) {
    return new RemoteError('server', message, { status: http, code });
  }
  return new RemoteError('rejected', message, { status: http, code });
}

type Res<T> = { data: T | null; error: PgError | null; status?: number };

function unwrap<T>(res: Res<T>): T {
  if (res.error) throw toRemoteError(res.error, res.status);
  return (res.data ?? ([] as unknown)) as T;
}

/** Awaiting a builder can also throw (fetch failures): normalise those too. */
async function call<T>(p: PromiseLike<Res<T>>): Promise<T> {
  try {
    return unwrap(await p);
  } catch (e) {
    if (e instanceof RemoteError) throw e;
    throw toRemoteError(e);
  }
}

let channelSeq = 0;

export function createSupabaseRemote(client: SupabaseClient, userId: string): RemoteApi {
  return {
    async fetchTable(table: TableName, opts = {}): Promise<RemoteRow[]> {
      if (table === 'profiles') {
        const rows = await call(client.from('profiles').select('id, prefs, updated_at').eq('id', userId));
        return rows as unknown as RemoteRow[];
      }
      const out: RemoteRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        let q = client.from(table).select('*');
        if (opts.since) q = q.gte('updated_at', opts.since);
        if (table === 'events' && opts.includeDeleted === false) q = q.is('deleted_at', null);
        const page = await call(q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1));
        const rows = page as unknown as RemoteRow[];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return out;
    },

    async upsert(table: SyncTable, rows): Promise<WriteResult[]> {
      const data = await call(client.from(table).upsert(rows, { onConflict: 'id', defaultToNull: false }).select('id, updated_at'));
      return data as unknown as WriteResult[];
    },

    async softDelete(ids, deletedAt): Promise<WriteResult[]> {
      const data = await call(client.from('events').update({ deleted_at: deletedAt }).in('id', ids).select('id, updated_at'));
      return data as unknown as WriteResult[];
    },

    async remove(table: SyncTable, ids): Promise<void> {
      await call(client.from(table).delete().in('id', ids));
    },

    async saveProfile(prefs: Prefs): Promise<WriteResult> {
      const data = await call(client.from('profiles').upsert({ id: userId, prefs: prefs as never }, { onConflict: 'id' }).select('id, updated_at'));
      const row = (data as unknown as WriteResult[])[0];
      if (!row) throw new RemoteError('rejected', 'Profile was not saved');
      return row;
    },

    subscribe(onChange, onStatus) {
      const channel: RealtimeChannel = client.channel(`calendar-sync-${userId}-${++channelSeq}`);
      const watch = (table: TableName, filter: string) => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
          const type = payload.eventType;
          if (type === 'DELETE') {
            const id = (payload.old as { id?: string } | undefined)?.id;
            if (id) onChange({ table, type: 'delete', id } satisfies RemoteChange);
            return;
          }
          const row = payload.new as RemoteRow | undefined;
          if (row && row.id) onChange({ table, type: 'upsert', id: row.id, row } satisfies RemoteChange);
        });
      };
      (['events', 'categories', 'goals', 'series'] as const).forEach((t) => watch(t, `user_id=eq.${userId}`));
      watch('profiles', `id=eq.${userId}`);
      channel.subscribe((status) => {
        const mapped: RealtimeStatus = status === 'SUBSCRIBED' ? 'subscribed' : status === 'CLOSED' ? 'closed' : 'error';
        onStatus(mapped);
      });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
