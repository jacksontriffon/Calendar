import { DeviceBridge } from './device';
import { OWN_COPY_MARKER } from './deviceMap';
import { EV1, EV2, FakeApi, FakeRemote, cal, fakeStore, memKv, ours, raw } from './deviceTestKit';

const NOW = new Date(2026, 10, 3, 12, 0);

async function setup(opts: { events?: Parameters<typeof fakeStore>[0]; api?: FakeApi; remote?: FakeRemote; base?: ReturnType<typeof memKv> } = {}) {
  const api = opts.api ?? new FakeApi();
  if (!api.calendars.length) api.calendars = [cal('c1', 'Calendar'), cal('c2', 'Home'), cal('c3', 'Birthdays', 'iCloud', { allowsModifications: false })];
  const remote = opts.remote ?? new FakeRemote();
  const store = fakeStore(opts.events ?? []);
  const base = opts.base ?? memKv();
  const bridge = new DeviceBridge({ api, base, userId: 'u1', remote, store, now: () => NOW, refreshEveryMs: 0, retryMs: 0, debounceMs: 0, timeZone: 'UTC' });
  await bridge.start();
  const keyOf = (name: string) => bridge.getState().calendars.find((c) => c.name === name)!.key;
  return { api, remote, store, base, bridge, keyOf };
}

describe('reading', () => {
  it('lists calendars with defaults and reads only those shown in the app', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Calendar'), cal('c2', 'Home')];
    api.events.set('a', raw('a', 'c1', 'Dentist', new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 10)));
    api.events.set('b', raw('b', 'c2', 'Boiler', new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 10)));
    const { bridge, keyOf } = await setup({ api });
    expect(bridge.getState().available).toBe(true);
    expect(bridge.getState().calendars.map((c) => [c.name, c.showInApp, c.canPublish])).toEqual([['Calendar', true, false], ['Home', true, false]]);
    expect(bridge.getState().events.map((e) => e.title).sort()).toEqual(['Boiler', 'Dentist']);
    await bridge.setCalendarFlags(keyOf('Home'), { showInApp: false });
    expect(bridge.getState().events.map((e) => e.title)).toEqual(['Dentist']);
  });

  it('keeps the flags device-local across a restart, per user', async () => {
    const base = memKv();
    const a = await setup({ base });
    await a.bridge.setCalendarFlags(a.keyOf('Home'), { showInApp: false, canPublish: true });
    await a.bridge.stop();
    const b = await setup({ base });
    expect(b.bridge.getState().calendars.find((c) => c.name === 'Home')).toMatchObject({ showInApp: false, canPublish: true });
    const other = new DeviceBridge({ api: b.api, base, userId: 'u2', remote: new FakeRemote(), store: fakeStore(), now: () => NOW, refreshEveryMs: 0, retryMs: 0 });
    await other.start();
    expect(other.getState().calendars.find((c) => c.name === 'Home')).toMatchObject({ showInApp: true, canPublish: false });
  });

  it('never lets a read-only calendar publish', async () => {
    const { bridge, keyOf } = await setup();
    await bridge.setCalendarFlags(keyOf('Birthdays'), { canPublish: true });
    expect(bridge.getState().calendars.find((c) => c.name === 'Birthdays')!.canPublish).toBe(false);
  });

  it('reports no events without permission, and asks once', async () => {
    const api = new FakeApi();
    api.permission = { status: 'undetermined', canAskAgain: true };
    const { bridge } = await setup({ api });
    expect(bridge.getState()).toMatchObject({ available: false, permission: 'undetermined', calendars: [] });
    api.permission = { status: 'granted', canAskAgain: true };
    await bridge.requestPermission();
    expect(bridge.getState().available).toBe(true);
  });

  it('does nothing at all where phone calendars are unsupported (web)', async () => {
    const api = new FakeApi();
    api.supported = false;
    const { bridge, remote } = await setup({ api, events: [ours(EV1)] });
    await bridge.setTargets(EV1, ['dc_0123456789abcdef']);
    await bridge.refresh();
    expect(bridge.getState()).toMatchObject({ supported: false, available: false, events: [] });
    expect(api.calls).toEqual([]);
    expect(remote.writes).toEqual([]);
  });

  it('hides phone calendars that duplicate a connected Google calendar', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Family', 'sam@gmail.com'), cal('c2', 'Personal', 'On device')];
    api.events.set('a', raw('a', 'c1', 'Dup', new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 10)));
    const remote = new FakeRemote();
    remote.google = [{ name: 'Family', accountEmail: 'sam@gmail.com' }];
    const { bridge } = await setup({ api, remote });
    expect(bridge.getState().calendars.map((c) => c.name)).toEqual(['Personal']);
    expect(bridge.getState().duplicateAccounts).toEqual(['sam@gmail.com']);
    expect(bridge.getState().events).toEqual([]);
  });

  it('skips copies of our own events', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Calendar')];
    api.events.set('x', raw('x', 'c1', 'Ours', new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 10), { notes: OWN_COPY_MARKER + EV1 }));
    const { bridge } = await setup({ api });
    expect(bridge.getState().events).toEqual([]);
  });
});

describe('hiding someone else’s event', () => {
  it('inserts an opaque hidden key, filters the event, and Undo removes it again', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Calendar')];
    api.events.set('a', raw('a', 'c1', 'Maya dinner', new Date(2026, 10, 4, 18), new Date(2026, 10, 4, 20), { organizerIsCurrentUser: false }));
    const { bridge, remote } = await setup({ api });
    const ev = bridge.getState().events[0];
    expect(ev.isMine).toBe(false);
    const hidden = bridge.hideEvent(ev.id)!;
    await bridge.idle();
    expect(bridge.getState().events).toEqual([]);
    expect(bridge.getState().hidden.map((e) => e.id)).toEqual([ev.id]);
    expect(remote.hidden).toEqual([hidden.hiddenKey]);
    expect(remote.hidden[0]).toMatch(/^[0-9a-f]{40}$/);
    bridge.unhideEvent(hidden.hiddenKey);
    await bridge.idle();
    expect(remote.hidden).toEqual([]);
    expect(bridge.getState().events).toHaveLength(1);
  });

  it('keeps hidden keys from the server, and reports ones made offline later', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Calendar')];
    api.events.set('a', raw('a', 'c1', 'A', new Date(2026, 10, 4, 18), new Date(2026, 10, 4, 20)));
    const remote = new FakeRemote();
    remote.offline = true;
    const { bridge } = await setup({ api, remote });
    const id = bridge.getState().events[0].id;
    const h = bridge.hideEvent(id)!;
    await bridge.idle();
    expect(remote.hidden).toEqual([]);
    remote.offline = false;
    await bridge.refresh();
    expect(remote.hidden).toEqual([h.hiddenKey]);
    expect(bridge.getState().events).toEqual([]);
  });
});

describe('publishing our events', () => {
  const publishSetup = async (events = [ours(EV1)]) => {
    const s = await setup({ events });
    await s.bridge.setCalendarFlags(s.keyOf('Calendar'), { canPublish: true });
    return s;
  };

  it('creates the phone event and reports a synced row', async () => {
    const { api, remote, bridge, keyOf } = await publishSetup();
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    expect(api.calls.filter((c) => c === 'create')).toHaveLength(1);
    const copy = [...api.events.values()][0];
    expect(copy).toMatchObject({ calendarId: 'c1', title: 'Review with the team' });
    expect(remote.writes.at(-1)).toMatchObject({ event_id: EV1, kind: 'device', device_calendar_key: keyOf('Calendar'), status: 'synced', error: null, external_id: copy.id });
    expect(remote.writes.at(-1)!.device_id).toBeTruthy();
    expect(bridge.getState().targets[EV1]).toEqual([{ key: keyOf('Calendar'), status: 'synced', mine: true }]);
    // our own copy is not shown as a phone event
    expect(bridge.getState().events).toEqual([]);
  });

  it('updates when the fingerprint changes, and not otherwise', async () => {
    const { api, store, bridge, keyOf } = await publishSetup();
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    store.set([ours(EV1, { done: true })]);
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.calls).toEqual(['create']);
    store.set([ours(EV1, { title: 'Moved', start: 660, end: 720 })]);
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.calls).toEqual(['create', 'update']);
    expect([...api.events.values()][0].title).toBe('Moved');
  });

  it('recreates the copy when the user deleted it on the phone', async () => {
    const { api, bridge, keyOf, store } = await publishSetup();
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    api.events.clear();
    store.set([ours(EV1, { title: 'Again' })]);
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.calls).toEqual(['create', 'update', 'create']);
    expect(api.events.size).toBe(1);
  });

  it('deletes the phone copy and the row when the event goes private', async () => {
    const { api, remote, store, bridge, keyOf } = await publishSetup();
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    store.set([ours(EV1, { visibility: 'private' })]);
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.calls).toEqual(['create', 'delete']);
    expect(api.events.size).toBe(0);
    expect(remote.deletes).toEqual([{ event_id: EV1, device_id: expect.any(String), device_calendar_key: keyOf('Calendar') }]);
    expect(bridge.getState().targets[EV1]).toBeUndefined();
  });

  it('deletes the copy when the event is deleted (once the store has settled)', async () => {
    const { api, remote, store, bridge, keyOf } = await publishSetup();
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    store.set([], 'offline'); // an empty, not yet synced store must not wipe published copies
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.events.size).toBe(1);
    store.set([], 'idle');
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.events.size).toBe(0);
    expect(remote.deletes).toHaveLength(1);
  });

  it('un-publishes calendars that are no longer ticked', async () => {
    const { api, bridge, keyOf } = await publishSetup();
    await bridge.setCalendarFlags(keyOf('Home'), { canPublish: true });
    await bridge.setTargets(EV1, [keyOf('Calendar'), keyOf('Home')]);
    expect(api.events.size).toBe(2);
    await bridge.setTargets(EV1, [keyOf('Home')]);
    expect(api.events.size).toBe(1);
    expect([...api.events.values()][0].calendarId).toBe('c2');
    await bridge.setTargets(EV1, []);
    expect(api.events.size).toBe(0);
  });

  it('waits while the event is private, and publishes once it is public', async () => {
    const { api, store, bridge, keyOf } = await publishSetup([ours(EV1, { visibility: 'private' })]);
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    expect(api.calls).toEqual([]);
    expect(bridge.getState().targets[EV1]).toEqual([{ key: keyOf('Calendar'), status: 'pending', mine: true }]);
    store.set([ours(EV1)]);
    await new Promise((r) => setTimeout(r, 5));
    await bridge.idle();
    expect(api.calls).toEqual(['create']);
  });

  it('marks a target failed when the calendar may not take events, or the write fails', async () => {
    const { api, remote, bridge, keyOf } = await setup({ events: [ours(EV1)] });
    await bridge.setTargets(EV1, [keyOf('Calendar')]); // Can publish to is off
    expect(bridge.getState().targets[EV1][0].status).toBe('failed');
    expect(remote.writes.at(-1)).toMatchObject({ status: 'failed', error: 'not_allowed' });
    api.failWrites = true;
    await bridge.setCalendarFlags(keyOf('Calendar'), { canPublish: true });
    expect(remote.writes.at(-1)).toMatchObject({ status: 'failed', error: 'write_failed' });
    api.failWrites = false;
    await bridge.refresh();
    expect(bridge.getState().targets[EV1][0].status).toBe('synced');
  });

  it('shows queued while the status cannot be reported, then reports it', async () => {
    const { remote, bridge, keyOf } = await publishSetup();
    remote.offline = true;
    await bridge.setTargets(EV1, [keyOf('Calendar')]);
    expect(bridge.getState().targets[EV1][0].status).toBe('queued');
    remote.offline = false;
    await bridge.refresh();
    expect(bridge.getState().targets[EV1][0].status).toBe('synced');
    expect(remote.writes.at(-1)!.status).toBe('synced');
  });

  it('does not publish before the store is the user’s loaded data', async () => {
    const api = new FakeApi();
    api.calendars = [cal('c1', 'Calendar')];
    const store = fakeStore([ours(EV1)]);
    const bridge = new DeviceBridge({ api, base: memKv(), userId: 'u1', remote: new FakeRemote(), store, now: () => NOW, refreshEveryMs: 0, retryMs: 0, debounceMs: 0 });
    bridge.setStoreReady(false);
    await bridge.start();
    await bridge.setCalendarFlags(bridge.getState().calendars[0].key, { canPublish: true });
    await bridge.setTargets(EV1, [bridge.getState().calendars[0].key]);
    expect(api.calls).toEqual([]);
    bridge.setStoreReady(true);
    await bridge.idle();
    expect(api.calls).toEqual(['create']);
  });

  it('shows other devices’ rows but never acts on them', async () => {
    const remote = new FakeRemote();
    remote.rows = [{ event_id: EV2, device_id: 'other-device', device_calendar_key: 'dc_aaaaaaaaaaaaaaaa', external_id: 'x1', fingerprint: null, status: 'synced' }];
    const { api, bridge } = await setup({ remote, events: [ours(EV2, { visibility: 'private' })] });
    expect(bridge.getState().targets[EV2]).toEqual([{ key: 'dc_aaaaaaaaaaaaaaaa', status: 'synced', mine: false }]);
    expect(api.calls).toEqual([]);
    expect(remote.deletes).toEqual([]);
    expect(remote.writes).toEqual([]);
  });

  it('adopts this device’s own rows it has no local record of', async () => {
    const first = await publishSetup();
    await first.bridge.setTargets(EV1, [first.keyOf('Calendar')]);
    const { remote, api } = first;
    remote.rows = remote.writes.map((w) => ({ ...w })) as never;
    await first.base.removeItem('calendar:v1:device:u1:state'); // this device lost its local record
    const second = new DeviceBridge({ api, base: first.base, userId: 'u1', remote, store: first.store, now: () => NOW, refreshEveryMs: 0, retryMs: 0, debounceMs: 0 });
    await second.start();
    expect(second.getState().targets[EV1]).toHaveLength(1);
    expect(api.calls.filter((c) => c === 'create')).toHaveLength(1);
  });
});
