import { assert, assertEquals } from './testing/harness.ts';
import { isGone, isMine, isOwnCopy, isShared, mapCalendarEntry, mapGoogleEvent, mapTimes, newCalendarDefaults } from './mapping.ts';
import { assertPublishable, buildGoogleEvent, fingerprintOf, PrivateEventError, rruleFor } from './publish_map.ts';
import { instantToLocal, localIso, localToUtcMs, shiftDay } from './tz.ts';
import { hashState, isAllowedReturnUrl, looksLikeState, newState, parseReturnUrls, withParams } from './state.ts';
import { channelToken, verifyChannelToken } from './webhook.ts';
import type { AppEvent } from './types.ts';

const NY = 'America/New_York';
const timed = (s: string, e: string) => ({ start: { dateTime: s }, end: { dateTime: e } });

/* ------------------------------------------------------------------ tz conversion */

Deno.test('tz: instants become wall-clock day/minute in the profile zone', () => {
  assertEquals(mapTimes(timed('2026-10-30T13:00:00Z', '2026-10-30T14:30:00Z'), NY), { day: '2026-10-30', start_min: 540, end_min: 630, all_day: false, days: 1 });
  assertEquals(mapTimes(timed('2026-10-30T09:00:00+01:00', '2026-10-30T10:00:00+01:00'), 'Europe/London'), { day: '2026-10-30', start_min: 480, end_min: 540, all_day: false, days: 1 });
  // an offset-bearing string in another zone converts to the profile zone
  assertEquals(mapTimes(timed('2026-10-30T09:00:00-07:00', '2026-10-30T10:00:00-07:00'), 'Asia/Tokyo'), { day: '2026-10-31', start_min: 60, end_min: 120, all_day: false, days: 1 });
});

Deno.test('tz: the same wall time is 09:00 either side of the autumn DST change', () => {
  // US DST ended on 2026-11-01
  assertEquals(mapTimes(timed('2026-10-31T13:00:00Z', '2026-10-31T14:00:00Z'), NY)!.start_min, 540); // EDT
  assertEquals(mapTimes(timed('2026-11-01T14:00:00Z', '2026-11-01T15:00:00Z'), NY)!.start_min, 540); // EST
  // the repeated hour: 05:30Z is 01:30 EDT, 06:30Z is 01:30 EST
  assertEquals(instantToLocal(Date.parse('2026-11-01T05:30:00Z'), NY), { day: '2026-11-01', min: 90 });
  assertEquals(instantToLocal(Date.parse('2026-11-01T06:30:00Z'), NY), { day: '2026-11-01', min: 90 });
});

Deno.test('tz: an event across the spring-forward gap keeps its wall-clock length', () => {
  // 01:30 EST -> 03:30 EDT on 2026-03-08 is one hour elapsed but two hours on the wall clock
  assertEquals(mapTimes(timed('2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z'), NY), { day: '2026-03-08', start_min: 90, end_min: 210, all_day: false, days: 1 });
});

Deno.test('tz: local -> UTC, including the gap and the repeated hour', () => {
  assertEquals(new Date(localToUtcMs('2026-10-30', 540, NY)).toISOString(), '2026-10-30T13:00:00.000Z');
  assertEquals(new Date(localToUtcMs('2026-12-01', 540, NY)).toISOString(), '2026-12-01T14:00:00.000Z');
  assertEquals(new Date(localToUtcMs('2026-03-08', 150, NY)).toISOString(), '2026-03-08T07:30:00.000Z'); // 02:30 does not exist -> 03:30 EDT
  assertEquals(new Date(localToUtcMs('2026-11-01', 90, NY)).toISOString(), '2026-11-01T05:30:00.000Z'); // first of the two 01:30s
  assertEquals(new Date(localToUtcMs('2026-10-30', 540, 'UTC')).toISOString(), '2026-10-30T09:00:00.000Z');
});

Deno.test('tz: floating dateTime strings use the event zone, then convert', () => {
  assertEquals(mapTimes({ start: { dateTime: '2026-10-30T09:00:00', timeZone: NY }, end: { dateTime: '2026-10-30T10:00:00', timeZone: NY } }, NY)!.start_min, 540);
  assertEquals(mapTimes({ start: { dateTime: '2026-10-30T09:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-30T10:00:00', timeZone: 'UTC' } }, NY)!.start_min, 300);
});

Deno.test('tz: day arithmetic and ISO strings', () => {
  assertEquals(shiftDay('2026-12-31', 1), '2027-01-01');
  assertEquals(shiftDay('2026-03-01', -1), '2026-02-28');
  assertEquals(localIso('2026-10-30', 1560), '2026-10-31T02:00:00');
  assertEquals(localIso('2026-10-30', 1440), '2026-10-31T00:00:00');
});

/* ----------------------------------------------------------- all-day, midnight, clipping */

Deno.test('all-day events carry their span (end.date is exclusive)', () => {
  assertEquals(mapTimes({ start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }, NY), { day: '2026-11-02', start_min: 0, end_min: 1440, all_day: true, days: 1 });
  assertEquals(mapTimes({ start: { date: '2026-11-02' }, end: { date: '2026-11-05' } }, NY)!.days, 3);
  assertEquals(mapTimes({ start: { date: '2026-11-02' } }, NY)!.days, 1);
  assertEquals(mapTimes({ start: { date: '2026-01-01' }, end: { date: '2028-01-01' } }, NY)!.days, 366); // capped at the database limit
});

Deno.test('an event crossing midnight has end_min past 1440', () => {
  // 22:00 -> 02:00 EDT
  assertEquals(mapTimes(timed('2026-10-30T02:00:00Z', '2026-10-30T06:00:00Z'), NY), { day: '2026-10-29', start_min: 1320, end_min: 1560, all_day: false, days: 1 });
  // ends exactly at midnight
  assertEquals(mapTimes(timed('2026-10-30T22:00:00Z', '2026-10-31T04:00:00Z'), NY)!.end_min, 1440);
});

Deno.test('timed events longer than 24h are clipped to start + 1440; empty ones get 15 minutes', () => {
  const long = mapTimes(timed('2026-10-30T13:00:00Z', '2026-11-02T13:00:00Z'), NY)!;
  assertEquals([long.start_min, long.end_min], [540, 540 + 1440]);
  assertEquals(mapTimes(timed('2026-10-30T13:00:00Z', '2026-10-30T13:00:00Z'), NY)!.end_min, 555);
  assertEquals(mapTimes(timed('2026-10-30T13:00:00Z', '2026-10-30T12:00:00Z'), NY)!.end_min, 555);
  assertEquals(mapTimes({ start: { dateTime: '2026-10-30T13:00:00Z' } }, NY)!.end_min, 555);
  assertEquals(mapTimes({}, NY), null);
});

/* ------------------------------------------------------------------------ is_mine etc */

Deno.test('is_mine: creator or organizer email equals the account email (case-insensitive)', () => {
  assertEquals(isMine({ creator: { email: 'Sam@Example.test' } }, 'sam@example.test'), true);
  assertEquals(isMine({ organizer: { email: 'sam@example.test' }, creator: { email: 'maya@example.test' } }, 'sam@example.test'), true);
  assertEquals(isMine({ creator: { email: 'maya@example.test' }, organizer: { email: 'family@group.calendar.google.com' } }, 'sam@example.test'), false);
  assertEquals(isMine({}, 'sam@example.test'), false);
  const row = mapGoogleEvent({ id: 'a', summary: 'Lunch', ...timed('2026-10-30T16:00:00Z', '2026-10-30T17:00:00Z'), etag: '"1"', creator: { email: 'maya@example.test' }, organizer: { email: 'fam@group.test' } },
    { tz: NY, accountEmail: 'sam@example.test', userId: 'u', calendarId: 'c' })!;
  assertEquals([row.is_mine, row.organizer_email, row.source, row.google_event_id, row.etag, row.title], [false, 'fam@group.test', 'google', 'a', '"1"', 'Lunch']);
});

Deno.test('cancelled and self-declined events are gone; working-location markers are skipped', () => {
  assertEquals(isGone({ id: 'a', status: 'cancelled' }, 'sam@example.test'), true);
  assertEquals(isGone({ id: 'a', attendees: [{ email: 'sam@example.test', responseStatus: 'declined' }] }, 'sam@example.test'), true);
  assertEquals(isGone({ id: 'a', attendees: [{ email: 'x@example.test', responseStatus: 'declined' }] }, 'sam@example.test'), false);
  assertEquals(mapGoogleEvent({ id: 'w', eventType: 'workingLocation', ...timed('2026-10-30T13:00:00Z', '2026-10-30T14:00:00Z') }, { tz: NY, accountEmail: 'a', userId: 'u', calendarId: 'c' }), null);
});

Deno.test('own copies are recognised by id, by recurring master id and by our marker', () => {
  const own = new Set(['mine1']);
  assertEquals(isOwnCopy({ id: 'mine1' }, own), true);
  assertEquals(isOwnCopy({ id: 'mine1_20261103T140000Z', recurringEventId: 'mine1' }, own), true);
  assertEquals(isOwnCopy({ id: 'x', extendedProperties: { private: { aiCalendarEventId: 'e1' } } }, new Set()), true);
  assertEquals(isOwnCopy({ id: 'other' }, own), false);
});

Deno.test('calendars: shared, defaults', () => {
  assertEquals(isShared('reader', null, 'a@x.test'), true);
  assertEquals(isShared('writer', null, 'a@x.test'), true);
  assertEquals(isShared('owner', null, 'a@x.test'), false);
  assertEquals(isShared('owner', [{ role: 'owner', scope: { type: 'user', value: 'A@x.test' } }], 'a@x.test'), false);
  assertEquals(isShared('owner', [{ role: 'owner', scope: { type: 'user', value: 'a@x.test' } }, { role: 'reader', scope: { type: 'user', value: 'b@x.test' } }], 'a@x.test'), true);
  assertEquals(isShared('owner', [{ role: 'reader', scope: { type: 'default' } }], 'a@x.test'), true);
  const primary = mapCalendarEntry({ id: 'a@x.test', summary: 'Sam', backgroundColor: '#fff', accessRole: 'owner', primary: true }, [], 'a@x.test');
  assertEquals(newCalendarDefaults(primary), { show_in_app: true, can_publish: true });
  const fam = mapCalendarEntry({ id: 'fam', summary: 'Family', summaryOverride: 'Fam', accessRole: 'writer' }, null, 'a@x.test');
  assertEquals([fam.name, fam.shared, newCalendarDefaults(fam)], ['Fam', true, { show_in_app: false, can_publish: false }]);
  const hol = mapCalendarEntry({ id: 'hol', accessRole: 'reader', primary: true }, null, 'a@x.test');
  assertEquals(newCalendarDefaults(hol).can_publish, false); // never publish into a read-only calendar
});

/* ---------------------------------------------------------- fingerprint, RRULE, privacy */

const ev = (p: Partial<AppEvent> = {}): AppEvent => ({
  id: 'e1', user_id: 'u', title: 'Run', day: '2026-11-03', start_min: 480, end_min: 540, all_day: false, days: 1,
  visibility: 'public', source: 'app', series_id: null, deleted_at: null, ...p,
});

Deno.test('publish payload: zoned dateTime for timed, dates for all-day, our marker', () => {
  const b = buildGoogleEvent(ev(), { tz: NY });
  assertEquals(b.start, { dateTime: '2026-11-03T08:00:00', timeZone: NY });
  assertEquals(b.end, { dateTime: '2026-11-03T09:00:00', timeZone: NY });
  assertEquals(b.extendedProperties.private.aiCalendarEventId, 'e1');
  assertEquals(buildGoogleEvent(ev({ start_min: 1320, end_min: 1560 }), { tz: NY }).end, { dateTime: '2026-11-04T02:00:00', timeZone: NY });
  const ad = buildGoogleEvent(ev({ all_day: true, start_min: 0, end_min: 1440, days: 3 }), { tz: NY });
  assertEquals([ad.start, ad.end], [{ date: '2026-11-03' }, { date: '2026-11-06' }]);
});

Deno.test('fingerprint changes with visible fields only', async () => {
  const o = { tz: NY };
  const base = await fingerprintOf(ev(), o);
  assertEquals(await fingerprintOf(ev(), o), base);
  assertEquals(await fingerprintOf(ev({ id: 'other', series_id: 's', visibility: 'public' }), o), base); // identity is not part of it
  for (const p of [{ title: 'Run!' }, { day: '2026-11-04' }, { start_min: 481 }, { end_min: 541 }, { all_day: true }]) {
    assert((await fingerprintOf(ev(p), o)) !== base, JSON.stringify(p));
  }
  assert((await fingerprintOf(ev(), { tz: 'UTC' })) !== base);
  assert((await fingerprintOf(ev(), { tz: NY, rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO' })) !== base);
});

Deno.test('RRULE: core toRRule; UNTIL becomes a UTC end-of-day for timed events', () => {
  const s = { weekdays: [3, 1], until: '2026-12-06' };
  assertEquals(rruleFor(s, { firstDay: '2026-11-02', allDay: true, tz: NY }), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261206');
  assertEquals(rruleFor(s, { firstDay: '2026-11-02', allDay: false, tz: NY }), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261207T045959Z');
  assertEquals(rruleFor({ weekdays: [1], until: null }, { firstDay: '2026-11-02', allDay: false, tz: NY }), 'RRULE:FREQ=WEEKLY;BYDAY=MO');
  assertEquals(rruleFor({ weekdays: [1], until: '2026-10-01' }, { firstDay: '2026-11-02', allDay: false, tz: NY }), 'RRULE:FREQ=WEEKLY;BYDAY=MO'); // an UNTIL before the start is dropped
});

Deno.test('privacy: private, deleted and imported events can never be built for Google', () => {
  for (const p of [{ visibility: 'private' as const }, { deleted_at: '2026-10-30T00:00:00Z' }, { source: 'google' as const }]) {
    let threw = false;
    try { buildGoogleEvent(ev(p), { tz: NY }); } catch (e) { threw = e instanceof PrivateEventError; }
    assert(threw, JSON.stringify(p));
    let threw2 = false;
    try { assertPublishable(ev(p)); } catch (e) { threw2 = e instanceof PrivateEventError; }
    assert(threw2);
  }
});

/* ------------------------------------------------------ OAuth state and return URLs */

Deno.test('state: random, well-formed, hashed', async () => {
  const a = newState();
  const b = newState();
  assert(a !== b);
  assert(looksLikeState(a));
  assertEquals(looksLikeState('short'), false);
  assertEquals(looksLikeState(null), false);
  assertEquals((await hashState(a)).length, 64);
  assert((await hashState(a)) !== (await hashState(b)));
});

Deno.test('return URL allow-list', () => {
  const allow = parseReturnUrls(' aicalendar://google/connected, https://www.claude-calendar.com ,,');
  assertEquals(allow, ['aicalendar://google/connected', 'https://www.claude-calendar.com']);
  const ok = (u: string) => isAllowedReturnUrl(u, allow);
  assert(ok('aicalendar://google/connected'));
  assert(ok('aicalendar://google/connected?x=1'));
  assert(ok('https://www.claude-calendar.com'));
  assert(ok('https://www.claude-calendar.com/settings/calendars?a=b'));
  assertEquals(ok('aicalendar://google/other'), false);
  assertEquals(ok('aicalendar://evil/connected'), false);
  assertEquals(ok('https://evil.test'), false);
  assertEquals(ok('https://www.claude-calendar.com.evil.test'), false);
  assertEquals(ok('http://www.claude-calendar.com'), false);
  assertEquals(ok('https://user:pw@www.claude-calendar.com'), false);
  assertEquals(ok('javascript:alert(1)'), false);
  assertEquals(ok('//evil.test'), false);
  assertEquals(ok('not a url'), false);
  assertEquals(ok(''), false);
  assertEquals(isAllowedReturnUrl('https://www.claude-calendar.com', []), false);
  // a path-scoped web entry
  assertEquals(isAllowedReturnUrl('https://a.test/app/done', ['https://a.test/app']), true);
  assertEquals(isAllowedReturnUrl('https://a.test/application', ['https://a.test/app']), false);
});

Deno.test('withParams works for custom schemes and web URLs', () => {
  assertEquals(withParams('aicalendar://google/connected', { error: 'access_denied' }), 'aicalendar://google/connected?error=access_denied');
  assertEquals(withParams('https://www.claude-calendar.com/x?a=1', { connected: '1' }), 'https://www.claude-calendar.com/x?a=1&connected=1');
});

/* ---------------------------------------------------------------- webhook channel token */

Deno.test('channel token: HMAC of the channel id', async () => {
  const t = await channelToken('secret', 'chan-1');
  assertEquals(t.length, 64);
  assertEquals(await channelToken('secret', 'chan-1'), t);
  assert((await channelToken('secret', 'chan-2')) !== t);
  assert((await channelToken('other', 'chan-1')) !== t);
  assertEquals(await verifyChannelToken('secret', 'chan-1', t), true);
  assertEquals(await verifyChannelToken('secret', 'chan-2', t), false);
  assertEquals(await verifyChannelToken('secret', 'chan-1', t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), false);
  assertEquals(await verifyChannelToken('secret', 'chan-1', null), false);
  assertEquals(await verifyChannelToken('', 'chan-1', t), false);
});
