/**
 * The privacy invariant: phone events never reach Supabase. The whole bridge runs here against a
 * mocked `expo-calendar` (through the real native adapter) and the real supabase adapter on a
 * recording client, and every call that reaches the client is inspected.
 */
import * as fs from 'fs';
import * as path from 'path';

import { DeviceBridge } from './device';
import { createDeviceApi } from './deviceApi.native';
import { assertHiddenKey, assertTargetWrite, createDeviceRemote } from './deviceRemote';
import { fakeStore, memKv, ours, EV1 } from './deviceTestKit';

const mockCal = {
  calendars: [
    { id: 'cal-A', title: 'Calendar', color: '#8fb3a6', source: { name: 'iCloud', type: 'caldav' }, allowsModifications: true },
    { id: 'cal-B', title: 'Birthdays', color: '#d4a27f', source: { name: 'iCloud', type: 'birthdays' }, allowsModifications: false },
  ],
  events: [] as Record<string, unknown>[],
  created: [] as unknown[],
};

jest.mock('expo-calendar/legacy', () => ({
  EntityTypes: { EVENT: 'event' },
  getCalendarPermissionsAsync: async () => ({ status: 'granted', granted: true, canAskAgain: true }),
  requestCalendarPermissionsAsync: async () => ({ status: 'granted', granted: true, canAskAgain: true }),
  getCalendarsAsync: async () => mockCal.calendars,
  getEventsAsync: async (ids: string[]) => mockCal.events.filter((e) => ids.includes(e.calendarId as string)),
  createEventAsync: async (calendarId: string, d: unknown) => {
    mockCal.created.push({ calendarId, d });
    return 'os-created-1';
  },
  updateEventAsync: async () => 'os-created-1',
  deleteEventAsync: async () => undefined,
}));

/** A supabase client that records every call and answers like an empty database (plus the Google rows). */
function recordingClient() {
  const calls: { table: string; op: string; payload?: unknown; filters: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const rec: { table: string; op: string; payload?: unknown; filters: unknown[] } = { table, op: 'select', filters: [] };
      calls.push(rec);
      const data = () => {
        if (table === 'google_accounts_public') return [{ id: 'acc1', email: 'sam@gmail.com' }];
        if (table === 'google_calendars') return [{ account_id: 'acc1', name: 'Family' }];
        return [];
      };
      const b: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => {
        if (['select', 'upsert', 'insert', 'update', 'delete'].includes(name)) {
          if (name !== 'select' || rec.op === 'select') rec.op = name;
          if (name !== 'select') rec.payload = args[0];
        } else rec.filters.push([name, ...args]);
        return b;
      };
      ['select', 'upsert', 'insert', 'update', 'delete', 'eq', 'order', 'range', 'in', 'is'].forEach((n) => { b[n] = chain(n); });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null, status: 200 }).then(res);
      return b;
    },
  };
  return { client: client as never, calls };
}

// Strings that are phone-event data: none may ever appear in anything sent to Supabase.
const SECRETS = ['Therapy with Dr Okafor', 'Surprise party for Maya', '123 Hidden Lane', 'os-phone-evt-77', 'os-phone-evt-78', 'cal-A', 'cal-B'];

const NOW = new Date(2026, 10, 3, 12, 0);

async function run() {
  mockCal.events = [
    { id: 'os-phone-evt-77', calendarId: 'cal-A', title: 'Therapy with Dr Okafor', startDate: new Date(2026, 10, 4, 9, 0), endDate: new Date(2026, 10, 4, 10, 0), allDay: false, location: '123 Hidden Lane', notes: 'private', organizer: { isCurrentUser: false } },
    { id: 'os-phone-evt-78', calendarId: 'cal-B', title: 'Surprise party for Maya', startDate: new Date(2026, 10, 6), endDate: new Date(2026, 10, 6, 23, 59, 59), allDay: true },
  ];
  const { client, calls } = recordingClient();
  const store = fakeStore([ours(EV1, { title: 'Review with the team' })]);
  const bridge = new DeviceBridge({
    api: createDeviceApi(), base: memKv(), userId: 'u1', remote: createDeviceRemote(client), store,
    now: () => NOW, refreshEveryMs: 0, retryMs: 0, debounceMs: 0, timeZone: 'UTC',
  });
  await bridge.start();
  // Everything a user can do with phone events and calendars.
  const calKey = bridge.getState().calendars.find((c) => c.name === 'Calendar')!.key;
  await bridge.setCalendarFlags(calKey, { canPublish: true });
  await bridge.setTargets(EV1, [calKey]);
  const shown = bridge.getState().events;
  expect(shown.map((e) => e.title).sort()).toEqual(['Surprise party for Maya', 'Therapy with Dr Okafor']);
  const hidden = bridge.hideEvent(shown.find((e) => e.title.startsWith('Therapy'))!.id)!;
  await bridge.idle();
  bridge.unhideEvent(hidden.hiddenKey);
  await bridge.idle();
  store.set([ours(EV1, { title: 'Review, moved', start: 700, end: 760 })]);
  await new Promise((r) => setTimeout(r, 5));
  await bridge.idle();
  store.set([ours(EV1, { visibility: 'private' })]);
  await new Promise((r) => setTimeout(r, 5));
  await bridge.idle();
  await bridge.refresh();
  return { calls, calKey, bridge };
}

describe('privacy invariant: phone events never reach Supabase', () => {
  it('sends nothing that carries a phone event’s title, time, place or id', async () => {
    mockCal.created = [];
    const { calls } = await run();
    expect(mockCal.created).toHaveLength(1); // the bridge really did talk to the (mocked) phone
    const wire = JSON.stringify(calls);
    SECRETS.forEach((s) => expect(wire).not.toContain(s));
    // and not even our own event's title: only status rows, never content
    expect(wire).not.toContain('Review with the team');
    expect(wire).not.toContain('Review, moved');
  });

  it('writes only event_targets (device) and hidden_items (opaque key), and only reads the rest', async () => {
    const { calls } = await run();
    const writes = calls.filter((c) => c.op !== 'select');
    expect(writes.length).toBeGreaterThan(0);
    writes.forEach((w) => expect(['event_targets', 'hidden_items']).toContain(w.table));
    calls.filter((c) => c.op === 'select').forEach((c) => expect(['event_targets', 'hidden_items', 'google_accounts_public', 'google_calendars']).toContain(c.table));
    calls.filter((c) => c.table === 'event_targets' && c.op === 'upsert').forEach((c) => {
      (c.payload as Record<string, unknown>[]).forEach((r) => {
        expect(Object.keys(r).sort()).toEqual(['device_calendar_key', 'device_id', 'error', 'event_id', 'external_id', 'fingerprint', 'kind', 'status', 'synced_at'].sort());
        expect(r.kind).toBe('device');
        expect(r.event_id).toBe(EV1);
      });
    });
    calls.filter((c) => c.table === 'hidden_items' && c.op === 'upsert').forEach((c) => {
      const p = c.payload as { source: string; external_key: string };
      expect(p.source).toBe('device');
      expect(p.external_key).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it('the remote refuses anything that is not a status row about our own event', () => {
    const ok = { event_id: EV1, kind: 'device' as const, device_id: 'dev-1234abcd', device_calendar_key: 'dc_0123456789abcdef', external_id: 'os-1', fingerprint: 'a'.repeat(24), status: 'synced' as const, error: null, synced_at: null };
    expect(() => assertTargetWrite(ok)).not.toThrow();
    expect(() => assertTargetWrite({ ...ok, title: 'Therapy' } as never)).toThrow();
    expect(() => assertTargetWrite({ ...ok, error: 'Therapy with Dr Okafor' } as never)).toThrow();
    expect(() => assertTargetWrite({ ...ok, event_id: 'os-phone-evt-77' })).toThrow();
    expect(() => assertTargetWrite({ ...ok, fingerprint: 'Therapy' })).toThrow();
    expect(() => assertHiddenKey('cal-A:os-phone-evt-77')).toThrow();
  });

  it('only deviceRemote.ts may import supabase', () => {
    const dirs = [path.join(__dirname), path.join(__dirname, '..', 'features', 'calendars', 'device')];
    const offenders: string[] = [];
    dirs.forEach((dir) => {
      fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && (dir !== __dirname || f.startsWith('device'))).forEach((f) => {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        const uses = /from ['"](@supabase\/supabase-js|@\/lib\/supabase|\.\.\/\.\.\/\.\.\/lib\/supabase)['"]/.test(src);
        if (uses && !['deviceRemote.ts', 'host.ts'].includes(f)) offenders.push(f);
      });
    });
    expect(offenders).toEqual([]);
    // host.ts only constructs the remote; it never calls supabase itself
    const host = fs.readFileSync(path.join(__dirname, '..', 'features', 'calendars', 'device', 'host.ts'), 'utf8');
    expect(host.match(/supabase\.\w+/g)).toBeNull();
  });
});
