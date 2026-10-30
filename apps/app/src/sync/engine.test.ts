import { DEFAULT_PREFS, deleteCat, deleteEvent, editEvent, renameCat, toggleDone, type CalendarData, type ProtoEvent, type Series } from '@calendar/core';

import { SyncEngine, type ConflictInfo } from './engine';
import { createFakeServer, type FakeClient, type FakeServer } from './fakeServer';
import { createMemoryKv, scopedStore, userPrefix } from './kv';
import { RemoteError, type KeyValueStore, type NetworkMonitor } from './types';

const U = '00000000-0000-4000-8000-0000000000a1';
let n = 0;
const uid = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function seedUser(server: FakeServer, userId = U) {
  const ids: Record<string, string> = {};
  Object.entries({ Work: 255, Food: 72, Health: 132, Family: 28, Social: 12, Routine: 104, Pets: 166 }).forEach(([name, hue]) => {
    const id = uid();
    ids[name] = id;
    server.write('categories', { id, user_id: userId, name, hue, created_at: '2026-10-30T09:00:00.000Z' }, userId);
  });
  server.write('profiles', { id: userId, prefs: {} }, userId);
  return ids;
}

function fakeNet(): NetworkMonitor & { set(v: boolean): void } {
  let online = true;
  const ls = new Set<(o: boolean) => void>();
  return {
    isOnline: () => online,
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
    set(v) {
      online = v;
      ls.forEach((l) => l(v));
    },
  };
}

interface Device {
  engine: SyncEngine;
  client: FakeClient;
  net: ReturnType<typeof fakeNet>;
  conflicts: ConflictInfo[];
  kv: KeyValueStore;
  clock: { ms: number };
  setOnline(v: boolean): Promise<void>;
  settle(): Promise<void>;
}

async function device(server: FakeServer, opts: { userId?: string; kv?: KeyValueStore; start?: boolean; clock?: number } = {}): Promise<Device> {
  const userId = opts.userId ?? U;
  const kv = opts.kv ?? scopedStore(createMemoryKv(), userPrefix(userId));
  const client = server.client(userId);
  const net = fakeNet();
  const conflicts: ConflictInfo[] = [];
  const clock = { ms: opts.clock ?? server.clock.ms };
  const engine = await SyncEngine.create({
    userId,
    kv,
    remote: client,
    net,
    now: () => clock.ms,
    newId: uid,
    onConflict: (c) => conflicts.push(c),
    retry: { enabled: false },
    persistDelayMs: 0,
  });
  const d: Device = {
    engine,
    client,
    net,
    conflicts,
    kv,
    clock,
    async setOnline(v) {
      client.online = v;
      net.set(v);
      await engine.idle();
    },
    async settle() {
      await engine.idle();
      await engine.idle();
    },
  };
  if (opts.start !== false) {
    engine.start();
    await d.settle();
  }
  return d;
}

const evt = (over: Partial<ProtoEvent> = {}): ProtoEvent => ({ id: uid(), day: '2026-10-31', cat: 'Work', title: 'Standup', start: 540, end: 570, ...over });

const withEvent = (d: CalendarData, e: ProtoEvent): CalendarData => ({ ...d, events: [...d.events, e] });

describe('first pull', () => {
  it('loads the user rows into CalendarData and prefs', async () => {
    const server = createFakeServer();
    const ids = seedUser(server);
    server.write('events', { id: uid(), user_id: U, title: 'Server event', category_id: ids.Work, day: '2026-10-30', start_min: 60, end_min: 120, all_day: false, days: 1, done: false, pauses: [], win: null, series_id: null, visibility: 'private' });
    server.write('profiles', { id: U, prefs: { view: 'week' } });
    const a = await device(server);
    const data = a.engine.getData();
    expect(Object.keys(data.cats)).toHaveLength(7);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ title: 'Server event', cat: 'Work' });
    expect(a.engine.getPrefs().view).toBe('week');
    expect(a.engine.getStatus()).toBe('idle');
    expect(a.engine.isReady()).toBe(true);
  });
});

describe('local writes sync in dependency order', () => {
  it('new category + goal + event + series are sent categories/series -> goals -> events', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    server.log.length = 0;
    const s: Series = { id: 'ser1', freq: 'weekly', weekdays: [1], startDay: '2026-10-26', until: null };
    a.engine.applySeries([s]);
    const data = a.engine.getData();
    const ev = evt({ cat: 'Novel', seriesId: 'ser1' });
    const next: CalendarData = {
      events: [...data.events, ev],
      cats: { ...data.cats, Novel: 200 },
      goals: [{ id: 'g1', title: 'Novel', cat: 'Novel', outcome: 'Done', hours: 5, start: '2026-10-30', deadline: '2026-12-01', hue: 200 }],
    };
    a.engine.applyData(next);
    await a.settle();
    const writes = server.log.filter((l) => /^(upsert|softDelete|remove)/.test(l)).map((l) => l.split(' ')[1]);
    expect(writes).toEqual(['series', 'categories', 'goals', 'events']); // series and categories share a rank, then goals, then events
    const row = server.tables.events[Object.keys(server.tables.events)[0]];
    expect(row.category_id).toBe(Object.values(server.tables.categories).find((c) => c.name === 'Novel')?.id);
    expect(row.series_id).toBe(Object.keys(server.tables.series)[0]);
    expect(Object.values(server.tables.goals)[0]).toMatchObject({ title: 'Novel', category_id: row.category_id });
    expect(a.engine.pendingCount()).toBe(0);
    expect(a.engine.getStatus()).toBe('idle');
    // the app keeps its own ids
    expect(a.engine.getData().goals[0].id).toBe('g1');
    expect(a.engine.getSeries()[0].id).toBe('ser1');
  });

  it('update and soft delete reach the server; a second device follows through realtime', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    const b = await device(server);
    const ev = evt();
    a.engine.applyData(withEvent(a.engine.getData(), ev));
    await a.settle();
    expect(b.engine.getData().events.map((e) => e.id)).toEqual([ev.id]);

    a.engine.applyData(toggleDone(a.engine.getData(), ev.id));
    await a.settle();
    expect(server.tables.events[ev.id].done).toBe(true);
    expect(b.engine.getData().events[0].done).toBe(true);

    a.engine.applyData(deleteEvent(a.engine.getData(), ev.id));
    await a.settle();
    expect(server.tables.events[ev.id].deleted_at).toBeTruthy();
    expect(b.engine.getData().events).toEqual([]);
    expect(b.conflicts).toEqual([]);
  });

  it('undo of a delete revives the same row', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    const ev = evt();
    a.engine.applyData(withEvent(a.engine.getData(), ev));
    await a.settle();
    const before = a.engine.getData();
    a.engine.applyData(deleteEvent(before, ev.id));
    await a.settle();
    a.engine.applyData(before);
    await a.settle();
    expect(server.tables.events[ev.id].deleted_at).toBeNull();
    expect(a.engine.getData().events.map((e) => e.id)).toEqual([ev.id]);
  });

  it('an event created and deleted before syncing never reaches the server', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    await a.setOnline(false);
    const ev = evt();
    a.engine.applyData(withEvent(a.engine.getData(), ev));
    a.engine.applyData(deleteEvent(a.engine.getData(), ev.id));
    expect(a.engine.pendingCount()).toBe(0);
    await a.setOnline(true);
    expect(server.tables.events[ev.id]).toBeUndefined();
  });

  it('category rename updates the row; delete of one category and re-creating its name sends the delete first', async () => {
    const server = createFakeServer();
    const ids = seedUser(server);
    const a = await device(server);
    a.engine.applyData(renameCat(a.engine.getData(), 'Work', 'Job'));
    await a.settle();
    expect(server.tables.categories[ids.Work].name).toBe('Job');

    await a.setOnline(false);
    const d0 = a.engine.getData();
    a.engine.applyData(deleteCat(d0, 'Pets').data);
    const d1 = a.engine.getData();
    a.engine.applyData({ ...d1, cats: { ...d1.cats, Pets: 10 } }); // same name, new row
    await a.setOnline(true);
    expect(server.tables.categories[ids.Pets]).toBeUndefined();
    expect(Object.values(server.tables.categories).filter((c) => c.name === 'Pets')).toHaveLength(1);
    expect(a.engine.getStatus()).toBe('idle');
  });

  it('setPrefs goes to profiles.prefs and reaches another device', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    const b = await device(server);
    a.engine.applyPrefs({ ...DEFAULT_PREFS, view: 'week', zoom: 1.7 });
    await a.settle();
    expect(server.tables.profiles[U].prefs).toMatchObject({ view: 'week', zoom: 1.7 });
    expect(b.engine.getPrefs()).toMatchObject({ view: 'week', zoom: 1.7 });
  });
});

describe('read-only events', () => {
  it('imported google events never produce a write, even when the app edits or deletes them', async () => {
    const server = createFakeServer();
    seedUser(server);
    const gid = uid();
    const calId = uid();
    server.write('events', { id: gid, user_id: U, title: 'Imported', category_id: null, day: '2026-10-31', start_min: 60, end_min: 120, all_day: false, days: 1, done: false, pauses: [], win: null, series_id: null, visibility: 'public', source: 'google', google_calendar_id: calId, google_event_id: 'x', is_mine: false });
    const a = await device(server);
    expect(a.engine.getData().events[0]).toMatchObject({ source: 'google', isMine: false, visibility: 'public' });
    server.log.length = 0;
    const mine = evt();
    a.engine.applyData(withEvent(a.engine.getData(), mine));
    await a.settle();
    server.log.length = 0;
    let r = a.engine.applyData(toggleDone(a.engine.getData(), gid));
    expect(r.ignored).toEqual([gid]);
    r = a.engine.applyData(editEvent(a.engine.getData(), gid, { title: 'Hacked' }));
    r = a.engine.applyData(deleteEvent(a.engine.getData(), gid));
    await a.settle();
    expect(server.log.filter((l) => /^(upsert|softDelete|remove)/.test(l))).toEqual([]);
    expect(a.engine.pendingCount()).toBe(0);
    expect(server.tables.events[gid].title).toBe('Imported');
    expect(a.engine.getData().events.find((e) => e.title === 'Imported')).toBeTruthy();
  });
});

describe('offline, persistence and retry', () => {
  it('commits made offline are kept on disk and sent after a restart', async () => {
    const server = createFakeServer();
    seedUser(server);
    const kv = scopedStore(createMemoryKv(), userPrefix(U));
    const a = await device(server, { kv });
    await a.setOnline(false);
    expect(a.engine.getStatus()).toBe('offline');
    const ev = evt({ title: 'Offline' });
    a.engine.applyData(withEvent(a.engine.getData(), ev));
    expect(a.engine.getData().events.map((e) => e.title)).toEqual(['Offline']);
    expect(a.engine.pendingCount()).toBe(1);
    await a.engine.stop();

    // "app restart": new engine over the same storage, still offline
    const b = await device(server, { kv, start: false });
    b.client.online = false;
    b.net.set(false);
    expect(b.engine.getData().events.map((e) => e.title)).toEqual(['Offline']);
    expect(b.engine.pendingCount()).toBe(1);
    expect(b.engine.isReady()).toBe(true);
    b.engine.start();
    await b.settle();
    expect(server.tables.events[ev.id]).toBeUndefined();
    await b.setOnline(true);
    expect(server.tables.events[ev.id].title).toBe('Offline');
    expect(b.engine.pendingCount()).toBe(0);
    expect(b.engine.getStatus()).toBe('idle');
  });

  it('status: a network failure shows offline and a later success returns to idle', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    a.client.failWith = new RemoteError('network', 'Failed to fetch');
    a.engine.applyData(withEvent(a.engine.getData(), evt()));
    await a.settle();
    expect(a.engine.getStatus()).toBe('offline');
    expect(a.engine.pendingCount()).toBe(1);
    await a.engine.sync();
    expect(a.engine.getStatus()).toBe('idle');
    expect(a.engine.pendingCount()).toBe(0);
  });

  it('status: a server error shows error; a rejected write is dropped and the server version restored', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    a.client.failWith = new RemoteError('server', 'boom', { status: 500 });
    a.engine.applyData(withEvent(a.engine.getData(), evt()));
    await a.settle();
    expect(a.engine.getStatus()).toBe('error');
    await a.engine.sync();
    expect(a.engine.getStatus()).toBe('idle');

    const bad = evt({ title: 'Bad', start: 600, end: 600 }); // end must be after start
    a.engine.applyData(withEvent(a.engine.getData(), bad));
    await a.settle();
    expect(a.engine.getRejected()).toHaveLength(1);
    expect(a.engine.getStatus()).toBe('error');
    expect(a.engine.getData().events.find((e) => e.id === bad.id)).toBeUndefined();
    expect(a.engine.pendingCount()).toBe(0);
  });

  it('a 401 stops the flush, keeps the writes and calls onAuthError', async () => {
    const server = createFakeServer();
    seedUser(server);
    const kv = scopedStore(createMemoryKv(), userPrefix(U));
    const client = server.client(U);
    const net = fakeNet();
    let authErrors = 0;
    const engine = await SyncEngine.create({ userId: U, kv, remote: client, net, newId: uid, retry: { enabled: false }, persistDelayMs: 0, onAuthError: () => authErrors++ });
    engine.start();
    await engine.idle();
    client.failWith = new RemoteError('auth', 'JWT expired', { status: 401 });
    engine.applyData(withEvent(engine.getData(), evt()));
    await engine.idle();
    expect(authErrors).toBe(1);
    expect(engine.pendingCount()).toBe(1);
    expect(engine.getStatus()).toBe('error');
    await engine.sync();
    expect(engine.pendingCount()).toBe(0);
  });

  it('a hard delete made elsewhere while offline is noticed by the next pull', async () => {
    const server = createFakeServer();
    const ids = seedUser(server);
    const a = await device(server);
    await a.setOnline(false);
    delete server.tables.categories[ids.Pets];
    await a.setOnline(true);
    expect(Object.keys(a.engine.getData().cats)).not.toContain('Pets');
  });
});

describe('last write wins', () => {
  async function twoDevices() {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    const ev = evt({ title: 'Original' });
    a.engine.applyData(withEvent(a.engine.getData(), ev));
    await a.settle();
    const b = await device(server);
    expect(b.engine.getData().events[0].title).toBe('Original');
    return { server, a, b, ev };
  }

  it('own writes echoed by realtime are not conflicts', async () => {
    const { a, b } = await twoDevices();
    expect(a.conflicts).toEqual([]);
    expect(b.conflicts).toEqual([]);
  });

  it('a newer remote change replaces an unsynced local edit and reports a conflict; Undo re-applies it and wins', async () => {
    const { server, a, b, ev } = await twoDevices();
    const t = server.clock.ms;
    await a.setOnline(false);
    a.clock.ms = t + 10_000;
    a.engine.applyData(editEvent(a.engine.getData(), ev.id, { title: 'A offline edit' }));
    expect(a.engine.getData().events[0].title).toBe('A offline edit');

    server.clock.ms = t + 60_000; // B's edit lands a minute later
    b.engine.applyData(editEvent(b.engine.getData(), ev.id, { title: 'B edit' }));
    await b.settle();
    expect(server.tables.events[ev.id].title).toBe('B edit');

    await a.setOnline(true);
    expect(a.engine.getData().events[0].title).toBe('B edit');
    expect(a.conflicts).toHaveLength(1);
    expect(a.conflicts[0]).toMatchObject({ table: 'events', rowId: ev.id, label: 'A offline edit' });
    expect(a.engine.pendingCount()).toBe(0);

    // Undo from the toast: the dropped edit comes back, stamped now, and wins
    a.clock.ms = server.clock.ms + 1000;
    a.conflicts[0].undo();
    expect(a.engine.getData().events[0].title).toBe('A offline edit');
    await a.settle();
    expect(server.tables.events[ev.id].title).toBe('A offline edit');
    expect(b.engine.getData().events[0].title).toBe('A offline edit');
  });

  it('a newer local edit wins over an older remote change, with no conflict', async () => {
    const { server, a, b, ev } = await twoDevices();
    const t = server.clock.ms;
    await a.setOnline(false);
    server.clock.ms = t + 5_000;
    b.engine.applyData(editEvent(b.engine.getData(), ev.id, { title: 'B edit' }));
    await b.settle();
    a.clock.ms = t + 20_000;
    a.engine.applyData(editEvent(a.engine.getData(), ev.id, { title: 'A later edit' }));
    server.clock.ms = t + 30_000; // server time is after the edit but the edit's own clock is later than B's write
    await a.setOnline(true);
    expect(a.conflicts).toEqual([]);
    expect(server.tables.events[ev.id].title).toBe('A later edit');
    expect(b.engine.getData().events[0].title).toBe('A later edit');
  });

  it('a remote delete beats an older local edit', async () => {
    const { server, a, b, ev } = await twoDevices();
    const t = server.clock.ms;
    await a.setOnline(false);
    a.clock.ms = t + 1_000;
    a.engine.applyData(toggleDone(a.engine.getData(), ev.id));
    server.clock.ms = t + 50_000;
    b.engine.applyData(deleteEvent(b.engine.getData(), ev.id));
    await b.settle();
    await a.setOnline(true);
    expect(a.engine.getData().events).toEqual([]);
    expect(a.conflicts).toHaveLength(1);
    // Undo brings the event back for everyone
    a.clock.ms = server.clock.ms + 1000;
    a.conflicts[0].undo();
    await a.settle();
    expect(server.tables.events[ev.id].deleted_at).toBeNull();
    expect(b.engine.getData().events).toHaveLength(1);
  });

  it('realtime change that arrives while an edit is pending is resolved the same way', async () => {
    const { server, a, ev } = await twoDevices();
    const t = server.clock.ms;
    a.client.failWith = new RemoteError('network', 'Failed to fetch');
    a.clock.ms = t + 1_000;
    a.engine.applyData(editEvent(a.engine.getData(), ev.id, { title: 'mine' }));
    await a.settle();
    expect(a.engine.pendingCount()).toBe(1);
    server.clock.ms = t + 90_000;
    server.write('events', { id: ev.id, title: 'theirs' });
    expect(a.engine.getData().events[0].title).toBe('theirs');
    expect(a.conflicts).toHaveLength(1);
  });

  it('settings conflicts are labelled Settings', async () => {
    const server = createFakeServer();
    seedUser(server);
    const a = await device(server);
    const t = server.clock.ms;
    await a.setOnline(false);
    a.clock.ms = t + 1000;
    a.engine.applyPrefs({ ...DEFAULT_PREFS, zoom: 1.7 });
    server.clock.ms = t + 60_000;
    server.write('profiles', { id: U, prefs: { ...DEFAULT_PREFS, zoom: 0.5 } });
    await a.setOnline(true);
    expect(a.conflicts[0]).toMatchObject({ table: 'profiles', label: 'Settings' });
    expect(a.engine.getPrefs().zoom).toBe(0.4);
  });
});

describe('wipe and isolation at the engine level', () => {
  it('wipe removes everything stored under the user prefix', async () => {
    const server = createFakeServer();
    seedUser(server);
    const base = createMemoryKv();
    base.setItem('other:key', 'keep');
    const a = await device(server, { kv: scopedStore(base, userPrefix(U)) });
    a.engine.applyData(withEvent(a.engine.getData(), evt()));
    await a.engine.flushPersist();
    expect((await base.keys()).some((k) => k.startsWith(userPrefix(U)))).toBe(true);
    await a.engine.wipe();
    expect(await base.keys()).toEqual(['other:key']);
  });
});
