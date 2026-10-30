import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseRemote, toRemoteError } from './remote';

describe('toRemoteError', () => {
  it('classifies failures', () => {
    expect(toRemoteError({ message: 'TypeError: Failed to fetch', code: '' }, 0).kind).toBe('network');
    expect(toRemoteError(new TypeError('Network request failed')).kind).toBe('network');
    expect(toRemoteError({ message: 'JWT expired', code: 'PGRST301' }, 401).kind).toBe('auth');
    expect(toRemoteError({ message: 'x' }, 401).kind).toBe('auth');
    expect(toRemoteError({ message: 'boom', code: '' }, 503).kind).toBe('server');
    expect(toRemoteError({ message: 'slow down', code: '' }, 429).kind).toBe('server');
    expect(toRemoteError({ message: 'violates foreign key', code: '23503' }, 409).kind).toBe('rejected');
    expect(toRemoteError({ message: 'new row violates row-level security policy', code: '42501' }, 403).kind).toBe('rejected');
  });
});

/** A chainable stand-in for the PostgREST builder that records what was asked. */
function fakeClient(result: { data?: unknown; error?: unknown; status?: number } | ((calls: string[]) => unknown)) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    return builder;
  };
  ['from', 'select', 'upsert', 'update', 'delete', 'eq', 'in', 'gte', 'is', 'order', 'range'].forEach((m) => (builder[m] = chain(m)));
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, status: 200, ...(typeof result === 'function' ? (result(calls) as object) : result) });
  const channels: { handlers: unknown[]; subscribed: boolean }[] = [];
  const client = {
    from: (t: string) => {
      calls.push(`from(${JSON.stringify(t)})`);
      return builder;
    },
    channel: () => {
      const ch = { handlers: [] as unknown[], subscribed: false } as { handlers: unknown[]; subscribed: boolean; on?: unknown; subscribe?: unknown };
      channels.push(ch);
      ch.on = (_t: string, filter: unknown, cb: unknown) => {
        ch.handlers.push({ filter, cb });
        return ch;
      };
      ch.subscribe = (cb: (s: string) => void) => {
        ch.subscribed = true;
        cb('SUBSCRIBED');
        return ch;
      };
      return ch;
    },
    removeChannel: jest.fn(),
  };
  return { client: client as unknown as SupabaseClient, calls, channels };
}

describe('createSupabaseRemote', () => {
  it('upserts by id without nulling omitted columns', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'a', updated_at: '2026-10-30T10:00:00Z' }] });
    const res = await createSupabaseRemote(client, 'u').upsert('events', [{ id: 'a', title: 't' }]);
    expect(res).toEqual([{ id: 'a', updated_at: '2026-10-30T10:00:00Z' }]);
    expect(calls).toContain('upsert([{"id":"a","title":"t"}],{"onConflict":"id","defaultToNull":false})');
    expect(calls).toContain('select("id, updated_at")');
  });

  it('soft delete sets deleted_at on events only', async () => {
    const { client, calls } = fakeClient({ data: [] });
    await createSupabaseRemote(client, 'u').softDelete(['a', 'b'], '2026-10-30T10:00:00.000Z');
    expect(calls[0]).toBe('from("events")');
    expect(calls).toContain('update({"deleted_at":"2026-10-30T10:00:00.000Z"})');
    expect(calls).toContain('in("id",["a","b"])');
  });

  it('pulls events changed since a cursor, newest last, without tombstones when asked', async () => {
    const { client, calls } = fakeClient({ data: [] });
    await createSupabaseRemote(client, 'u').fetchTable('events', { since: '2026-10-30T10:00:00.000Z', includeDeleted: false });
    expect(calls).toEqual(expect.arrayContaining(['gte("updated_at","2026-10-30T10:00:00.000Z")', 'is("deleted_at",null)', 'order("updated_at",{"ascending":true})']));
  });

  it('turns a PostgREST error into a RemoteError the engine can act on', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 });
    await expect(createSupabaseRemote(client, 'u').remove('goals', ['a'])).rejects.toMatchObject({ kind: 'auth' });
  });

  it('subscribes to the user rows only and maps realtime payloads', () => {
    const { client, channels } = fakeClient({ data: [] });
    const changes: unknown[] = [];
    const statuses: string[] = [];
    const off = createSupabaseRemote(client, 'u1').subscribe((c) => changes.push(c), (s) => statuses.push(s));
    const handlers = channels[0].handlers as { filter: { table: string; filter: string }; cb: (p: unknown) => void }[];
    expect(handlers.map((h) => `${h.filter.table}:${h.filter.filter}`)).toEqual([
      'events:user_id=eq.u1',
      'categories:user_id=eq.u1',
      'goals:user_id=eq.u1',
      'series:user_id=eq.u1',
      'profiles:id=eq.u1',
    ]);
    handlers[0].cb({ eventType: 'UPDATE', new: { id: 'e1', updated_at: 't' }, old: {} });
    handlers[1].cb({ eventType: 'DELETE', new: {}, old: { id: 'c1' } });
    expect(changes).toEqual([
      { table: 'events', type: 'upsert', id: 'e1', row: { id: 'e1', updated_at: 't' } },
      { table: 'categories', type: 'delete', id: 'c1' },
    ]);
    expect(statuses).toEqual(['subscribed']);
    off();
  });
});
