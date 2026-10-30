import { assert, assertEquals } from '@std/assert';
import { envFrom } from '../_shared/env.ts';
import { HttpError } from '../_shared/http.ts';
import { FakeAdmin } from '../_shared/testing/fake_admin.ts';
import type { SupabaseClient } from '../_shared/supabase.ts';
import { cleanEvent, parseLinks, plan, sane } from './convert.ts';
import { handle } from './handler.ts';
import type { LegacyImportDeps } from './handler.ts';

const U = 'user-1';
const OTHER = 'user-2';

/** A blob shaped like the prototype's `sbSnap()`, with the awkward cases a real one has. */
const BLOB = {
  v: 1,
  events: [
    { id: 'e1', day: '2026-09-22', cat: 'Health', title: 'Gym', start: 1080, end: 1140, allDay: false, days: 1, done: true },
    { id: 'e2', day: '2026-09-23', cat: 'Work', title: 'Design review', start: 960, end: 1020, allDay: false, days: 1, done: true,
      pauses: [[970, 980]], win: { text: 'Signed off the layout', at: 1790000000000 }, winAsked: true, at: 1789000000000 },
    { id: 'e3', day: '2026-09-25', cat: 'Travel', title: 'Lisbon', start: 0, end: 1440, allDay: true, days: 3, done: false },
    { id: 'e4', day: '2026-09-26', cat: 'Work', title: 'Night shift', start: 1320, end: 1800 },
    { id: 'e5', cat: 'Work', title: 'No day on this one', start: 60, end: 120 },
    { id: 'e1', day: '2026-09-29', cat: 'Work', title: 'Duplicate id', start: 60, end: 120 },
    { id: 'e7', day: '2026-09-30', cat: 'Deep work', title: 'Write', start: 600, end: 600 },
  ],
  cats: { Work: 255, Health: 132, Travel: 104, 'Marathon training': 206 },
  goals: [
    { id: 'g1', title: 'Marathon training', cat: 'Marathon training', outcome: 'Run a marathon', hours: 60, start: '2026-09-01', deadline: '2026-12-01', hue: 206, at: 1788000000000 },
    { id: 'g2', title: 'Read', outcome: '', hours: 8, start: '2026-09-01', hue: 290, scope: 'month' },
  ],
  view: 'week', font: 'sans', zoom: 1,
  sun: { region: 'Lisbon', sunrise: 420, sunset: 1190 },
  ai: { on: true, model: 'sonnet', ask: false, checkin: true },
};
const LINKS = { e1: 'gev-1', e2: { id: 'gev-2', fp: 'fp-2' }, e3: 5, e9: 'gev-gone' };

const seed = (o: { blob?: unknown; links?: unknown; calendar?: boolean; prefs?: unknown } = {}) => new FakeAdmin({
  legacy_calendar_blobs: [
    ...(o.blob === null ? [] : [{ user_id: U, data: o.blob ?? BLOB }]),
    { user_id: OTHER, data: { events: [{ id: 'x1', day: '2026-09-22', title: 'Not yours', start: 0, end: 60 }], cats: { Secret: 1 }, goals: [] } },
  ],
  gcal_links: [{ user_id: U, map: o.links ?? LINKS }, { user_id: OTHER, map: { x1: 'gev-x' } }],
  categories: [
    { id: 'c-work', user_id: U, name: 'Work', hue: 255 },
    { id: 'c-health', user_id: U, name: 'Health', hue: 132 },
    { id: 'c-other', user_id: OTHER, name: 'Work', hue: 255 },
  ],
  google_calendars: o.calendar === false ? [] : [
    { id: 'cal-2', user_id: U, is_primary: false, created_at: '2026-01-01T00:00:00Z' },
    { id: 'cal-primary', user_id: U, is_primary: true, created_at: '2026-02-01T00:00:00Z' },
    { id: 'cal-primary-2', user_id: U, is_primary: true, created_at: '2026-03-01T00:00:00Z' },
    { id: 'cal-other', user_id: OTHER, is_primary: true, created_at: '2026-01-01T00:00:00Z' },
  ],
  profiles: [{ id: U, prefs: o.prefs ?? {} }, { id: OTHER, prefs: {} }],
}, {
  categories: { unique: [['user_id', 'name']] },
  goals: { unique: [['user_id', 'legacy_id']] },
  events: { unique: [['user_id', 'legacy_id']] },
  series: { unique: [['user_id', 'legacy_id']] },
  event_targets: { unique: [['event_id', 'google_calendar_id']] },
});

const setup = (db: FakeAdmin) => {
  const deps: LegacyImportDeps = {
    env: envFrom({}), fetch: (() => Promise.reject(new Error('no network in this function'))) as typeof fetch,
    auth: () => Promise.resolve({ id: U, email: null }),
    admin: () => db as unknown as SupabaseClient,
    now: () => new Date('2026-10-30T12:00:00Z'),
  };
  const call = async (init: RequestInit = {}) => {
    const res = await handle(new Request('http://localhost/legacy-import', { method: 'POST', headers: { authorization: 'Bearer jwt' }, ...init }), deps);
    return { res, body: await res.json() };
  };
  return { deps, call };
};

const mine = (db: FakeAdmin, table: string) => db.rows(table).filter((r) => r.user_id === U);
const ev = (db: FakeAdmin, legacy: string) => mine(db, 'events').find((r) => r.legacy_id === legacy)!;

Deno.test('imports categories, goals and events; reuses existing categories; maps Google links', async () => {
  const db = seed();
  const { res, body } = await setup(db).call();
  assertEquals(res.status, 200);
  assertEquals(body, {
    status: 'done', events: 5, goals: 2, categories: 6, series: 0, targets: 2, skipped: 4,
    skippedDetail: { events: 2, goals: 0, series: 0, targets: 2 }, settings: 1,
    created: { events: 5, goals: 2, series: 0 },
  });

  // categories: Work and Health were already there and are not duplicated; the rest are new
  const cats = mine(db, 'categories');
  assertEquals(cats.map((c) => c.name).sort(), ['Deep work', 'Health', 'Marathon training', 'Read', 'Travel', 'Work']);
  assertEquals(cats.find((c) => c.name === 'Work')!.id, 'c-work');
  assertEquals(cats.find((c) => c.name === 'Travel')!.hue, 104);
  assertEquals(cats.find((c) => c.name === 'Read')!.hue, 290, 'a goal\'s category takes the goal\'s hue');
  assertEquals(cats.find((c) => c.name === 'Deep work')!.hue, 1000, 'an unknown category with no hue gets the grey swatch');

  // events
  const events = mine(db, 'events');
  assertEquals(events.map((e) => e.legacy_id).sort(), ['e1', 'e2', 'e3', 'e4', 'e7']);
  assertEquals(ev(db, 'e2').category_id, 'c-work');
  assertEquals([ev(db, 'e1').title, ev(db, 'e1').start_min, ev(db, 'e1').end_min, ev(db, 'e1').done], ['Gym', 1080, 1140, true], 'the duplicate id did not replace the first');
  assertEquals(ev(db, 'e2').pauses, [[970, 980]]);
  assertEquals(ev(db, 'e2').win, { text: 'Signed off the layout', at: 1790000000000 });
  assertEquals(ev(db, 'e2').win_asked, true);
  assertEquals(ev(db, 'e2').created_at, new Date(1789000000000).toISOString());
  assertEquals([ev(db, 'e3').all_day, ev(db, 'e3').days, ev(db, 'e3').start_min, ev(db, 'e3').end_min], [true, 3, 0, 1440]);
  assertEquals([ev(db, 'e4').start_min, ev(db, 'e4').end_min], [1320, 1800], 'overnight events keep end > 1440');
  assertEquals([ev(db, 'e7').start_min, ev(db, 'e7').end_min], [600, 615], 'a zero-length event gets the 15 minute minimum');
  for (const e of events) {
    assertEquals([e.source, e.is_mine, e.deleted_at, e.google_event_id], ['app', true, null, null]);
    assertEquals(Object.keys(e).sort(), Object.keys(events[0]).sort(), 'rows carry the same keys (bulk insert)');
  }

  // goals
  const goals = mine(db, 'goals');
  assertEquals(goals.map((g) => g.legacy_id).sort(), ['g1', 'g2']);
  const g1 = goals.find((g) => g.legacy_id === 'g1')!, g2 = goals.find((g) => g.legacy_id === 'g2')!;
  assertEquals([g1.title, g1.hours, g1.deadline, g1.start_date, g1.hue], ['Marathon training', 60, '2026-12-01', '2026-09-01', 206]);
  assertEquals(g1.category_id, cats.find((c) => c.name === 'Marathon training')!.id);
  assertEquals(g1.created_at, new Date(1788000000000).toISOString());
  assertEquals(g2.deadline, '2026-09-30', 'a legacy goal with a scope gets the deadline the prototype derived');
  assertEquals(g2.category_id, cats.find((c) => c.name === 'Read')!.id);

  // Google links -> targets on the (oldest) primary calendar; those events were on Google, so they are public
  const targets = mine(db, 'event_targets');
  assertEquals(targets.length, 2);
  assert(targets.every((t) => t.kind === 'google' && t.google_calendar_id === 'cal-primary' && t.status === 'synced'));
  const t1 = targets.find((t) => t.event_id === ev(db, 'e1').id)!, t2 = targets.find((t) => t.event_id === ev(db, 'e2').id)!;
  assertEquals([t1.external_id, t1.fingerprint, t2.external_id, t2.fingerprint], ['gev-1', null, 'gev-2', 'fp-2']);
  assertEquals(events.map((e) => [e.legacy_id, e.visibility]).sort(), [['e1', 'public'], ['e2', 'public'], ['e3', 'private'], ['e4', 'private'], ['e7', 'private']]);

  // settings came from the blob
  const prefs = db.rows('profiles').find((p) => p.id === U)!.prefs;
  assertEquals([prefs.view, prefs.font, prefs.sun.region, prefs.ai.model, prefs.ai.ask], ['week', 'sans', 'Lisbon', 'sonnet', false]);

  // nothing of the other user was read or written, and the blob is untouched
  assertEquals(db.rows('events').filter((r) => r.user_id !== U).length, 0);
  assertEquals(db.rows('categories').filter((c) => c.user_id === OTHER).map((c) => c.name), ['Work']);
  assertEquals(db.rows('profiles').find((p) => p.id === OTHER)!.prefs, {});
  assertEquals(db.rows('legacy_calendar_blobs').find((r) => r.user_id === U)!.data, BLOB);
  assertEquals(db.log.filter((l) => l.table === 'legacy_calendar_blobs' || l.table === 'gcal_links').length, 0);
});

Deno.test('re-running is idempotent: no duplicates, same counts, nothing overwritten', async () => {
  const db = seed();
  const t = setup(db);
  const first = await t.call();
  const snapshot = JSON.stringify(Object.fromEntries(['categories', 'goals', 'events', 'event_targets', 'series'].map((n) => [n, db.rows(n)])));

  // the user edits an event and a goal in the new app between runs
  ev(db, 'e1').title = 'Gym (edited in the app)';
  mine(db, 'goals').find((g) => g.legacy_id === 'g1')!.hours = 75;
  const edited = JSON.stringify(Object.fromEntries(['categories', 'goals', 'events', 'event_targets', 'series'].map((n) => [n, db.rows(n)])));

  const second = await t.call();
  assertEquals(second.res.status, 200);
  assertEquals({ ...second.body, created: undefined, settings: undefined }, { ...first.body, created: undefined, settings: undefined }, 'a re-run reports the same counts');
  assertEquals([first.body.settings, second.body.settings], [1, 0], 'settings are only taken once');
  assertEquals(second.body.created, { events: 0, goals: 0, series: 0 });
  assertEquals(JSON.stringify(Object.fromEntries(['categories', 'goals', 'events', 'event_targets', 'series'].map((n) => [n, db.rows(n)]))), edited, 'no row was added, replaced or changed');
  assert(snapshot !== edited);
  assertEquals(ev(db, 'e1').title, 'Gym (edited in the app)');

  const third = await t.call();
  assertEquals(third.body.events, 5);
  assertEquals(mine(db, 'events').length, 5);
  assertEquals(mine(db, 'event_targets').length, 2);
  assertEquals(mine(db, 'goals').length, 2);
  assertEquals(mine(db, 'categories').length, 6);
});

Deno.test('a run that stopped half way is finished by the next one, without duplicates', async () => {
  const db = seed();
  const t = setup(db);
  db.failTables.events = 'connection reset';
  const failed = await t.call();
  assertEquals(failed.res.status, 500);
  assertEquals([failed.body.error, failed.body.stage], ['import_failed', 'events']);
  assertEquals(mine(db, 'goals').length, 2, 'earlier stages were kept');
  assertEquals(mine(db, 'events').length, 0);

  delete db.failTables.events;
  const ok = await t.call();
  assertEquals([ok.body.status, ok.body.events, ok.body.goals], ['done', 5, 2]);
  assertEquals(ok.body.created, { events: 5, goals: 0, series: 0 }, 'goals already existed');
  assertEquals(mine(db, 'goals').length, 2);
  assertEquals(mine(db, 'categories').length, 6);
});

Deno.test('each stage reports where it stopped', async () => {
  for (const [table, stage] of [['categories', 'categories'], ['goals', 'goals'], ['gcal_links', 'targets'], ['legacy_calendar_blobs', 'reading']] as const) {
    const db = seed();
    db.failTables[table] = 'boom';
    const { res, body } = await setup(db).call();
    assertEquals([res.status, body.error, body.stage], [500, 'import_failed', stage], table);
  }
});

Deno.test('Google links are skipped and counted when no Google calendar matches', async () => {
  const db = seed({ calendar: false });
  const { body } = await setup(db).call();
  assertEquals([body.status, body.targets, body.skippedDetail.targets, body.skipped], ['done', 0, 4, 6]);
  assertEquals(mine(db, 'event_targets').length, 0);
  assertEquals(mine(db, 'events').every((e) => e.visibility === 'private'), true, 'unlinked events stay private');

  // only a non-primary calendar connected: still no match
  const db2 = seed();
  db2.tables.google_calendars = db2.rows('google_calendars').filter((c) => c.id === 'cal-2');
  assertEquals((await setup(db2).call()).body.targets, 0);

  // a user with no gcal_links row at all
  const db3 = seed();
  db3.tables.gcal_links = [];
  const r3 = await setup(db3).call();
  assertEquals([r3.body.status, r3.body.targets, r3.body.skippedDetail.targets], ['done', 0, 0]);
});

Deno.test('settings are only taken when the profile has none', async () => {
  const db = seed({ prefs: { view: 'day3', font: 'serif' } });
  const { body } = await setup(db).call();
  assertEquals(body.settings, 0);
  assertEquals(db.rows('profiles').find((p) => p.id === U)!.prefs, { view: 'day3', font: 'serif' });
});

Deno.test('no blob (or an empty one) answers { status: "none" } and writes nothing', async () => {
  for (const blob of [null, {}, { view: 'week' }, 'junk', []]) {
    const db = seed({ blob });
    const { res, body } = await setup(db).call();
    assertEquals([res.status, body], [200, { status: 'none' }], JSON.stringify(blob));
    assertEquals(db.log.length, 0);
  }
  // a calendar with nothing in it is still a blob
  const empty = seed({ blob: { events: [], cats: {}, goals: [] } });
  const r = await setup(empty).call();
  assertEquals([r.body.status, r.body.events, r.body.goals, r.body.categories], ['done', 0, 0, 0]);
});

Deno.test('series from a newer blob are imported and linked to their events, idempotently', async () => {
  const blob = {
    ...BLOB,
    series: [{ id: 's1', freq: 'weekly', weekdays: [1, 3], startDay: '2026-09-21', until: null }, { id: 's2', weekdays: [], startDay: '2026-09-21' }],
    events: [
      { id: 'e1', day: '2026-09-21', cat: 'Work', title: 'Standup', start: 570, end: 585, seriesId: 's1' },
      { id: 'e2', day: '2026-09-23', cat: 'Work', title: 'Standup', start: 570, end: 585, seriesId: 's1' },
      { id: 'e3', day: '2026-09-24', cat: 'Work', title: 'Orphan', start: 570, end: 585, seriesId: 's2' },
    ],
  };
  const db = seed({ blob });
  const t = setup(db);
  const a = await t.call();
  assertEquals([a.body.series, a.body.events, a.body.skippedDetail.series], [1, 3, 1]);
  const s = mine(db, 'series');
  assertEquals(s.length, 1);
  assertEquals([s[0].legacy_id, s[0].weekdays, s[0].start_day, s[0].until, s[0].freq], ['s1', [1, 3], '2026-09-21', null, 'weekly']);
  assertEquals([ev(db, 'e1').series_id, ev(db, 'e2').series_id, ev(db, 'e3').series_id], [s[0].id, s[0].id, null], 'a series that was not imported leaves its events standalone');
  await t.call();
  assertEquals(mine(db, 'series').length, 1);
  assertEquals(mine(db, 'events').length, 3);
});

Deno.test('a large blob is imported in chunks', async () => {
  const events = Array.from({ length: 1234 }, (_, i) => ({ id: 'e' + (i + 1), day: '2026-09-22', cat: 'Work', title: 'T' + i, start: 540, end: 600 }));
  const db = seed({ blob: { cats: { Work: 255 }, events, goals: [] }, links: {} });
  const t = setup(db);
  assertEquals((await t.call()).body.events, 1234);
  assertEquals((await t.call()).body.created.events, 0);
  assertEquals(mine(db, 'events').length, 1234);
});

Deno.test('auth, method and preflight', async () => {
  const db = seed();
  const t = setup(db);
  t.deps.auth = () => Promise.reject(new HttpError(401, 'unauthorized', 'Invalid or expired token'));
  const a = await t.call();
  assertEquals([a.res.status, a.body.error], [401, 'unauthorized']);
  assertEquals(db.log.length, 0);
  const b = await t.call({ method: 'GET' });
  assertEquals([b.res.status, b.body.error], [405, 'method_not_allowed']);
  assertEquals((await handle(new Request('http://localhost/x', { method: 'OPTIONS' }), t.deps)).status, 204);
});

Deno.test('convert: event cleaning, hues and Google link shapes', () => {
  assertEquals(cleanEvent({ id: 'a', day: '2026-02-30', title: 'x', start: 0, end: 10 }), null, 'impossible date');
  assertEquals(cleanEvent({ id: 'a', day: '2026-02-03', title: 'x', start: 'nine', end: 10 }), null, 'non-numeric time');
  assertEquals(cleanEvent({ id: 7, day: '2026-02-03', title: 'x', start: 1500, end: 1700 })!.start, 1439, 'start is clamped');
  assertEquals(cleanEvent({ id: 'a', day: '2026-02-03', title: 'x', start: 100, end: 99999 })!.end, 1540, 'end is capped at start + 1440');
  assertEquals(cleanEvent({ id: 'a', day: '2026-02-03', title: 'x', start: 100, end: 50 })!.end, 115);
  assertEquals(cleanEvent({ id: 'a', day: '2026-02-03', title: 'x', allDay: true, days: 500 })!.days, 366);
  assertEquals([sane(255), sane(-30), sane(725), sane(1000), sane('x'), sane(undefined, 47)], [255, 330, 5, 1000, 1000, 47]);

  const { links, bad } = parseLinks({ a: 'g1', b: { gid: 'g2', hash: 'h' }, c: {}, d: '', e: null });
  assertEquals([...links], [['a', { googleId: 'g1', fingerprint: null }], ['b', { googleId: 'g2', fingerprint: 'h' }]]);
  assertEquals(bad, 3);
  assertEquals(parseLinks(null), { links: new Map(), bad: 0 });

  const p = plan({ events: [{ id: 'a', day: '2026-02-03', cat: '  Work  ', title: 'x', start: 0, end: 30 }], cats: { Work: 255, '': 4 }, goals: [{ id: 'g', title: '  ', start: '2026-01-01' }] }, new Date(2026, 1, 3));
  assertEquals(p.categories, [{ name: 'Work', hue: 255 }], 'names are trimmed and blank ones dropped');
  assertEquals(p.skipped.goals, 1, 'a goal with a blank title is skipped and counted');
});
