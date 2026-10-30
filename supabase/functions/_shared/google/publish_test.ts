import { assert, assertEquals, harness } from './testing/harness.ts';
import { FakeDb } from './testing/fake_db.ts';
import { publishEvent } from './publish.ts';
import type { AppEvent } from './types.ts';

const setup = (o: { can_publish?: boolean } = {}) => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', is_primary: true, can_publish: o.can_publish ?? true });
  const ev = h.db.addEvent({ user_id: h.userId, title: 'Run', visibility: 'public', day: '2026-11-03', start_min: 480, end_min: 540 });
  const t = h.db.addTarget(ev, cal);
  return { ...h, acct, cal, ev, t };
};
const methods = (g: { writes(): { method: string }[] }) => g.writes().map((c) => c.method);

Deno.test('publish: a public event is created on Google with the profile time zone', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals([r.created, r.patched, r.failed, r.retry], [1, 0, 0, false]);
  const post = g.writes()[0];
  assertEquals(post.method, 'POST');
  assertEquals(post.body.summary, 'Run');
  assertEquals(post.body.start, { dateTime: '2026-11-03T08:00:00', timeZone: 'America/New_York' });
  assertEquals(post.body.end, { dateTime: '2026-11-03T09:00:00', timeZone: 'America/New_York' });
  assertEquals(post.body.extendedProperties.private.aiCalendarEventId, ev.id);
  const row = db.target(t.id)!;
  assertEquals([row.status, row.error, row.external_id], ['synced', null, post.body.id]);
  assert(row.fingerprint && row.synced_at);
  assertEquals(g.live('primary').length, 1);
});

Deno.test('publish: the same fingerprint is a no-op; a change patches the same Google event', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  await publishEvent(deps, userId, ev.id);
  const id = db.target(t.id)!.external_id;
  g.calls.length = 0;

  const again = await publishEvent(deps, userId, ev.id);
  assertEquals([again.created, again.patched, again.unchanged], [0, 0, 1]);
  assertEquals(g.writes().length, 0);

  db.appEvents[0].title = 'Long run';
  db.appEvents[0].end_min = 600;
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals([r.created, r.patched], [0, 1]);
  assertEquals(methods(g), ['PATCH']);
  assertEquals(db.target(t.id)!.external_id, id);
  const live = g.live('primary');
  assertEquals(live.length, 1);
  assertEquals([live[0].summary, live[0].end?.dateTime], ['Long run', '2026-11-03T10:00:00']);
});

Deno.test('publish: switching to all-day through PATCH removes the old dateTime fields', async () => {
  const { db, g, deps, ev, userId } = setup();
  await publishEvent(deps, userId, ev.id);
  Object.assign(db.appEvents[0], { all_day: true, start_min: 0, end_min: 1440, days: 2 });
  await publishEvent(deps, userId, ev.id);
  const live = g.live('primary')[0];
  assertEquals(live.start, { date: '2026-11-03' });
  assertEquals(live.end, { date: '2026-11-05' });
});

Deno.test('publish: public -> private deletes the Google copy and sends nothing else', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  await publishEvent(deps, userId, ev.id);
  g.calls.length = 0;
  db.appEvents[0].visibility = 'private';
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals(r.deleted, 1);
  assertEquals(methods(g), ['DELETE']);
  assertEquals(g.live('primary').length, 0);
  const row = db.target(t.id)!;
  assertEquals([row.external_id, row.fingerprint, row.status], [null, null, 'pending']);

  // and back to public: a fresh copy is created
  db.appEvents[0].visibility = 'public';
  g.calls.length = 0;
  await publishEvent(deps, userId, ev.id);
  assertEquals(methods(g), ['POST']);
  assertEquals(g.live('primary').length, 1);
});

Deno.test('publish: a soft-deleted event deletes its copy; an unticked target deletes the copy and the row', async () => {
  const a = setup();
  await publishEvent(a.deps, a.userId, a.ev.id);
  a.db.appEvents[0].deleted_at = '2026-10-30T12:00:00Z';
  await publishEvent(a.deps, a.userId, a.ev.id);
  assertEquals(a.g.live('primary').length, 0);

  const b = setup();
  await publishEvent(b.deps, b.userId, b.ev.id);
  b.db.target(b.t.id)!.remove_requested = true;
  await publishEvent(b.deps, b.userId, b.ev.id);
  assertEquals(b.g.live('primary').length, 0);
  assertEquals(b.db.target(b.t.id), undefined);
});

Deno.test('PRIVACY: a private event is never sent to Google, whatever the target rows say', async () => {
  const { db, g, deps, ev, t, userId, cal } = setup();
  db.appEvents[0].visibility = 'private';
  // pending target, stale "synced" target without a copy, failed target: none may cause a write
  for (const status of ['pending', 'synced', 'failed', 'queued'] as const) {
    db.target(t.id)!.status = status;
    await publishEvent(deps, userId, ev.id);
  }
  // a second calendar too
  const acct2 = db.addAccount(userId, 'sam@work.test');
  const cal2 = db.addCalendar(acct2, { google_id: 'work', can_publish: true });
  db.addTarget(ev, cal2, { status: 'synced', external_id: null, fingerprint: 'stale' });
  await publishEvent(deps, userId, ev.id);
  assertEquals(g.writes().filter((c) => c.method === 'POST' || c.method === 'PATCH').length, 0);
  assertEquals([g.live('primary').length, g.live('work').length], [0, 0]);
  void cal;
});

Deno.test('PRIVACY: an event that turns private between the read and the write is not sent', async () => {
  class RacyDb extends FakeDb {
    reads = 0;
    override getEvent(userId: string, id: string): Promise<AppEvent | null> {
      this.reads++;
      const e = this.appEvents.find((x) => x.id === id && x.user_id === userId);
      // the first read (start of the job) still sees it public; the re-read before the write sees it private
      return Promise.resolve(e ? { ...e, visibility: this.reads === 1 ? 'public' : 'private' } : null);
    }
  }
  const h = harness();
  const db = new RacyDb();
  db.tz.set(h.userId, 'UTC');
  const acct = db.addAccount(h.userId, 'sam@example.test');
  const cal = db.addCalendar(acct, { google_id: 'primary', can_publish: true });
  const ev = db.addEvent({ user_id: h.userId, visibility: 'public' });
  db.addTarget(ev, cal);
  const deps = { ...h.deps, db, tokens: new (h.deps.tokens.constructor as typeof import('./tokens.ts').AccessTokens)(db, h.deps.api, h.deps.now) };
  const r = await publishEvent(deps, h.userId, ev.id);
  assertEquals(h.g.writes().length, 0);
  assertEquals(r.created + r.patched, 0);
  assert(h.logs.some((l) => l.includes('refusing to send')));
});

Deno.test('PRIVACY: imported events are never published, even if marked public with a target', async () => {
  const { db, g, deps, userId, cal } = setup();
  const imp = db.addEvent({ user_id: userId, source: 'google', visibility: 'public' });
  db.addTarget(imp, cal);
  await publishEvent(deps, userId, imp.id);
  assertEquals(g.calls.length, 0);
});

Deno.test('publish: a weekly series is ONE Google event with an RRULE; all occurrences share it', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', can_publish: true });
  const s = h.db.addSeries({ weekdays: [1, 3], start_day: '2026-11-02', until: '2026-12-06' });
  const days = ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11'];
  const evs = days.map((day) => h.db.addEvent({ user_id: h.userId, title: 'Gym', day, start_min: 420, end_min: 480, visibility: 'public', series_id: s.id }));
  const ts = evs.map((e) => h.db.addTarget(e, cal));

  // publishing for a LATER occurrence still publishes from the first
  const r = await publishEvent(h.deps, h.userId, evs[2].id);
  assertEquals(r.created, 1);
  const writes = h.g.writes();
  assertEquals(writes.length, 1);
  assertEquals(writes[0].method, 'POST');
  assertEquals(writes[0].body.start, { dateTime: '2026-11-02T07:00:00', timeZone: 'America/New_York' });
  assertEquals(writes[0].body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261207T045959Z']);
  const ids = new Set(ts.map((t) => h.db.target(t.id)!.external_id));
  assertEquals(ids.size, 1);
  assert(ts.every((t) => h.db.target(t.id)!.status === 'synced'));

  // nothing changed: nothing sent, from any occurrence
  h.g.calls.length = 0;
  await publishEvent(h.deps, h.userId, evs[0].id);
  await publishEvent(h.deps, h.userId, evs[3].id);
  assertEquals(h.g.writes().length, 0);

  // a new occurrence materialised later is attached without a Google call
  const later = h.db.addEvent({ user_id: h.userId, title: 'Gym', day: '2026-11-16', start_min: 420, end_min: 480, visibility: 'public', series_id: s.id });
  const lt = h.db.addTarget(later, cal);
  await publishEvent(h.deps, h.userId, later.id);
  assertEquals(h.g.writes().length, 0);
  assertEquals([h.db.target(lt.id)!.status, h.db.target(lt.id)!.external_id], ['synced', [...ids][0]]);

  // retitle the whole series (the anchor drives the Google event): one PATCH
  h.db.appEvents.filter((e) => e.series_id === s.id).forEach((e) => (e.title = 'Strength'));
  await publishEvent(h.deps, h.userId, evs[1].id);
  assertEquals(methods(h.g), ['PATCH']);
  assertEquals(h.g.live('primary').length, 1);
  assertEquals(h.g.live('primary')[0].summary, 'Strength');

  // making the series private deletes the one Google event and resets every row
  h.g.calls.length = 0;
  h.db.appEvents.filter((e) => e.series_id === s.id).forEach((e) => (e.visibility = 'private'));
  await publishEvent(h.deps, h.userId, evs[1].id);
  assertEquals(methods(h.g), ['DELETE']);
  assertEquals(h.g.live('primary').length, 0);
  assert(h.db.targets.every((t) => t.external_id === null && t.status === 'pending'));
});

Deno.test('publish: ending a weekly series on Google moves UNTIL; unticking all removes the one event', async () => {
  const h = harness({ tz: 'UTC' });
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', can_publish: true });
  const s = h.db.addSeries({ weekdays: [1], start_day: '2026-11-02', until: null });
  const e1 = h.db.addEvent({ user_id: h.userId, day: '2026-11-02', visibility: 'public', series_id: s.id });
  const e2 = h.db.addEvent({ user_id: h.userId, day: '2026-11-09', visibility: 'public', series_id: s.id });
  const t1 = h.db.addTarget(e1, cal);
  const t2 = h.db.addTarget(e2, cal);
  await publishEvent(h.deps, h.userId, e1.id);
  assertEquals(h.g.live('primary')[0].recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO']);
  s.until = '2026-11-30';
  await publishEvent(h.deps, h.userId, e1.id);
  assertEquals(h.g.live('primary')[0].recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T235959Z']);
  h.db.target(t1.id)!.remove_requested = true;
  h.db.target(t2.id)!.remove_requested = true;
  await publishEvent(h.deps, h.userId, e1.id);
  assertEquals(h.g.live('primary').length, 0);
  assertEquals(h.db.targets.length, 0);
});

Deno.test('publish: a calendar that is not set to publish is not written to', async () => {
  const { db, g, deps, ev, t, userId } = setup({ can_publish: false });
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals(g.writes().length, 0);
  assertEquals([db.target(t.id)!.status, r.failed], ['failed', 1]);
  assertEquals(db.target(t.id)!.error, 'This calendar is not set to publish');
});

Deno.test('publish: an account that needs sign-in fails its targets without calling Google', async () => {
  const { db, g, deps, ev, t, userId, acct } = setup();
  db.accounts.find((a) => a.id === acct.id)!.status = 'needs_signin';
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals(g.calls.length, 0);
  assertEquals([db.target(t.id)!.status, db.target(t.id)!.error, r.retry], ['failed', 'Google needs you to sign in again', false]);
});

Deno.test('publish: invalid_grant while publishing flips the account to needs_signin', async () => {
  const { db, g, deps, ev, t, userId, acct } = setup();
  g.revokedRefresh.add('refresh-sam@example.test');
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals(db.accounts.find((a) => a.id === acct.id)!.status, 'needs_signin');
  assertEquals([db.target(t.id)!.status, r.retry], ['failed', false]);
});

Deno.test('publish: a transient failure marks the target failed and asks for a retry; the retry reuses the id', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  g.failNext((c) => c.method === 'POST' && c.path.endsWith('/events'), 503, 99);
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals([r.retry, r.failed, db.target(t.id)!.status], [true, 1, 'failed']);
  const reserved = db.target(t.id)!.external_id; // written before the create call
  assert(reserved);

  g.failures.length = 0;
  const r2 = await publishEvent(deps, userId, ev.id);
  assertEquals([r2.retry, db.target(t.id)!.status, db.target(t.id)!.external_id], [false, 'synced', reserved]);
  assertEquals(g.live('primary').map((e) => e.id), [reserved]);
});

Deno.test('publish: a crash after Google created the event does not duplicate it', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  // state after a crash: the id was reserved on the target and the event exists on Google
  db.target(t.id)!.external_id = 'abc123def456';
  g.setEvent('primary', { id: 'abc123def456', summary: 'Run', start: { dateTime: '2026-11-03T08:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-03T09:00:00', timeZone: 'America/New_York' } });
  await publishEvent(deps, userId, ev.id);
  assertEquals(methods(g), ['PATCH']);
  assertEquals(g.live('primary').length, 1);
  assertEquals(db.target(t.id)!.status, 'synced');
});

Deno.test('publish: a copy deleted on Google (410) is recreated under a new id; a missing one (404) under the same', async () => {
  const a = setup();
  await publishEvent(a.deps, a.userId, a.ev.id);
  const old = a.db.target(a.t.id)!.external_id!;
  a.g.cancel('primary', old); // the user deleted it on Google
  a.db.appEvents[0].title = 'Run 2';
  await publishEvent(a.deps, a.userId, a.ev.id);
  const now = a.db.target(a.t.id)!.external_id!;
  assert(now !== old);
  assertEquals(a.g.live('primary').map((e) => e.id), [now]);

  const b = setup();
  b.db.target(b.t.id)!.external_id = 'neverexisted1';
  await publishEvent(b.deps, b.userId, b.ev.id);
  assertEquals(b.db.target(b.t.id)!.external_id, 'neverexisted1');
  assertEquals(b.g.live('primary').map((e) => e.id), ['neverexisted1']);
});

Deno.test('publish: the Google copy is not re-imported (round trip)', async () => {
  const { db, g, deps, ev, userId, cal } = setup();
  await publishEvent(deps, userId, ev.id);
  const { importCalendar } = await import('./import.ts');
  await importCalendar(deps, cal.id, { forceFull: true });
  assertEquals(db.imported.length, 0);
});

Deno.test('publish: two calendars, one failing, do not block each other', async () => {
  const { db, g, deps, ev, t, userId } = setup();
  const acct2 = db.addAccount(userId, 'sam@work.test');
  const cal2 = db.addCalendar(acct2, { google_id: 'work', can_publish: true });
  const t2 = db.addTarget(ev, cal2);
  g.failNext((c) => c.path.includes('/calendars/work/') && c.method === 'POST', 403, 1, { error: { code: 403, message: 'forbidden', errors: [{ reason: 'forbidden' }] } });
  const r = await publishEvent(deps, userId, ev.id);
  assertEquals([db.target(t.id)!.status, db.target(t2.id)!.status], ['synced', 'failed']);
  assertEquals([r.failed, r.retry], [1, false]); // permanent: recorded, not retried
});
