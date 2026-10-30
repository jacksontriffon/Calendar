/** Test-only fakes for the phone-calendar bridge: OS calendar, remote, store. */
import type { ProtoEvent } from '@calendar/core';

import { createMemoryKv } from './kv';
import type {
  DeviceCalendarApi,
  DeviceEventWrite,
  DevicePermission,
  DeviceRemote,
  RawCalendar,
  RawEvent,
  RemoteTargetRow,
  TargetWrite,
  GoogleCalendarRef,
} from './deviceTypes';

export const EV1 = '11111111-1111-4111-8111-111111111111';
export const EV2 = '22222222-2222-4222-8222-222222222222';

export const cal = (id: string, title: string, account = 'iCloud', extra: Partial<RawCalendar> = {}): RawCalendar => ({
  id, title, color: '#8fb3a6', account, allowsModifications: true, ...extra,
});

export const raw = (id: string, calendarId: string, title: string, start: Date, end: Date, extra: Partial<RawEvent> = {}): RawEvent => ({
  id, calendarId, title, startDate: start, endDate: end, allDay: false, ...extra,
});

export class FakeApi implements DeviceCalendarApi {
  platform: DeviceCalendarApi['platform'] = 'ios';
  supported = true;
  permission: DevicePermission = { status: 'granted', canAskAgain: true };
  calendars: RawCalendar[] = [];
  /** events on the phone, by id (includes the ones we write) */
  events = new Map<string, RawEvent & { write?: DeviceEventWrite }>();
  calls: string[] = [];
  seq = 0;
  failWrites = false;

  async getPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async getCalendars() { return this.calendars; }
  async getEvents(ids: string[]) { return [...this.events.values()].filter((e) => ids.includes(e.calendarId)); }
  async createEvent(calendarId: string, d: DeviceEventWrite) {
    this.calls.push('create');
    if (this.failWrites) throw new Error('boom');
    const id = 'os-' + ++this.seq;
    this.events.set(id, { id, calendarId, title: d.title, startDate: d.startDate, endDate: d.endDate, allDay: d.allDay, notes: d.notes, write: d });
    return id;
  }
  async updateEvent(id: string, d: DeviceEventWrite) {
    this.calls.push('update');
    const e = this.events.get(id);
    if (!e) throw new Error('Event not found');
    this.events.set(id, { ...e, title: d.title, startDate: d.startDate, endDate: d.endDate, allDay: d.allDay, write: d });
  }
  async deleteEvent(id: string) {
    this.calls.push('delete');
    if (!this.events.delete(id)) throw new Error('Event not found');
  }
}

export class FakeRemote implements DeviceRemote {
  rows: RemoteTargetRow[] = [];
  hidden: string[] = [];
  google: GoogleCalendarRef[] = [];
  writes: TargetWrite[] = [];
  deletes: { event_id: string; device_id: string; device_calendar_key: string }[] = [];
  offline = false;
  private guard() { if (this.offline) throw new Error('offline'); }
  async fetchTargets() { this.guard(); return this.rows; }
  async upsertTargets(rows: TargetWrite[]) { this.guard(); this.writes.push(...rows); }
  async deleteTargets(k: { event_id: string; device_id: string; device_calendar_key: string }[]) { this.guard(); this.deletes.push(...k); }
  async fetchHiddenKeys() { this.guard(); return this.hidden; }
  async insertHidden(k: string) { this.guard(); this.hidden.push(k); }
  async deleteHidden(k: string) { this.guard(); this.hidden = this.hidden.filter((x) => x !== k); }
  async fetchGoogleCalendars() { this.guard(); return this.google; }
}

export function fakeStore(events: ProtoEvent[] = []) {
  let state = { data: { events }, sync: 'idle' };
  const ls = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(l: () => void) { ls.add(l); return () => { ls.delete(l); }; },
    set(next: ProtoEvent[], sync = 'idle') { state = { data: { events: next }, sync }; ls.forEach((l) => l()); },
  };
}

export const ours = (id: string, over: Partial<ProtoEvent> = {}): ProtoEvent => ({
  id, day: '2026-11-03', cat: 'Work', title: 'Review with the team', start: 600, end: 690, visibility: 'public', source: 'app', isMine: true, ...over,
});

export const memKv = createMemoryKv;
