import { NATIVE_RETURN_URL, parseConnectReturn, returnUrlFor, runConnect, type ConnectDeps } from './connect';
import { filterHidden, hiddenKey, hiddenKeySet } from './hidden';
import { normalizeHex, paintFromHex } from './colors';
import { deriveOverlay } from './overlayModel';
import { buildAccountViews, publishableCalendars, syncedLabel } from './view';
import { CalendarsStore, applyChange, type CalendarsClient } from './store';

describe('hidden events', () => {
  const meta = { e1: { calendarId: 'c', googleEventId: 'g1', organizerEmail: null }, e2: { calendarId: 'c', googleEventId: 'g2', organizerEmail: null } };
  const events = [
    { id: 'e1', source: 'google' as const },
    { id: 'e2', source: 'google' as const },
    { id: 'e3', source: 'app' as const },
  ];

  it('filters hidden Google events out, and only those', () => {
    const set = hiddenKeySet([{ source: 'google', external_key: 'g1' }]);
    expect(filterHidden(events, meta, set).map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('never hides the app’s own events, and keeps the same array when nothing matches', () => {
    expect(filterHidden(events, meta, new Set([hiddenKey('google', 'e3')]))).toBe(events);
    expect(filterHidden(events, meta, new Set())).toBe(events);
    // a device key with the same text is a different source
    expect(filterHidden(events, meta, new Set([hiddenKey('device', 'g1')]))).toBe(events);
  });
});

describe('connect flow', () => {
  it('uses the allow-listed return URLs', () => {
    expect(returnUrlFor('native')).toBe('aicalendar://google/connected');
    expect(NATIVE_RETURN_URL).toBe('aicalendar://google/connected');
    expect(returnUrlFor('web', 'https://www.claude-calendar.com/')).toBe('https://www.claude-calendar.com/settings/calendars');
  });

  it('reads the callback result', () => {
    expect(parseConnectReturn('aicalendar://google/connected?connected=1&account_id=abc')).toEqual({ kind: 'connected', accountId: 'abc' });
    expect(parseConnectReturn('https://x.app/settings/calendars?connected=1&account_id=abc')).toEqual({ kind: 'connected', accountId: 'abc' });
    expect(parseConnectReturn('aicalendar://google/connected?error=access_denied')).toEqual({ kind: 'cancelled' });
    expect(parseConnectReturn('aicalendar://google/connected?error=wrong_account')).toMatchObject({ kind: 'error', code: 'wrong_account' });
    expect(parseConnectReturn('aicalendar://google/connected')).toBeNull();
    expect(parseConnectReturn(undefined)).toBeNull();
  });

  const deps = (over: Partial<ConnectDeps> = {}): ConnectDeps & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      calls,
      platform: 'native',
      invoke: async (name, body) => {
        calls.push([name, body]);
        return { data: { url: 'https://accounts.google.com/o/oauth2/auth?state=x' }, error: null };
      },
      openAuth: async (url, ret) => {
        calls.push(['open', url, ret]);
        return { type: 'success', url: 'aicalendar://google/connected?connected=1&account_id=acc1' };
      },
      redirect: (u) => calls.push(['redirect', u]),
      ...over,
    };
  };

  it('starts, opens the auth session with the return URL, and parses the answer', async () => {
    const d = deps();
    expect(await runConnect(d)).toEqual({ kind: 'connected', accountId: 'acc1' });
    expect(d.calls[0]).toEqual(['google-connect', { action: 'start', return_url: 'aicalendar://google/connected' }]);
    expect(d.calls[1]).toEqual(['open', 'https://accounts.google.com/o/oauth2/auth?state=x', 'aicalendar://google/connected']);
  });

  it('reconnects an account by id', async () => {
    const d = deps();
    await runConnect(d, { accountId: 'acc9' });
    expect(d.calls[0]).toEqual(['google-connect', { action: 'reconnect', account_id: 'acc9', return_url: 'aicalendar://google/connected' }]);
  });

  it('treats a closed sheet as cancelled and a failed start as an error', async () => {
    expect(await runConnect(deps({ openAuth: async () => ({ type: 'cancel' }) }))).toEqual({ kind: 'cancelled' });
    expect(await runConnect(deps({ invoke: async () => ({ data: null, error: new Error('x') }) }))).toMatchObject({ kind: 'error' });
    expect(await runConnect(deps({ openAuth: async () => { throw new Error('boom'); } }))).toMatchObject({ kind: 'error', code: 'browser_failed' });
  });

  it('redirects the page on web, returning to the origin', async () => {
    const d = deps({ platform: 'web', origin: 'https://app.example' });
    expect(await runConnect(d)).toEqual({ kind: 'redirecting' });
    expect(d.calls[0]).toEqual(['google-connect', { action: 'start', return_url: 'https://app.example/settings/calendars' }]);
    expect(d.calls[1]).toEqual(['redirect', 'https://accounts.google.com/o/oauth2/auth?state=x']);
  });
});

describe('colours and block marks', () => {
  it('reads Google colours, falling back to grey', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('9fe1e7')).toBe('#9fe1e7');
    expect(normalizeHex(null)).toBe('#b0aea5');
    expect(paintFromHex('#6a9bcc').edge).toBe('#6a9bcc');
  });

  const cals = [{ id: 'c1', color: '#6a9bcc' }];
  it('paints an imported event in its calendar colour with the calendar dot, and initials for someone else’s', () => {
    const o = deriveOverlay({ source: 'google', isMine: false, visibility: 'private', cat: null }, { calendarId: 'c1', googleEventId: 'g', organizerEmail: 'priya.shah@x.co' }, cals, undefined);
    expect(o.dotColor).toBe('#6a9bcc');
    expect(o.paint?.edge).toBe('#6a9bcc');
    expect(o.initials).toBe('PS');
  });

  it('shows the public glyph state and the target count', () => {
    const t = (status: string) => ({ kind: 'google', google_calendar_id: 'c1', status, remove_requested: false, event_id: 'e' }) as never;
    const pub = { source: 'app' as const, isMine: true, visibility: 'public' as const, cat: 'Family' };
    expect(deriveOverlay(pub, null, cals, [t('synced'), t('synced')])).toMatchObject({ publicCount: 2, glyph: 'synced' });
    expect(deriveOverlay(pub, null, cals, [t('synced'), t('pending')]).glyph).toBe('pending');
    expect(deriveOverlay(pub, null, cals, [t('synced'), t('failed')]).glyph).toBe('failed');
    expect(deriveOverlay({ ...pub, visibility: 'private' }, null, cals, [t('failed')]).publicCount).toBe(0);
  });
});

describe('accounts view', () => {
  const acc = (id: string, status = 'ok') => ({ id, email: id + '@x.co', status, created_at: '2026-01-0' + (id === 'a' ? 1 : 2) });
  const cal = (id: string, account_id: string, o: object = {}) => ({ id, account_id, name: id, is_primary: false, show_in_app: true, can_publish: false, access_role: 'owner', last_synced_at: null, ...o });

  it('counts shown and publishable calendars, and hides accounts that need sign-in from the picker', () => {
    const views = buildAccountViews([acc('a'), acc('b', 'needs_signin')] as never, [cal('c1', 'a', { is_primary: true, can_publish: true }), cal('c2', 'a', { show_in_app: false }), cal('c3', 'b', { can_publish: true })] as never);
    expect(views[0]).toMatchObject({ shown: 1, canPublish: 1, needsSignIn: false });
    expect(views[1].needsSignIn).toBe(true);
    expect(publishableCalendars(views).map((g) => g.account.id)).toEqual(['a']);
  });

  it('says when it last synced', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(syncedLabel('2026-10-30T11:58:00Z', now)).toBe('Synced 2 mins ago');
    expect(syncedLabel(null, now)).toBe('Not synced yet');
  });
});

/* ---------- the store, against a small in-memory fake of supabase-js ---------- */

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>, hooks: { rpc?: (name: string, args: Row) => Promise<{ error: { code?: string; message: string } | null }>; invoked?: unknown[] } = {}) {
  const writes: unknown[] = [];
  const from = (table: string) => {
    let filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'update' | 'delete' | 'insert' = 'select';
    let patch: Row = {};
    const run = () => {
      const rows = tables[table] ?? (tables[table] = []);
      if (mode === 'select') return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
      if (mode === 'update') {
        rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, patch));
        writes.push(['update', table, patch]);
        return { data: null, error: null };
      }
      if (mode === 'delete') {
        tables[table] = rows.filter((r) => !filters.every((f) => f(r)));
        writes.push(['delete', table]);
        return { data: null, error: null };
      }
      const row = { id: 'row-' + rows.length, hidden_at: new Date().toISOString(), user_id: 'u', ...patch };
      rows.push(row);
      writes.push(['insert', table, patch]);
      return { data: row, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      range: (a: number, z: number) => {
        const r = run();
        return Promise.resolve({ ...r, data: (r.data as Row[]).slice(a, z + 1) });
      },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b; },
      update: (p: Row) => { mode = 'update'; patch = p; return b; },
      delete: () => { mode = 'delete'; return b; },
      insert: (p: Row) => { mode = 'insert'; patch = p; return b; },
      single: () => Promise.resolve(run()),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  const client = {
    from,
    rpc: (name: string, args: Row) => (hooks.rpc ?? (async () => ({ error: null })))(name, args),
    functions: { invoke: async (name: string, o: Row) => { hooks.invoked?.push([name, o.body]); return { data: {}, error: null }; } },
    channel: () => ({ on: () => undefined, subscribe: () => undefined }),
    removeChannel: async () => undefined,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) },
  };
  return { client: client as unknown as CalendarsClient, writes };
}

describe('CalendarsStore', () => {
  const seed = () => ({
    google_accounts_public: [{ id: 'acc', email: 'sam@x.co', status: 'ok', created_at: '2026-01-01' }],
    google_calendars: [{ id: 'c1', account_id: 'acc', name: 'Sam', show_in_app: false, can_publish: false, created_at: '2026-01-01' }],
    event_targets: [],
    hidden_items: [],
    events: [{ id: 'e1', source: 'google', google_calendar_id: 'c1', google_event_id: 'g1', organizer_email: 'p@x.co', deleted_at: null }],
    categories: [{ id: 'cat1', name: 'Family', default_visibility: 'private', default_targets: [] }],
  });

  it('loads the tables and the imported-event metadata', async () => {
    const { client } = fakeClient(seed());
    const store = new CalendarsStore({ client });
    await store.refresh();
    const s = store.getState();
    expect(s.load).toBe('ready');
    expect(s.accounts).toHaveLength(1);
    expect(s.meta.e1).toEqual({ calendarId: 'c1', googleEventId: 'g1', organizerEmail: 'p@x.co' });
    expect(s.categories.Family.id).toBe('cat1');
  });

  it('toggling a calendar updates the row, then calls sync_now once', async () => {
    jest.useFakeTimers();
    const invoked: unknown[] = [];
    const { client, writes } = fakeClient(seed(), { invoked });
    const store = new CalendarsStore({ client, syncDebounceMs: 50 });
    await store.refresh();
    await store.setCalendarFlag('c1', { show_in_app: true });
    await store.setCalendarFlag('c1', { can_publish: true });
    expect(store.getState().calendars[0]).toMatchObject({ show_in_app: true, can_publish: true });
    expect(writes).toContainEqual(['update', 'google_calendars', { show_in_app: true }]);
    jest.advanceTimersByTime(60);
    jest.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    expect(invoked).toEqual([['google-sync', { action: 'sync_now' }]]);
  });

  it('hides an event with an optimistic hidden_items row, and Undo deletes it', async () => {
    const { client, writes } = fakeClient(seed());
    const store = new CalendarsStore({ client });
    await store.refresh();
    const pending = store.hide('google', 'g1');
    expect(store.getState().hidden.map((h) => h.external_key)).toEqual(['g1']);
    const row = await pending;
    expect(writes).toContainEqual(['insert', 'hidden_items', { source: 'google', external_key: 'g1' }]);
    await store.unhide(row);
    expect(store.getState().hidden).toEqual([]);
    expect(writes).toContainEqual(['delete', 'hidden_items']);
  });

  it('sets Google targets through the RPC, retrying while the event has not reached the server', async () => {
    let calls = 0;
    const args: Row[] = [];
    const { client } = fakeClient(seed(), {
      rpc: async (_n, a) => {
        args.push(a);
        calls += 1;
        return calls < 3 ? { error: { code: 'P0002', message: 'event not found' } } : { error: null };
      },
    });
    const store = new CalendarsStore({ client, sleep: async () => undefined });
    const res = await store.setEventGoogleTargets({ p_event_id: 'e', p_calendar_ids: ['c1'], p_apply_to_series: false });
    expect(res).toBe('ok');
    expect(calls).toBe(3);
    expect(args[0]).toEqual({ p_event_id: 'e', p_calendar_ids: ['c1'], p_apply_to_series: false });
    expect(store.getState().ops.e).toBeUndefined();
  });

  it('marks the targets failed on a real error, and a second call (Retry) can succeed', async () => {
    let fail = true;
    const { client } = fakeClient(seed(), { rpc: async () => (fail ? { error: { code: '22023', message: 'calendar not marked Can publish to' } } : { error: null }) });
    const store = new CalendarsStore({ client, sleep: async () => undefined });
    const a = { p_event_id: 'e', p_calendar_ids: ['c1'], p_apply_to_series: false };
    expect(await store.setEventGoogleTargets(a)).toBe('failed');
    expect(store.getState().ops.e).toMatchObject({ state: 'failed', calendarIds: ['c1'] });
    fail = false;
    expect(await store.setEventGoogleTargets(a)).toBe('ok');
    expect(store.getState().ops.e).toBeUndefined();
  });

  it('saves a category default', async () => {
    const { client, writes } = fakeClient(seed());
    const store = new CalendarsStore({ client });
    await store.refresh();
    await store.setCategoryDefault('cat1', { default_visibility: 'public', default_targets: ['c1'] });
    expect(store.getState().categories.Family).toMatchObject({ visibility: 'public', targets: ['c1'] });
    expect(writes).toContainEqual(['update', 'categories', { default_visibility: 'public', default_targets: ['c1'] }]);
  });

  it('merges realtime changes by id', () => {
    const list = [{ id: 'a', v: 1 }];
    expect(applyChange(list, 'INSERT', { id: 'b', v: 2 }, undefined)).toHaveLength(2);
    expect(applyChange(list, 'UPDATE', { id: 'a', v: 9 }, undefined)).toEqual([{ id: 'a', v: 9 }]);
    expect(applyChange(list, 'DELETE', undefined, { id: 'a' })).toEqual([]);
  });
});
