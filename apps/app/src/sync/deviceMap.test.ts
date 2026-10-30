import { hiddenKey, isItemId, itemId, sha256Hex } from './deviceHash';
import {
  OWN_COPY_MARKER, buildCalendars, fingerprintOf, findDuplicates, hueOfColor, isOwnCopy, isPublishable, mapEvent, toProtoEvent, toWrite, windowFor,
} from './deviceMap';
import { cal, ours, raw } from './deviceTestKit';

const info = (r = cal('c1', 'Calendar')) => buildCalendars([r], {})[0];

describe('sha256', () => {
  it('matches the known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('é€😀')).toHaveLength(64);
  });
  it('item and hidden keys are opaque and stable', () => {
    const k = hiddenKey('cal-1', 'evt-9');
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(k).not.toContain('evt');
    expect(hiddenKey('cal-1', 'evt-9')).toBe(k);
    expect(isItemId(itemId('cal-1', 'evt-9', '2026-11-03T10:00:00.000Z'))).toBe(true);
  });
});

describe('read mapping', () => {
  it('maps a timed event to floating local day and minutes, ignoring its time zone', () => {
    const e = mapEvent(raw('e1', 'c1', 'Standup', new Date(2026, 10, 3, 9, 30), new Date(2026, 10, 3, 10, 15), { notes: 'x' }), info(), 'ios')!;
    expect([e.day, e.start, e.end, e.allDay, e.days]).toEqual(['2026-11-03', 570, 615, false, 1]);
    expect(e.isMine).toBe(true);
  });

  it('runs an overnight event past 1440 on its start day', () => {
    const e = mapEvent(raw('e1', 'c1', 'Late', new Date(2026, 10, 3, 22, 0), new Date(2026, 10, 4, 1, 30)), info(), 'ios')!;
    expect([e.day, e.start, e.end]).toEqual(['2026-11-03', 1320, 1530]);
  });

  it('gives a zero-length event 15 minutes', () => {
    const t = new Date(2026, 10, 3, 9, 0);
    expect(mapEvent(raw('e1', 'c1', 'Ping', t, t), info(), 'ios')!.end).toBe(555);
  });

  it('maps all-day spans on iOS (local, inclusive end) and Android (UTC, exclusive end)', () => {
    const ios = mapEvent(raw('e1', 'c1', 'Trip', new Date(2026, 10, 5), new Date(2026, 10, 7, 23, 59, 59), { allDay: true }), info(), 'ios')!;
    expect([ios.day, ios.allDay, ios.days, ios.start, ios.end]).toEqual(['2026-11-05', true, 3, 0, 1440]);
    const and = mapEvent(raw('e1', 'c1', 'Trip', new Date(Date.UTC(2026, 10, 5)), new Date(Date.UTC(2026, 10, 8)), { allDay: true }), info(), 'android')!;
    expect([and.day, and.days]).toEqual(['2026-11-05', 3]);
    const one = mapEvent(raw('e1', 'c1', 'Day', new Date(Date.UTC(2026, 10, 5)), new Date(Date.UTC(2026, 10, 6)), { allDay: true }), info(), 'android')!;
    expect(one.days).toBe(1);
  });

  it('turns a timed event longer than a day into an all-day span', () => {
    const e = mapEvent(raw('e1', 'c1', 'Conference', new Date(2026, 10, 3, 9), new Date(2026, 10, 6, 17)), info(), 'ios')!;
    expect([e.allDay, e.day, e.days]).toEqual([true, '2026-11-03', 4]);
  });

  it('is not mine when the organizer is someone else, or the calendar is read-only', () => {
    const t = [new Date(2026, 10, 3, 9), new Date(2026, 10, 3, 10)] as const;
    expect(mapEvent(raw('e', 'c1', 'A', ...t, { organizerIsCurrentUser: false }), info(), 'ios')!.isMine).toBe(false);
    expect(mapEvent(raw('e', 'c1', 'A', ...t, { organizerIsCurrentUser: true }), info(), 'ios')!.isMine).toBe(true);
    const android = info(cal('c1', 'Work', 'sam@x.com'));
    expect(mapEvent(raw('e', 'c1', 'A', ...t, { organizerEmail: 'maya@x.com' }), android, 'android', 'sam@x.com')!.isMine).toBe(false);
    expect(mapEvent(raw('e', 'c1', 'A', ...t, { organizerEmail: 'SAM@x.com' }), android, 'android', 'sam@x.com')!.isMine).toBe(true);
    const ro = info(cal('c2', 'Birthdays', 'iCloud', { allowsModifications: false }));
    expect(mapEvent(raw('e', 'c2', 'A', ...t), ro, 'ios')!.isMine).toBe(false);
  });

  it('builds a read-only view event with source device and the calendar hue', () => {
    const d = mapEvent(raw('e1', 'c1', 'Standup', new Date(2026, 10, 3, 9), new Date(2026, 10, 3, 10)), info(), 'ios')!;
    const p = toProtoEvent(d);
    expect(p.source).toBe('device');
    expect(p.cat).toBe('phone:' + d.calendarKey);
    expect(hueOfColor('#ff0000')).toBeGreaterThanOrEqual(0);
    expect(hueOfColor('nope')).toBe(30);
  });

  it('recognises copies of our own events by their notes', () => {
    expect(isOwnCopy({ notes: 'Added by Calendar\n' + OWN_COPY_MARKER + 'abc' })).toBe(true);
    expect(isOwnCopy({ notes: 'Dentist' })).toBe(false);
  });

  it('keeps a stable key per account + name and numbers true twins', () => {
    const a = buildCalendars([cal('1', 'Home'), cal('2', 'Home'), cal('3', 'Home', 'Gmail')], {});
    expect(new Set(a.map((c) => c.key)).size).toBe(3);
    expect(buildCalendars([cal('9', 'Home', 'Gmail')], {})[0].key).toBe(a[2].key);
  });
});

describe('duplicates (CA 4.5)', () => {
  it('hides phone calendars matching a connected Google account and calendar name', () => {
    const cals = buildCalendars(
      [cal('1', 'Family', 'sam@gmail.com'), cal('2', 'Personal', 'On device'), cal('3', 'sam@gmail.com', 'sam@gmail.com', { internalName: 'sam@gmail.com' }), cal('4', 'Other', 'sam@gmail.com')],
      {},
    );
    const r = findDuplicates(cals, [{ name: 'Family', accountEmail: 'Sam@Gmail.com' }, { name: 'Sam Rivera', accountEmail: 'sam@gmail.com' }]);
    expect([...r.keys].sort()).toEqual([cals[0].key, cals[2].key].sort());
    expect(r.accounts).toEqual(['Sam@Gmail.com', 'sam@gmail.com'].filter((a) => r.accounts.includes(a)));
    expect(r.keys.has(cals[1].key)).toBe(false);
    expect(r.keys.has(cals[3].key)).toBe(false);
  });
});

describe('publishing helpers', () => {
  it('publishes only our own public events', () => {
    expect(isPublishable(ours('a'))).toBe(true);
    expect(isPublishable(ours('a', { visibility: 'private' }))).toBe(false);
    expect(isPublishable(ours('a', { source: 'google' }))).toBe(false);
    expect(isPublishable(ours('a', { isMine: false }))).toBe(false);
  });
  it('fingerprints what is written, and writes floating times', () => {
    const e = ours('a');
    expect(fingerprintOf(e)).toBe(fingerprintOf({ ...e, ...({ cat: 'Food', done: true } as object) }));
    expect(fingerprintOf(e)).not.toBe(fingerprintOf({ ...e, end: 700 }));
    const w = toWrite(e, 'ios', 'Europe/London');
    expect([w.startDate.getHours(), w.startDate.getMinutes(), w.endDate.getHours(), w.endDate.getMinutes()]).toEqual([10, 0, 11, 30]);
    expect(w.notes).toContain(OWN_COPY_MARKER + 'a');
    const ad = toWrite(ours('a', { allDay: true, days: 2, start: 0, end: 1440 }), 'android', 'UTC');
    expect([ad.startDate.toISOString(), ad.endDate.toISOString(), ad.timeZone]).toEqual(['2026-11-03T00:00:00.000Z', '2026-11-05T00:00:00.000Z', 'UTC']);
  });
  it('windows are today -14 / +60, widened on request and capped', () => {
    const today = new Date(2026, 10, 3, 15);
    const w = windowFor(today);
    expect([w.from.getDate(), w.from.getMonth(), w.to.getMonth(), w.to.getDate()]).toEqual([20, 9, 0, 2]);
    expect(windowFor(today, { from: new Date(2020, 0, 1), to: new Date(2030, 0, 1) }).from.getFullYear()).toBe(2025);
  });
});
