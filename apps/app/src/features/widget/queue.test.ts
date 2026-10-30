import { DEFAULT_PREFS, createMemoryStoreLike } from './testStore';
import { createMemoryDeviceKv } from '@/lib/deviceKvMemory';

import { data, dataWithDinner, NOW } from './fixtures';
import { appendDoneOp, drainDoneOps, readAck, readOps } from './queue';
import { createSnapshotWriter } from './writer';
import { refreshWidgetSnapshot } from './refresh';
import { createMemoryWidgetStorage } from './memoryStorage';
import { KEYS, OP_MAX_AGE_MS } from './types';
import { loadForDraw } from './read';

void DEFAULT_PREFS;

const setup = () => {
  const storage = createMemoryWidgetStorage();
  const kv = createMemoryDeviceKv();
  const store = createMemoryStoreLike(dataWithDinner);
  return { storage, kv, store };
};

describe('mark-done queue', () => {
  it('the widget appends, and the app drains through commit', () => {
    const { storage, kv, store } = setup();
    appendDoneOp(storage, 'e4', NOW);
    expect(readOps(storage)).toEqual([{ op: 'done', ev: 'e4', at: NOW.toISOString() }]);

    const r = drainDoneOps({ storage, kv, store, now: new Date(NOW.getTime() + 1000) });
    expect(r).toEqual({ applied: 1, skipped: 0, pending: 0 });
    expect(store.getState().data.events.find((e) => e.id === 'e4')!.done).toBe(true);
    expect(store.commits).toEqual([{ label: 'Done · Review offline queue PR', kind: 'edit' }]);
    expect(readAck(storage)).toEqual([`e4@${NOW.toISOString()}`]);
  });

  it('is idempotent: a second drain applies nothing', () => {
    const { storage, kv, store } = setup();
    appendDoneOp(storage, 'e4', NOW);
    drainDoneOps({ storage, kv, store, now: NOW });
    const again = drainDoneOps({ storage, kv, store, now: NOW });
    expect(again).toEqual({ applied: 0, skipped: 0, pending: 0 });
    expect(store.commits).toHaveLength(1);
  });

  it('skips events that are already done or someone else’s', () => {
    const { storage, kv, store } = setup();
    appendDoneOp(storage, 'e1', NOW); // already done
    appendDoneOp(storage, 'e9', new Date(NOW.getTime() + 1)); // not mine
    const r = drainDoneOps({ storage, kv, store, now: NOW });
    expect(r).toEqual({ applied: 0, skipped: 2, pending: 0 });
    expect(store.commits).toHaveLength(0);
  });

  it('keeps an op pending while its event has not synced yet, and drops it after a week', () => {
    const { storage, kv, store } = setup();
    appendDoneOp(storage, 'later', NOW);
    expect(drainDoneOps({ storage, kv, store, now: NOW })).toEqual({ applied: 0, skipped: 0, pending: 1 });
    const week = new Date(NOW.getTime() + OP_MAX_AGE_MS + 1);
    expect(drainDoneOps({ storage, kv, store, now: week })).toEqual({ applied: 0, skipped: 1, pending: 0 });
  });

  it('the widget prunes acknowledged ops when it next appends', () => {
    const { storage, kv, store } = setup();
    appendDoneOp(storage, 'e4', NOW);
    drainDoneOps({ storage, kv, store, now: NOW });
    appendDoneOp(storage, 'e7', new Date(NOW.getTime() + 5000));
    expect(readOps(storage).map((o) => o.ev)).toEqual(['e7']);
  });

  it('tolerates a corrupt queue', () => {
    const { storage, kv, store } = setup();
    storage.set(KEYS.ops, '{nope');
    expect(readOps(storage)).toEqual([]);
    expect(drainDoneOps({ storage, kv, store, now: NOW })).toEqual({ applied: 0, skipped: 0, pending: 0 });
  });
});

describe('snapshot writer', () => {
  const input = { data, prefs: DEFAULT_PREFS, user: { id: 'u1', name: 'Sam' }, clock: '12h' as const };

  it('debounces store changes and writes once', () => {
    const storage = createMemoryWidgetStorage();
    const timers: Array<() => void> = [];
    const w = createSnapshotWriter({ storage, now: () => NOW, setTimer: (fn) => timers.push(fn) - 1, clearTimer: (t) => { timers[t as number] = () => undefined; } });
    w.schedule(input);
    w.schedule(input);
    w.schedule(input);
    expect(storage.get(KEYS.snapshot)).toBeNull();
    timers.forEach((t) => t());
    expect(storage.get(KEYS.snapshot)).not.toBeNull();
    expect(storage.reloads).toBe(1);
  });

  it('skips unchanged writes, but re-writes after a few minutes and when forced', () => {
    const storage = createMemoryWidgetStorage();
    let now = NOW;
    const w = createSnapshotWriter({ storage, now: () => now });
    expect(w.writeNow(input)).toBe(true);
    expect(w.writeNow(input)).toBe(false);
    now = new Date(NOW.getTime() + 6 * 60000);
    expect(w.writeNow(input)).toBe(true);
    expect(w.writeNow(input, true)).toBe(true);
  });

  it('sign-out clears the snapshot and the queue', () => {
    const storage = createMemoryWidgetStorage();
    const w = createSnapshotWriter({ storage, now: () => NOW });
    w.writeNow(input);
    appendDoneOp(storage, 'e4', NOW);
    w.writeNow({ ...input, user: null });
    expect(storage.get(KEYS.snapshot)).toBeNull();
    expect(storage.get(KEYS.ops)).toBeNull();
    expect(loadForDraw(storage)).toEqual({ snapshot: null, ops: [] });
  });
});

describe('refreshWidgetSnapshot', () => {
  const user = { id: 'u1', name: 'Sam' };
  const mk = (over: Partial<Parameters<typeof refreshWidgetSnapshot>[0]> = {}) => {
    const { storage, kv, store } = setup();
    const writer = createSnapshotWriter({ storage, now: () => NOW });
    const calls: string[] = [];
    const deps = {
      writer, storage, kv, now: () => NOW,
      clock: () => '12h' as const, hidePrivate: () => false,
      live: () => null,
      headless: async () => ({
        user, store,
        sync: async () => { calls.push('sync'); },
        finish: async () => { calls.push('finish'); },
      }),
      ...over,
    };
    return { deps, storage, store, calls };
  };

  it('headless: applies queued checks, syncs, then writes a snapshot that already has them', async () => {
    const { deps, storage, store, calls } = mk();
    appendDoneOp(storage, 'e4', NOW);
    const out = await refreshWidgetSnapshot(deps);
    expect(out).toMatchObject({ via: 'headless', wrote: true });
    expect(calls).toEqual(['sync', 'finish']);
    expect(store.getState().data.events.find((e) => e.id === 'e4')!.done).toBe(true);
    const { snapshot } = loadForDraw(storage);
    expect(snapshot!.events.find((e) => e.id === 'e4')!.done).toBe(true);
    expect(snapshot!.session.userId).toBe('u1');
  });

  it('writes anyway when the sync fails (offline)', async () => {
    const { deps, storage } = mk({
      headless: async () => ({ user, store: setup().store, sync: async () => { throw new Error('offline'); } }),
    });
    expect((await refreshWidgetSnapshot(deps)).via).toBe('headless');
    expect(loadForDraw(storage).snapshot).not.toBeNull();
  });

  it('signed out: clears the snapshot', async () => {
    const { deps, storage } = mk({ headless: async () => null });
    storage.set(KEYS.snapshot, '{}');
    expect(await refreshWidgetSnapshot(deps)).toEqual({ via: 'signedOut' });
    expect(storage.get(KEYS.snapshot)).toBeNull();
  });

  it('prefers the live store when the app UI is running', async () => {
    const { deps, store } = mk({ headless: async () => { throw new Error('should not run'); } });
    const out = await refreshWidgetSnapshot({ ...deps, live: () => ({ user, store }) });
    expect(out).toMatchObject({ via: 'live' });
  });
});
