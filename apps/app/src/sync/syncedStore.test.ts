import { applyOps, deleteEvent, type CalendarData } from '@calendar/core';

import { SyncEngine } from './engine';
import { createFakeServer } from './fakeServer';
import { createMemoryKv, scopedStore, userPrefix } from './kv';
import { createSyncedStore } from './syncedStore';

const U = '00000000-0000-4000-8000-0000000000c1';
let n = 0;
const uid = () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function build(kvBase = createMemoryKv()) {
  const server = createFakeServer();
  ['Work', 'Food'].forEach((name, i) => server.write('categories', { id: uid(), user_id: U, name, hue: 100 + i, created_at: '2026-10-30T09:00:00.000Z' }, U));
  server.write('profiles', { id: U, prefs: {} }, U);
  const kv = scopedStore(kvBase, userPrefix(U));
  const engine = await SyncEngine.create({
    userId: U,
    kv,
    remote: server.client(U),
    net: { isOnline: () => true, subscribe: () => () => undefined },
    newId: uid,
    retry: { enabled: false },
    persistDelayMs: 0,
    now: () => server.clock.ms,
  });
  engine.start();
  await engine.idle();
  const store = await createSyncedStore({ engine, kv, now: () => server.clock.ms });
  return { server, engine, kv, kvBase, store };
}

describe('synced store (the CalendarStore contract)', () => {
  it('commit records history, undo reverts it and records the revert', async () => {
    const { store, engine, server } = await build();
    const before = store.getState().data;
    const ev = { id: store.newId(), day: '2026-10-31', cat: 'Work', title: 'Standup', start: 540, end: 570 };
    store.commit({ ...before, events: [ev] }, 'Added Standup');
    expect(store.getState().data.events).toHaveLength(1);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().history[0]).toMatchObject({ label: 'Added Standup', kind: 'edit' });
    await engine.idle();
    expect(Object.keys(server.tables.events)).toEqual([ev.id]);

    store.undo();
    expect(store.getState().data.events).toEqual([]);
    expect(store.getState().history[0]).toMatchObject({ kind: 'undo', label: 'Reverted · Added Standup' });
    await engine.idle();
    expect(server.tables.events[ev.id].deleted_at).toBeTruthy();

    // undo the undo: the event comes back as the same row
    store.undo();
    expect(store.getState().data.events.map((e) => e.id)).toEqual([ev.id]);
    await engine.idle();
    expect(server.tables.events[ev.id].deleted_at).toBeNull();
  });

  it('commit with no change records nothing; delete kind is kept', async () => {
    const { store } = await build();
    store.commit(store.getState().data, 'noop');
    expect(store.getState().history).toEqual([]);
    const ev = { id: store.newId(), day: '2026-10-31', cat: 'Work', title: 'x', start: 60, end: 90 };
    store.commit({ ...store.getState().data, events: [ev] }, 'add');
    store.commit(deleteEvent(store.getState().data, ev.id), 'Deleted x', 'delete');
    expect(store.getState().history[0].kind).toBe('delete');
  });

  it('applyResult applies core applyOps output, including new categories and goals', async () => {
    const { store, engine, server } = await build();
    const data: CalendarData = store.getState().data;
    let i = 0;
    const r = applyOps(
      data,
      [
        { op: 'add', title: 'Write', day: '2026-10-31', start: '09:00', end: '10:00', cat: 'Novel' },
        { op: 'goal', create: { title: 'Novel', hours: 10 } },
      ] as never,
      { today: new Date(2026, 9, 30), nowMin: 600, nowMs: Date.parse('2026-10-30T10:00:00Z'), nextId: () => 'e' + ++i, random: () => 0.5 },
      'local',
    );
    if (r.empty) throw new Error('ops produced nothing: ' + JSON.stringify(r));
    store.applyResult(r);
    expect(store.getState().history).toHaveLength(1);
    await engine.idle();
    expect(Object.values(server.tables.events)).toHaveLength(r.data.events.length);
    expect(Object.values(server.tables.goals)).toHaveLength(r.data.goals.length);
    // non-uuid ids from core stay as the app sees them
    expect(store.getState().data.events.map((e) => e.id)).toEqual(r.data.events.map((e) => e.id));
    expect(store.getState().data.goals.map((g) => g.id)).toEqual(r.data.goals.map((g) => g.id));
    if (r.data.goals.length) {
      const goalRow = Object.values(server.tables.goals)[0];
      const catRow = Object.values(server.tables.categories).find((c) => c.name === r.data.goals[0].cat);
      expect(goalRow.category_id).toBe(catRow?.id);
    }
  });

  it('setPrefs writes through to profiles.prefs; state is referentially stable between changes', async () => {
    const { store, engine, server } = await build();
    const s1 = store.getState();
    expect(store.getState()).toBe(s1);
    store.setPrefs({ view: 'week' });
    expect(store.getState().prefs.view).toBe('week');
    expect(store.getState()).not.toBe(s1);
    await engine.idle();
    expect(server.tables.profiles[U].prefs).toMatchObject({ view: 'week' });
  });

  it('history is device-local and persisted; it survives a restart and is never sent to the server', async () => {
    const a = await build();
    a.store.commit({ ...a.store.getState().data, events: [{ id: a.store.newId(), day: '2026-10-31', cat: null, title: 'h', start: 0, end: 30 }] }, 'Added h');
    await a.store.dispose();
    await a.engine.stop();
    expect(JSON.stringify(a.server.tables)).not.toContain('Added h');

    const engine = await SyncEngine.create({ userId: U, kv: a.kv, remote: a.server.client(U), net: { isOnline: () => true, subscribe: () => () => undefined }, retry: { enabled: false }, persistDelayMs: 0 });
    const store = await createSyncedStore({ engine, kv: a.kv });
    expect(store.getState().history.map((h) => h.label)).toEqual(['Added h']);
    expect(store.getState().data.events.map((e) => e.title)).toEqual(['h']);
  });

  it('series: setSeries writes the series row before events that reference it', async () => {
    const { store, engine, server } = await build();
    server.log.length = 0;
    store.setSeries([{ id: 's1', freq: 'weekly', weekdays: [1, 4], startDay: '2026-10-26', until: null }]);
    store.commit({ ...store.getState().data, events: [{ id: store.newId(), day: '2026-10-26', cat: 'Work', title: 'Gym', start: 420, end: 480, seriesId: 's1' }] }, 'Added Gym');
    await engine.idle();
    const writes = server.log.filter((l) => l.startsWith('upsert')).map((l) => l.split(' ')[1]);
    expect(writes).toEqual(['series', 'events']);
    expect(store.getState().series).toEqual([{ id: 's1', freq: 'weekly', weekdays: [1, 4], startDay: '2026-10-26', until: null }]);
    expect(store.getState().data.events[0].seriesId).toBe('s1');
  });
});
