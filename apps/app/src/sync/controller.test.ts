import { getSessionExpired, getStore, getSyncConflicts, clearSyncConflicts, setSessionExpired, setStore, createMemoryStore, undoSyncConflict } from '../store';
import { SyncController, type AuthLike, type SessionLike } from './controller';
import { createFakeServer, type FakeServer } from './fakeServer';
import { createMemoryKv, userPrefix } from './kv';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
let n = 0;
const uid = () => `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function seed(server: FakeServer, userId: string, title?: string) {
  const ids: Record<string, string> = {};
  ['Work', 'Food'].forEach((name, i) => {
    ids[name] = uid();
    server.write('categories', { id: ids[name], user_id: userId, name, hue: 10 + i, created_at: '2026-10-30T09:00:00.000Z' }, userId);
  });
  server.write('profiles', { id: userId, prefs: {} }, userId);
  if (title) {
    server.write('events', { id: uid(), user_id: userId, title, category_id: ids.Work, day: '2026-10-30', start_min: 60, end_min: 120, all_day: false, days: 1, done: false, pauses: [], win: null, series_id: null, visibility: 'private' }, userId);
  }
}

function fakeAuth() {
  let cb: ((event: string, session: SessionLike | null) => void) | null = null;
  const auth: AuthLike & { emit(event: string, userId: string | null): void } = {
    onAuthStateChange(c) {
      cb = c;
      return { data: { subscription: { unsubscribe: () => (cb = null) } } };
    },
    async signOut() {
      cb?.('SIGNED_OUT', null);
    },
    emit(event, userId) {
      cb?.(event, userId ? { user: { id: userId } } : null);
    },
  };
  return auth;
}

function setup() {
  const server = createFakeServer();
  const device = createMemoryKv();
  const auth = fakeAuth();
  const clients = new Map<string, ReturnType<FakeServer['client']>>();
  const controller = new SyncController({
    auth,
    device,
    createRemote: (userId) => {
      const c = server.client(userId);
      clients.set(userId, c);
      return c;
    },
    createNet: () => ({ isOnline: () => true, subscribe: () => () => undefined }),
    firstSyncTimeoutMs: 200,
    engineOptions: { retry: { enabled: false }, persistDelayMs: 0, newId: uid, now: () => server.clock.ms },
  });
  const stop = controller.start();
  const flush = async () => {
    await controller.idle();
    await new Promise((r) => setTimeout(r, 0));
    await controller.idle();
  };
  return { server, device, auth, controller, stop, flush, clients };
}

afterEach(() => {
  setStore(createMemoryStore());
  setSessionExpired(false);
  clearSyncConflicts();
});

describe('SyncController', () => {
  it('signed out: empty store, not loading', async () => {
    const t = setup();
    t.auth.emit('INITIAL_SESSION', null);
    await t.flush();
    expect(t.controller.getState()).toEqual({ loading: false, userId: null });
    expect(getStore().getState().data.events).toEqual([]);
    t.stop();
  });

  it("sign-in installs that user's synced store; the facade notifies subscribers that were attached before the swap", async () => {
    const t = setup();
    seed(t.server, A, 'A only');
    const seen: number[] = [];
    const off = getStore().subscribe(() => seen.push(getStore().getState().data.events.length));
    t.auth.emit('INITIAL_SESSION', A);
    await t.flush();
    expect(t.controller.getState()).toEqual({ loading: false, userId: A });
    expect(getStore().getState().data.events.map((e) => e.title)).toEqual(['A only']);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
    off();
    t.stop();
  });

  it('a commit through the store is written locally first, then synced', async () => {
    const t = setup();
    seed(t.server, A);
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    const store = getStore();
    const data = store.getState().data;
    store.commit({ ...data, events: [{ id: store.newId(), day: '2026-10-31', cat: 'Work', title: 'Local first', start: 540, end: 600 }] }, 'Added');
    expect(store.getState().data.events[0].title).toBe('Local first');
    expect(store.getState().history).toHaveLength(1);
    await t.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(Object.values(t.server.tables.events).map((e) => e.title)).toEqual(['Local first']);
    t.stop();
  });

  it("a different user never sees the previous user's cache; the cache is keyed by user id", async () => {
    const t = setup();
    seed(t.server, A, 'A secret');
    seed(t.server, B, 'B event');
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    expect(getStore().getState().data.events.map((e) => e.title)).toEqual(['A secret']);
    const aClient = t.clients.get(A)!;

    // A's session dies offline with an unsynced edit; then B signs in on the same device
    aClient.online = false;
    const s = getStore();
    s.commit({ ...s.getState().data, events: [...s.getState().data.events, { id: s.newId(), day: '2026-10-31', cat: null, title: 'A unsynced', start: 0, end: 60 }] }, 'x');
    await t.flush();
    t.auth.emit('SIGNED_OUT', null); // no signOut() call: the refresh token failed
    await t.flush();
    expect(getSessionExpired()).toBe(true);
    expect(getStore().getState().data.events).toEqual([]);

    t.auth.emit('SIGNED_IN', B);
    await t.flush();
    expect(getSessionExpired()).toBe(false);
    const titles = getStore().getState().data.events.map((e) => e.title);
    expect(titles).toEqual(['B event']);
    expect(JSON.stringify(getStore().getState())).not.toContain('A secret');
    expect(JSON.stringify(getStore().getState())).not.toContain('A unsynced');

    const keys = await t.device.keys();
    expect(keys.every((k) => k.startsWith(userPrefix(A)) || k.startsWith(userPrefix(B)))).toBe(true);
    expect(keys.some((k) => k.startsWith(userPrefix(A)))).toBe(true); // expiry keeps A's cache

    // A comes back: their unsynced edit is still there and now syncs
    aClient.online = true;
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    expect(getStore().getState().data.events.map((e) => e.title).sort()).toEqual(['A secret', 'A unsynced']);
    await new Promise((r) => setTimeout(r, 10));
    expect(Object.values(t.server.tables.events).some((e) => e.title === 'A unsynced')).toBe(true);
    t.stop();
  });

  it('switching users without a sign-out event also rebuilds from scratch', async () => {
    const t = setup();
    seed(t.server, A, 'A only');
    seed(t.server, B, 'B only');
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    t.auth.emit('SIGNED_IN', B);
    await t.flush();
    expect(getStore().getState().data.events.map((e) => e.title)).toEqual(['B only']);
    t.stop();
  });

  it('explicit sign-out wipes the local data, history included, and does not flag the session as expired', async () => {
    const t = setup();
    seed(t.server, A, 'A only');
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    const s = getStore();
    s.commit({ ...s.getState().data, events: [] }, 'Deleted', 'delete');
    await new Promise((r) => setTimeout(r, 10));
    expect((await t.device.keys()).length).toBeGreaterThan(0);
    await t.auth.signOut(); // tracked: this is the user asking
    await t.flush();
    expect(await t.device.keys()).toEqual([]);
    expect(getSessionExpired()).toBe(false);
    expect(getStore().getState().data.events).toEqual([]);
    expect(getStore().getState().history).toEqual([]);
    expect(t.controller.getState()).toEqual({ loading: false, userId: null });
    t.stop();
  });

  it('a same-user token refresh keeps the store', async () => {
    const t = setup();
    seed(t.server, A, 'A only');
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    const before = getStore().getState().data;
    t.auth.emit('TOKEN_REFRESHED', A);
    await t.flush();
    expect(getStore().getState().data).toBe(before);
    t.stop();
  });

  it('a remote change that beats an unsynced local edit surfaces through useSyncConflict state, and undo restores it', async () => {
    const t = setup();
    seed(t.server, A, 'Original');
    t.auth.emit('SIGNED_IN', A);
    await t.flush();
    const client = t.clients.get(A)!;
    const s = getStore();
    const id = s.getState().data.events[0].id;
    client.online = false;
    s.commit({ ...s.getState().data, events: s.getState().data.events.map((e) => ({ ...e, title: 'Mine' })) }, 'Renamed');
    await t.flush();
    t.server.clock.ms += 10 * 60_000;
    t.server.write('events', { id, title: 'Theirs' }, A);
    client.online = true;
    await getStoreEngineSync();
    expect(getStore().getState().data.events[0].title).toBe('Theirs');
    expect(getSyncConflicts()).toHaveLength(1);
    expect(getSyncConflicts()[0]).toMatchObject({ table: 'events', label: 'Mine' });
    t.server.clock.ms += 1000;
    undoSyncConflict(getSyncConflicts()[0].id);
    expect(getStore().getState().data.events[0].title).toBe('Mine');
    t.stop();

    async function getStoreEngineSync() {
      // the facade hides the engine; trigger the sync the way the app does after a token refresh
      t.auth.emit('TOKEN_REFRESHED', A);
      await t.flush();
      await new Promise((r) => setTimeout(r, 20));
    }
  });
});
