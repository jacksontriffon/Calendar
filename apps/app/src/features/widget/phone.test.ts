import { DEFAULT_PREFS } from '@calendar/core';

import { createMemoryDeviceKv } from '@/lib/deviceKvMemory';
import { EMPTY_DEVICE_STATE, type DeviceCalendarInfo, type DeviceEvent } from '@/sync/deviceTypes';

import { cats, data, goals, NOW, user } from './fixtures';
import { createMemoryWidgetStorage } from './memoryStorage';
import { buildModel } from './model';
import { phoneEventsOf } from './phone';
import { loadForDraw } from './read';
import { refreshWidgetSnapshot } from './refresh';
import { buildSnapshot } from './snapshot';
import { createSnapshotWriter } from './writer';

const cal = { key: 'dc_work', name: 'Work', color: '#3366cc', account: 'iCloud', showInApp: true, canPublish: false, readOnly: true } as unknown as DeviceCalendarInfo;
const dev = (over: Partial<DeviceEvent> = {}): DeviceEvent => ({
  id: 'dev_1', hiddenKey: 'k1', calendarKey: 'dc_work', calendarName: 'Work', color: '#3366cc', account: 'iCloud',
  title: 'Dentist', day: '2026-10-30', start: 840, end: 900, allDay: false, days: 1, isMine: true, readOnlyCalendar: true, location: null, ...over,
});
const state = (events: DeviceEvent[], available = true) => ({ ...EMPTY_DEVICE_STATE, available, events, calendars: [cal] });

describe('phoneEventsOf', () => {
  it('is null when phone calendars are unavailable or empty', () => {
    expect(phoneEventsOf(state([dev()], false))).toBeNull();
    expect(phoneEventsOf(state([]))).toBeNull();
  });

  it('maps events to read-only phone events and gives the calendar a hue', () => {
    const p = phoneEventsOf(state([dev()]))!;
    expect(p.events[0]).toMatchObject({ id: 'dev_1', source: 'device', title: 'Dentist' });
    expect(Object.values(p.cats)).toHaveLength(1);
  });
});

describe('phone events in the snapshot', () => {
  const phone = phoneEventsOf(state([dev(), dev({ id: 'dev_2', title: 'Deep work', start: 600, end: 660, isMine: false })]))!;
  const build = (d = { events: [], cats, goals }) =>
    buildSnapshot({ data: d, prefs: DEFAULT_PREFS, user, now: NOW, clock: '12h', phone })!;

  it('adds the rows, in time order, never as a goal session and never with a check', () => {
    const s = build();
    expect(s.events.map((e) => e.t)).toEqual(['Deep work', 'Dentist']);
    // "Deep work" matches a goal by title, but a phone event never counts toward it.
    expect(s.events[0]).toMatchObject({ goal: null, check: false, owner: '?' });
    expect(s.events[1]).toMatchObject({ goal: null, check: false, owner: null });
    expect(s.goals.find((g) => g.title === 'Deep work')!.done).toBe(0);
  });

  it('reaches the widget model next to the app’s own events', () => {
    const s = buildSnapshot({ data, prefs: DEFAULT_PREFS, user, now: NOW, clock: '12h', phone })!;
    expect(JSON.stringify(buildModel(s, NOW.getTime(), 'large'))).toContain('Dentist');
  });

  it('changes nothing without phone events', () => {
    const without = buildSnapshot({ data, prefs: DEFAULT_PREFS, user, now: NOW, clock: '12h' })!;
    const empty = buildSnapshot({ data, prefs: DEFAULT_PREFS, user, now: NOW, clock: '12h', phone: { events: [], cats: {} } })!;
    expect(empty).toEqual(without);
  });
});

describe('refresh with phone events', () => {
  it('writes the phone events the source provides, and still writes when the phone read fails', async () => {
    const storage = createMemoryWidgetStorage();
    const writer = createSnapshotWriter({ storage, now: () => NOW });
    const store = { getState: () => ({ data: { events: [], cats, goals }, prefs: DEFAULT_PREFS }), commit: () => ({ ignored: [] }) };
    const base = { writer, storage, kv: createMemoryDeviceKv(), now: () => NOW, clock: () => '12h' as const, hidePrivate: () => false, headless: async () => null };
    const phone = phoneEventsOf(state([dev()]))!;

    await refreshWidgetSnapshot({ ...base, live: () => ({ user, store, phone: async () => phone }) });
    expect(loadForDraw(storage).snapshot!.events.map((e) => e.t)).toEqual(['Dentist']);

    await refreshWidgetSnapshot({ ...base, live: () => ({ user, store, phone: async () => { throw new Error('no permission'); } }) });
    expect(loadForDraw(storage).snapshot!.events).toEqual([]);
  });
});
