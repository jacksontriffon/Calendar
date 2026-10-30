import { assert, assertEquals, assertRejects, harness } from './testing/harness.ts';
import { GoogleApiError } from './api.ts';
import { importCalendar } from './import.ts';
import { NeedsSigninError } from './tokens.ts';

const setup = () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', show_in_app: true, is_primary: true });
  return { ...h, acct, cal };
};
const ev = (id: string, start: string, end: string, extra: object = {}) => ({ id, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra });

Deno.test('import: first sync is a bounded window, singleEvents, then stores the sync token', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z', { creator: { email: 'sam@example.test' } }));
  g.setEvent('primary', { id: 'b', summary: 'Trip', start: { date: '2026-11-05' }, end: { date: '2026-11-08' } });
  g.setEvent('primary', ev('far', '2028-01-01T14:00:00Z', '2028-01-01T15:00:00Z'));

  const r = await importCalendar(deps, cal.id);
  assertEquals([r.status, r.full, r.upserted], ['ok', true, 2]);

  const list = g.calls.find((c) => c.path.endsWith('/events') && c.method === 'GET')!;
  assertEquals(list.query.get('singleEvents'), 'true');
  assertEquals(list.query.get('timeMin'), new Date(Date.parse('2026-10-30T12:00:00Z') - 30 * 86400000).toISOString());
  assertEquals(list.query.get('timeMax'), new Date(Date.parse('2026-10-30T12:00:00Z') + 180 * 86400000).toISOString());
  assertEquals(list.query.get('syncToken'), null);

  const a = db.imported.find((e) => e.google_event_id === 'a')!;
  assertEquals([a.source, a.day, a.start_min, a.end_min, a.is_mine, a.google_calendar_id, a.user_id], ['google', '2026-11-03', 540, 600, true, cal.id, db.cal(cal.id).user_id]);
  const b = db.imported.find((e) => e.google_event_id === 'b')!;
  assertEquals([b.all_day, b.days, b.day], [true, 3, '2026-11-05']);
  assertEquals(db.imported.length, 2); // 'far' is outside the window
  assertEquals(db.cal(cal.id).sync_token, 'tok-3');
  assert(db.cal(cal.id).full_synced_at);
  // the push channel was created with an HMAC token
  assertEquals(g.channelsCreated.length, 1);
  assertEquals(db.cal(cal.id).channel_id, g.channelsCreated[0].id);
});

Deno.test('import: the next sync is incremental and only touches changes', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  g.setEvent('primary', ev('b', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z'));
  await importCalendar(deps, cal.id);
  db.imported.find((e) => e.google_event_id === 'a')!.done = true; // a user-side field the import must keep
  g.calls.length = 0;

  g.setEvent('primary', ev('a', '2026-11-03T15:00:00Z', '2026-11-03T16:00:00Z', { summary: 'Moved' }));
  const r = await importCalendar(deps, cal.id);
  assertEquals([r.full, r.upserted], [false, 1]);
  const list = g.calls.find((c) => c.method === 'GET' && c.path.endsWith('/events'))!;
  assertEquals(list.query.get('syncToken'), 'tok-2');
  assertEquals(list.query.get('timeMin'), null);
  const a = db.imported.find((e) => e.google_event_id === 'a')!;
  assertEquals([a.title, a.start_min, a.done], ['Moved', 600, true]);
  assertEquals(db.cal(cal.id).sync_token, 'tok-3');

  // nothing changed: nothing is written
  const before = JSON.stringify(db.imported);
  const r2 = await importCalendar(deps, cal.id);
  assertEquals(r2.upserted, 0);
  assertEquals(JSON.stringify(db.imported), before);
});

Deno.test('import: an unchanged etag is not rewritten', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  await importCalendar(deps, cal.id);
  const r = await importCalendar(deps, cal.id, { forceFull: true });
  assertEquals([r.full, r.upserted], [true, 0]);
  assertEquals(db.liveImported().length, 1);
});

Deno.test('import: cancelled events become soft deletes, and come back if restored', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  g.setEvent('primary', ev('b', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z'));
  await importCalendar(deps, cal.id);
  g.cancel('primary', 'a');
  const r = await importCalendar(deps, cal.id);
  assertEquals(r.deleted, 1);
  const a = db.imported.find((e) => e.google_event_id === 'a')!;
  assert(a.deleted_at); // soft delete: the row is still there
  assertEquals(db.liveImported().map((e) => e.google_event_id), ['b']);
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  await importCalendar(deps, cal.id);
  assertEquals(db.imported.find((e) => e.google_event_id === 'a')!.deleted_at, null);
});

Deno.test('import: declined events are removed; cancelled events we never had are ignored', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  await importCalendar(deps, cal.id);
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z', { attendees: [{ email: 'sam@example.test', responseStatus: 'declined' }] }));
  g.cancel('primary', 'never-seen');
  await importCalendar(deps, cal.id);
  assertEquals(db.liveImported().length, 0);
  assertEquals(db.imported.length, 1);
});

Deno.test('import: 410 Gone clears the token and does a full resync (and notices deletions)', async () => {
  const { db, g, deps, cal, logs } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  g.setEvent('primary', ev('gone', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z'));
  await importCalendar(deps, cal.id);
  assertEquals(db.liveImported().length, 2);

  // while we were not syncing: 'gone' was deleted, 'new' was added, and the token expired
  g.cancel('primary', 'gone');
  g.setEvent('primary', ev('new', '2026-11-05T14:00:00Z', '2026-11-05T15:00:00Z'));
  g.expireSyncTokens = true;
  g.calls.length = 0;
  const r = await importCalendar(deps, cal.id);
  assertEquals([r.status, r.full], ['ok', true]);
  const gets = g.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/events'));
  assertEquals(gets.length, 2);
  assertEquals(gets[0].query.get('syncToken'), 'tok-2');
  assertEquals(gets[1].query.get('syncToken'), null);
  assert(gets[1].query.get('timeMin'));
  assertEquals(db.liveImported().map((e) => e.google_event_id).sort(), ['a', 'new']);
  assert(db.imported.find((e) => e.google_event_id === 'gone')!.deleted_at);
  assert(logs.some((l) => l.includes('sync token expired')));
  assert(db.cal(cal.id).sync_token?.startsWith('tok-'));
});

Deno.test('import: a stale full sync (older than 14 days) is repeated so the window moves forward', async () => {
  const clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  const h = harness({ clock });
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  await importCalendar(h.deps, cal.id);
  clock.t += 7 * 86400000;
  assertEquals((await importCalendar(h.deps, cal.id)).full, false);
  clock.t += 8 * 86400000;
  assertEquals((await importCalendar(h.deps, cal.id)).full, true);
});

Deno.test('import: paged results are all applied before the token is stored', async () => {
  const { db, g, deps, cal } = setup();
  g.pageSize = 2;
  for (let i = 0; i < 5; i++) g.setEvent('primary', ev('e' + i, `2026-11-0${i + 1}T14:00:00Z`, `2026-11-0${i + 1}T15:00:00Z`));
  await importCalendar(deps, cal.id);
  assertEquals(db.liveImported().length, 5);
  assertEquals(g.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/events')).length, 3);
  assertEquals(db.cal(cal.id).sync_token, 'tok-5');
});

Deno.test('import: echo suppression skips our own published copies (by id, by recurring id, by marker)', async () => {
  const { db, g, deps, cal } = setup();
  const e1 = db.addEvent({ user_id: db.cal(cal.id).user_id, visibility: 'public' });
  db.addTarget(e1, cal, { external_id: 'copy1', status: 'synced' });
  g.setEvent('primary', ev('copy1', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  g.setEvent('primary', ev('copy1_20261110T140000Z', '2026-11-10T14:00:00Z', '2026-11-10T15:00:00Z', { recurringEventId: 'copy1' }));
  g.setEvent('primary', ev('marked', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z', { extendedProperties: { private: { aiCalendarEventId: 'x' } } }));
  g.setEvent('primary', ev('theirs', '2026-11-05T14:00:00Z', '2026-11-05T15:00:00Z'));
  await importCalendar(deps, cal.id);
  assertEquals(db.liveImported().map((e) => e.google_event_id), ['theirs']);
});

Deno.test('import: a calendar turned off is purged and its channel stopped', async () => {
  const { db, g, deps, cal } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  await importCalendar(deps, cal.id);
  const chan = db.cal(cal.id).channel_id;
  assert(chan);
  db.cal(cal.id).show_in_app = false;
  const r = await importCalendar(deps, cal.id);
  assertEquals(r.status, 'purged');
  assertEquals(db.imported.length, 0);
  assertEquals([db.cal(cal.id).sync_token, db.cal(cal.id).channel_id], [null, null]);
  assertEquals(g.channelsStopped.map((c) => c.id), [chan]);
});

Deno.test('import: invalid_grant marks the account needs_signin; later runs skip it', async () => {
  const { db, g, deps, cal, acct } = setup();
  g.revokedRefresh.add('refresh-sam@example.test');
  await assertRejects(() => importCalendar(deps, cal.id), NeedsSigninError);
  assertEquals(db.accounts.find((a) => a.id === acct.id)!.status, 'needs_signin');
  const r = await importCalendar(deps, cal.id);
  assertEquals([r.status, r.reason], ['skipped', 'needs_signin']);
  assertEquals(db.imported.length, 0);
});

Deno.test('api: 429/5xx are retried with exponential backoff, then succeed', async () => {
  const { g, deps, cal, sleeps, db } = setup();
  g.setEvent('primary', ev('a', '2026-11-03T14:00:00Z', '2026-11-03T15:00:00Z'));
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 429, 2);
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 503, 1);
  await importCalendar(deps, cal.id);
  assertEquals(db.liveImported().length, 1);
  assertEquals(sleeps, [375, 750, 1500]); // base 500 ms doubling, times the jitter factor 0.75 (random() = 0.5)
});

Deno.test('api: retries are bounded and the final error is transient; 4xx is permanent', async () => {
  const { g, deps, cal, sleeps } = setup();
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 500, 99);
  const e = await assertRejects(() => importCalendar(deps, cal.id), GoogleApiError);
  assertEquals([e.status, e.transient], [500, true]);
  assertEquals(sleeps.length, 4);
  assertEquals(g.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/events')).length, 5);

  g.failures.length = 0;
  sleeps.length = 0;
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 404, 99);
  const e2 = await assertRejects(() => importCalendar(deps, cal.id), GoogleApiError);
  assertEquals([e2.status, e2.transient, sleeps.length], [404, false, 0]);

  g.failures.length = 0;
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 403, 1, { error: { code: 403, message: 'rate', errors: [{ reason: 'rateLimitExceeded' }] } });
  await importCalendar(deps, cal.id); // a rate-limit 403 is retried
});

Deno.test('api: Retry-After is honoured', async () => {
  const { g, deps, cal, sleeps } = setup();
  g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 429, 1, undefined, { 'Retry-After': '7' });
  await importCalendar(deps, cal.id);
  assertEquals(sleeps, [7000]);
});

Deno.test('watch: renewal creates a new channel, stores it, then stops the old one', async () => {
  const { db, g, deps, cal } = setup();
  const { renewWatch } = await import('./watch.ts');
  await importCalendar(deps, cal.id);
  const first = { ...db.cal(cal.id) };
  g.channelsStopped.length = 0;
  assertEquals(await renewWatch(deps, { ...db.cal(cal.id) }), 'unchanged'); // far from expiry
  db.cal(cal.id).channel_expires_at = new Date(deps.now() + 86400000).toISOString(); // within 2 days
  assertEquals(await renewWatch(deps, { ...db.cal(cal.id) }), 'renewed');
  assert(db.cal(cal.id).channel_id !== first.channel_id);
  assertEquals(g.channelsStopped, [{ id: first.channel_id!, resourceId: first.channel_resource_id! }]);
  const made = g.channelsCreated[g.channelsCreated.length - 1];
  const { verifyChannelToken } = await import('./webhook.ts');
  assertEquals(await verifyChannelToken('whsec', made.id, made.token), true);
  assertEquals(made.address, 'https://x.test/functions/v1/google-webhook');
});
