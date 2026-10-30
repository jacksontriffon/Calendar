import { assert, assertEquals, harness } from './testing/harness.ts';
import { uid } from './testing/fake_db.ts';
import { handleConnect, handleSync } from './handlers.ts';
import { drain, renewWatchBatch, syncNow } from './sync.ts';
import { handleWebhook } from './webhook.ts';
import { channelToken } from './webhook.ts';
import { handleCallback, startConnect, syncCalendarList } from './connect.ts';
import { hashState } from './state.ts';

const KEY = 'service-key';
const asUser = (id: string) => (jwt: string) => Promise.resolve(jwt === 'jwt-' + id ? id : null);
const post = (body: unknown, token?: string) =>
  new Request('https://x.test/fn', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

/* ----------------------------------------------------------------------- queue drain */

const importJob = (msg_id: number, user_id: string, calendar_id: string) => ({ msg_id, attempt: 1, payload: { calendar_id, user_id } });

Deno.test('drain: takes the user lock, runs the job, acks it, releases the lock', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  h.g.setEvent('primary', { id: 'a', summary: 'A', start: { dateTime: '2026-11-03T14:00:00Z' }, end: { dateTime: '2026-11-03T15:00:00Z' } });
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(7, h.userId, cal.id), importJob(8, h.userId, cal.id)] });
  assertEquals(r.acked, 2); // duplicate messages for one calendar are merged and both acked
  assertEquals(h.db.acked, [{ queue: 'import', ids: [7, 8] }]);
  assertEquals(h.db.lockLog, [`try:${h.userId}`, `lock:${h.userId}`, `release:${h.userId}`]);
  assertEquals(h.db.liveImported().length, 1);
  assertEquals(h.g.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/events')).length, 1);
});

Deno.test('drain: a busy user is skipped without acking', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  h.db.locks.add(h.userId);
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(1, h.userId, cal.id)] }, { lockSleep: () => Promise.resolve() });
  assertEquals([r.busy, r.acked], [1, 0]);
  assertEquals(h.db.acked, []);
  assertEquals(h.g.calls.length, 0);
  assert(h.db.locks.has(h.userId)); // somebody else's lock is not released
});

Deno.test('drain: the lock is released in finally when a job blows up, and the job is not acked', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  h.g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 500, 99);
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(1, h.userId, cal.id)] });
  assertEquals([r.retry, r.acked], [1, 0]);
  assertEquals(h.db.acked, []);
  assertEquals(h.db.locks.size, 0);
  assertEquals(h.db.lockLog.at(-1), `release:${h.userId}`);
});

Deno.test('drain: a permanent Google error is acked (not retried forever); a DB error is retried', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  h.g.failNext((c) => c.path.endsWith('/events') && c.method === 'GET', 404, 1);
  assertEquals((await drain(h.deps, { queue: 'import', jobs: [importJob(1, h.userId, cal.id)] })).acked, 1);

  h.db.listOwnExternalIds = () => Promise.reject(new Error('db down'));
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(2, h.userId, cal.id)] });
  assertEquals([r.retry, r.acked], [1, 0]);
});

Deno.test('drain: jobs of different users are locked separately; malformed jobs are acked as poison', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  const other = uid();
  const acct2 = h.db.addAccount(other, 'maya@example.test');
  const cal2 = h.db.addCalendar(acct2, { google_id: 'primary' });
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(1, h.userId, cal.id), importJob(2, other, cal2.id), { msg_id: 3, payload: { nope: true } }] });
  assertEquals([r.acked, r.invalid], [2, 1]);
  assertEquals(h.db.lockLog.filter((l) => l.startsWith('lock:')).sort(), [`lock:${h.userId}`, `lock:${other}`].sort());
  assert(h.db.acked.some((a) => a.ids.includes(3)));
});

Deno.test('drain: publish jobs run publish for the event; needs_signin is acked (recorded on the target)', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test', 'needs_signin');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', can_publish: true });
  const ev = h.db.addEvent({ user_id: h.userId, visibility: 'public' });
  const t = h.db.addTarget(ev, cal);
  const r = await drain(h.deps, { queue: 'publish', jobs: [{ msg_id: 5, payload: { event_id: ev.id, user_id: h.userId } }] });
  assertEquals(r.acked, 1);
  assertEquals(h.db.target(t.id)!.status, 'failed');
  assertEquals(h.g.calls.length, 0);
});

Deno.test('drain: stops starting new work once the budget is spent', async () => {
  const clock = { t: 0 };
  const h = harness({ clock });
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const c1 = h.db.addCalendar(acct, { google_id: 'a' });
  const c2 = h.db.addCalendar(acct, { google_id: 'b' });
  const origList = h.db.listOwnExternalIds.bind(h.db);
  h.db.listOwnExternalIds = (id: string) => { clock.t += 60_000; return origList(id); };
  const r = await drain(h.deps, { queue: 'import', jobs: [importJob(1, h.userId, c1.id), importJob(2, h.userId, c2.id)] }, { budgetMs: 30_000 });
  assertEquals([r.acked, r.deferred], [1, 1]);
});

Deno.test('renew_watch: creates channels for the calendars it is given', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary' });
  const hidden = h.db.addCalendar(acct, { google_id: 'hidden', show_in_app: false });
  const r = await renewWatchBatch(h.deps, [{ id: cal.id, user_id: h.userId }, { id: hidden.id, user_id: h.userId }, { id: cal.id, user_id: uid() }]);
  assertEquals([r.created, r.skipped], [1, 2]);
  assert(h.db.cal(cal.id).channel_id && h.db.cal(cal.id).channel_resource_id && h.db.cal(cal.id).channel_expires_at);
});

Deno.test('sync now: publishes pending targets then imports, for that user only', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', can_publish: true });
  const ev = h.db.addEvent({ user_id: h.userId, visibility: 'public' });
  h.db.addTarget(ev, cal);
  const other = uid();
  const otherCal = h.db.addCalendar(h.db.addAccount(other, 'maya@example.test'), { google_id: 'maya' });
  h.g.setEvent('primary', { id: 'a', start: { dateTime: '2026-11-03T14:00:00Z' }, end: { dateTime: '2026-11-03T15:00:00Z' } });

  const r = await syncNow(h.deps, h.userId);
  assertEquals(r.published, 1);
  assertEquals(r.calendars.map((c) => c.status), ['ok']);
  assertEquals(h.db.liveImported().length, 1);
  assert(h.g.calls.every((c) => !c.path.includes('/maya/')));
  assertEquals(h.db.locks.size, 0);

  assertEquals((await syncNow(h.deps, h.userId, otherCal.id)).calendars, [{ id: otherCal.id, status: 'not_found' }]);
  h.db.locks.add(h.userId);
  assertEquals((await syncNow(h.deps, h.userId)).busy, true);
});

/* --------------------------------------------------------------------- google-sync HTTP */

Deno.test('google-sync auth: service role for the queue; users only for sync_now', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  h.db.addCalendar(acct, { google_id: 'primary' });
  const auth = { serviceRoleKey: KEY, authenticate: asUser(h.userId) };
  const call = (body: unknown, token?: string) => handleSync(post(body, token), h.deps, auth);

  assertEquals((await call({ action: 'drain', queue: 'import', jobs: [] })).status, 401);
  assertEquals((await call({ action: 'drain', queue: 'import', jobs: [] }, 'wrong')).status, 401);
  assertEquals((await call({ action: 'drain', queue: 'import', jobs: [] }, 'jwt-' + h.userId)).status, 403);
  assertEquals((await call({ action: 'renew_watch', calendars: [] }, 'jwt-' + h.userId)).status, 403);
  assertEquals((await call({ action: 'drain', queue: 'import', jobs: [] }, KEY)).status, 200);
  assertEquals((await call({ action: 'drain', queue: 'bogus', jobs: [] }, KEY)).status, 400);
  assertEquals((await call({ action: 'renew_watch', calendars: [] }, KEY)).status, 200);
  assertEquals((await call({ action: 'nope' }, KEY)).status, 400);

  // a user's sync_now is always about that user, whatever the body says
  const res = await call({ action: 'sync_now', user_id: uid() }, 'jwt-' + h.userId);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).calendars.length, 1);
  assertEquals((await handleSync(new Request('https://x.test/fn', { method: 'GET' }), h.deps, auth)).status, 405);
  assertEquals((await handleSync(new Request('https://x.test/fn', { method: 'OPTIONS' }), h.deps, auth)).status, 204);
});

/* --------------------------------------------------------------------------- webhook */

Deno.test('webhook: validates the channel token, ignores `sync`, queues an import and answers 200', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', channel_id: 'chan-1' });
  const hidden = h.db.addCalendar(acct, { google_id: 'h', channel_id: 'chan-2', show_in_app: false });
  const deps = { secret: 'whsec', findCalendarByChannel: (id: string) => h.db.findCalendarByChannel(id), enqueueImport: (id: string) => h.db.enqueueImport(id) };
  const hook = async (channel: string | null, token: string | null, state = 'exists') => {
    const headers: Record<string, string> = { 'X-Goog-Resource-State': state };
    if (channel) headers['X-Goog-Channel-ID'] = channel;
    if (token) headers['X-Goog-Channel-Token'] = token;
    return handleWebhook(new Request('https://x.test/hook', { method: 'POST', headers }), deps);
  };
  const good = await channelToken('whsec', 'chan-1');

  assertEquals((await hook('chan-1', good)).status, 200);
  assertEquals(h.db.importQueued, [cal.id]);

  assertEquals((await hook('chan-1', 'bad')).status, 401);
  assertEquals((await hook('chan-1', null)).status, 401);
  assertEquals((await hook('chan-1', await channelToken('other-secret', 'chan-1'))).status, 401);
  assertEquals((await hook('chan-1', await channelToken('whsec', 'chan-2'))).status, 401); // a token for another channel
  assertEquals((await hook(null, good)).status, 400);
  assertEquals(h.db.importQueued.length, 1);

  assertEquals((await hook('chan-1', good, 'sync')).status, 200); // the hello message
  assertEquals(h.db.importQueued.length, 1);

  const unknown = await hook('chan-x', await channelToken('whsec', 'chan-x'));
  assertEquals([unknown.status, (await unknown.json()).ignored], [200, 'unknown_channel']);
  const hid = await hook('chan-2', await channelToken('whsec', 'chan-2'));
  assertEquals([hid.status, (await hid.json()).ignored], [200, 'hidden']);
  assertEquals(h.db.importQueued, [cal.id]);
  void hidden;
  assertEquals((await handleWebhook(new Request('https://x.test/hook'), deps)).status, 405);
});

/* ---------------------------------------------------------------------- google-connect */

const stateFromUrl = (url: string) => new URL(url).searchParams.get('state')!;

Deno.test('connect start: stores a bound, hashed, expiring state and builds the consent URL', async () => {
  const h = harness();
  const { url } = await startConnect(h.connect, h.userId, { returnUrl: 'aicalendar://google/connected' });
  const u = new URL(url);
  assertEquals(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assertEquals(u.searchParams.get('access_type'), 'offline');
  assertEquals(u.searchParams.get('prompt'), 'consent');
  assertEquals(u.searchParams.get('response_type'), 'code');
  assertEquals(u.searchParams.get('redirect_uri'), 'https://x.test/functions/v1/google-connect');
  const scopes = u.searchParams.get('scope')!.split(' ');
  for (const s of ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email']) assert(scopes.includes(s), s);
  const state = stateFromUrl(url);
  const stored = h.db.states.get(await hashState(state))!;
  assertEquals([stored.user_id, stored.return_url, stored.account_id], [h.userId, 'aicalendar://google/connected', null]);
  assertEquals(stored.expires, h.deps.now() + 600_000);
  assert(![...h.db.states.keys()].includes(state)); // only the hash is stored
});

Deno.test('connect start: the return URL must be allow-listed (and defaults to the first entry)', async () => {
  const h = harness();
  for (const bad of ['https://evil.test', 'javascript:alert(1)', 'aicalendar://evil/connected']) {
    const res = await handleConnect(post({ action: 'start', return_url: bad }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
    assertEquals([res.status, (await res.json()).error], [400, 'return_url_not_allowed']);
  }
  const ok = await handleConnect(post({ action: 'start' }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  assertEquals(ok.status, 200);
  assertEquals([...h.db.states.values()][0].return_url, 'aicalendar://google/connected');
});

Deno.test('connect http: only the callback skips the JWT', async () => {
  const h = harness();
  const auth = asUser(h.userId);
  for (const action of ['start', 'list', 'disconnect', 'reconnect']) {
    assertEquals((await handleConnect(post({ action }), h.connect, auth)).status, 401, action);
    assertEquals((await handleConnect(post({ action }, 'bad-jwt'), h.connect, auth)).status, 401, action);
  }
  const cb = await handleConnect(new Request('https://x.test/fn?code=c&state=nope'), h.connect, auth); // GET, no JWT
  assertEquals(cb.status, 400);
  assertEquals((await handleConnect(post({ action: 'bogus' }, 'jwt-' + h.userId), h.connect, auth)).status, 400);
});

const connectFlow = async (h: ReturnType<typeof harness>, o: { returnUrl?: string; accountId?: string } = {}) => {
  const { url } = await startConnect(h.connect, h.userId, { returnUrl: o.returnUrl ?? 'aicalendar://google/connected', accountId: o.accountId });
  return stateFromUrl(url);
};
const cbUrl = (q: Record<string, string>) => new URLSearchParams(q);

Deno.test('connect callback: stores the account and token, lists calendars with defaults, queues imports, redirects', async () => {
  const h = harness();
  h.g.calendarList = [
    { id: 'sam@example.test', summary: 'Sam', backgroundColor: '#4285f4', accessRole: 'owner', primary: true },
    { id: 'family', summary: 'Family', accessRole: 'owner' },
    { id: 'maya', summary: 'Maya', accessRole: 'reader' },
    { id: 'edit', summary: 'Team', accessRole: 'writer' },
    { id: 'old', summary: 'Gone', accessRole: 'owner', deleted: true },
  ];
  h.g.acl.set('sam@example.test', [{ role: 'owner', scope: { type: 'user', value: 'sam@example.test' } }]);
  h.g.acl.set('family', [{ role: 'owner', scope: { type: 'user', value: 'sam@example.test' } }, { role: 'reader', scope: { type: 'user', value: 'maya@example.test' } }]);
  const state = await connectFlow(h);

  const res = await handleCallback(h.connect, cbUrl({ code: 'good', state }));
  assertEquals(res.status, 302);
  const loc = new URL(res.headers.get('Location')!);
  assertEquals(`${loc.protocol}//${loc.host}${loc.pathname}`, 'aicalendar://google/connected');
  assertEquals(loc.searchParams.get('connected'), '1');

  const acct = h.db.accounts[0];
  assertEquals([acct.email, acct.status, acct.user_id], ['sam@example.test', 'ok', h.userId]); // email from userinfo
  assertEquals(loc.searchParams.get('account_id'), acct.id);
  assertEquals(h.db.tokens.get(acct.id), 'rt-new');

  const by = Object.fromEntries(h.db.calendars.map((c) => [c.google_id, c]));
  assertEquals(Object.keys(by).sort(), ['edit', 'family', 'maya', 'sam@example.test']); // deleted ones are not listed
  assertEquals([by['sam@example.test'].show_in_app, by['sam@example.test'].can_publish, by['sam@example.test'].is_primary, by['sam@example.test'].shared, by['sam@example.test'].color], [true, true, true, false, '#4285f4']);
  assertEquals([by.family.show_in_app, by.family.can_publish, by.family.shared, by.family.access_role], [false, false, true, 'owner']);
  assertEquals([by.maya.shared, by.maya.access_role, by.maya.can_publish], [true, 'reader', false]);
  assertEquals([by.edit.shared, by.edit.can_publish], [true, false]);
  assertEquals(h.db.importQueued, [by['sam@example.test'].id]);

  // the state was single-use
  const again = await handleCallback(h.connect, cbUrl({ code: 'good', state }));
  assertEquals(again.status, 400);
});

Deno.test('connect callback: unknown, malformed, expired and replayed states are rejected with 400, no redirect', async () => {
  const h = harness();
  for (const state of ['', 'x', 'A'.repeat(43), 'not a state!']) {
    const r = await handleCallback(h.connect, cbUrl(state ? { code: 'good', state } : { code: 'good' }));
    assertEquals([r.status, r.headers.get('Location')], [400, null]);
  }
  const state = await connectFlow(h);
  h.db.now = () => h.deps.now() + 11 * 60_000; // past the ten-minute TTL
  const r = await handleCallback(h.connect, cbUrl({ code: 'good', state }));
  assertEquals(r.status, 400);
  assertEquals(h.db.accounts.length, 0);
});

Deno.test('connect callback: a state whose return URL is no longer allow-listed is refused', async () => {
  const h = harness();
  const state = await connectFlow(h, { returnUrl: 'https://www.claude-calendar.com/settings' });
  const r = await handleCallback({ ...h.connect, returnUrls: ['aicalendar://google/connected'] }, cbUrl({ code: 'good', state }));
  assertEquals([r.status, r.headers.get('Location')], [400, null]);
});

Deno.test('connect callback: errors redirect to the return URL with ?error=', async () => {
  const h = harness();
  const run = async (q: Record<string, string>, tweak?: () => void) => {
    const state = await connectFlow(h, { returnUrl: 'https://www.claude-calendar.com/settings' });
    tweak?.();
    const res = await handleCallback(h.connect, cbUrl({ state, ...q }));
    assertEquals(res.status, 302);
    const loc = new URL(res.headers.get('Location')!);
    assertEquals(loc.origin + loc.pathname, 'https://www.claude-calendar.com/settings');
    return loc.searchParams.get('error');
  };
  assertEquals(await run({ error: 'access_denied' }), 'access_denied');
  assertEquals(await run({}), 'missing_code');
  assertEquals(await run({ code: 'bad-code' }), 'token_exchange_failed');
  assertEquals(await run({ code: 'good' }, () => { h.g.code = { ...h.g.code, scope: 'openid email https://www.googleapis.com/auth/calendar.readonly' }; }), 'missing_scope');
  assertEquals(await run({ code: 'good' }, () => { h.g.code = { access_token: 'at', scope: undefined, expires_in: 3600 }; }), 'no_refresh_token');
  assertEquals(await run({ code: 'good' }, () => { h.g.code = { access_token: 'at', refresh_token: 'r', expires_in: 3600 }; h.g.userinfo = {}; }), 'no_email');
  assertEquals(h.db.accounts.length, 0); // nothing was stored by any failure
});

Deno.test('connect callback: the email can come from the id token; an existing account keeps its row', async () => {
  const h = harness();
  const payload = btoa(JSON.stringify({ email: 'Sam@Example.test', email_verified: true })).replace(/=+$/, '');
  h.g.code = { ...h.g.code, id_token: `x.${payload}.y` };
  h.g.userinfo = { email: 'wrong@example.test' };
  await handleCallback(h.connect, cbUrl({ code: 'good', state: await connectFlow(h) }));
  assertEquals(h.db.accounts.map((a) => a.email), ['sam@example.test']);
  const id = h.db.accounts[0].id;
  h.g.code = { ...h.g.code, refresh_token: 'rt-second' };
  await handleCallback(h.connect, cbUrl({ code: 'good', state: await connectFlow(h) }));
  assertEquals([h.db.accounts.length, h.db.accounts[0].id, h.db.tokens.get(id)], [1, id, 'rt-second']);
});

Deno.test('connect reconnect: restores a needs_signin account, retries its failed targets, refuses a different Google account', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test', 'needs_signin', 'stale');
  const cal = h.db.addCalendar(acct, { google_id: 'sam@example.test', is_primary: true, can_publish: true });
  const ev = h.db.addEvent({ user_id: h.userId, visibility: 'public' });
  const t = h.db.addTarget(ev, cal, { status: 'failed', error: 'Google needs you to sign in again' });
  h.g.calendarList = [{ id: 'sam@example.test', summary: 'Sam', accessRole: 'owner', primary: true }];

  const { url } = await startConnect(h.connect, h.userId, { returnUrl: 'aicalendar://google/connected', accountId: acct.id });
  assertEquals(new URL(url).searchParams.get('login_hint'), 'sam@example.test');
  const state = stateFromUrl(url);
  assertEquals(h.db.states.get(await hashState(state))!.account_id, acct.id);

  h.g.userinfo = { email: 'someone.else@example.test' };
  const wrong = await handleCallback(h.connect, cbUrl({ code: 'good', state }));
  assertEquals(new URL(wrong.headers.get('Location')!).searchParams.get('error'), 'wrong_account');
  assertEquals([h.db.accounts.length, h.db.accounts[0].status], [1, 'needs_signin']);

  h.g.userinfo = { email: 'sam@example.test' };
  const ok = await handleCallback(h.connect, cbUrl({ code: 'good', state: (await connectFlow(h, { accountId: acct.id })) }));
  assertEquals(new URL(ok.headers.get('Location')!).searchParams.get('connected'), '1');
  assertEquals([h.db.accounts[0].status, h.db.tokens.get(acct.id)], ['ok', 'rt-new']);
  assertEquals([h.db.target(t.id)!.status, h.db.target(t.id)!.error, h.db.publishQueued], ['pending', null, [ev.id]]);
  assertEquals(h.db.importQueued, [cal.id]);

  // reconnecting somebody else's account is a 404
  const other = h.db.addAccount(uid(), 'x@example.test');
  const res = await handleConnect(post({ action: 'reconnect', account_id: other.id }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  assertEquals(res.status, 404);
});

Deno.test('connect list: refreshes calendars, keeps the user toggles, drops removed calendars, flags needs_signin', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const fam = h.db.addCalendar(acct, { google_id: 'family', name: 'Old name', show_in_app: true, can_publish: true, access_role: 'writer', shared: false });
  const gone = h.db.addCalendar(acct, { google_id: 'gone' });
  h.db.addEvent({ user_id: h.userId });
  h.g.calendarList = [{ id: 'family', summary: 'Family', accessRole: 'reader' }, { id: 'new', summary: 'New', accessRole: 'owner' }];
  const res = await handleConnect(post({ action: 'list' }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  const body = await res.json();
  assertEquals(res.status, 200);
  const f = h.db.cal(fam.id);
  assertEquals([f.name, f.access_role, f.shared, f.show_in_app, f.can_publish], ['Family', 'reader', true, true, false]); // write access lost -> cannot publish
  assertEquals(h.db.calendars.find((c) => c.id === gone.id), undefined);
  assertEquals(body.accounts[0].calendars.map((c: { google_id: string }) => c.google_id).sort(), ['family', 'new']);
  assert(!JSON.stringify(body).includes('refresh')); // no tokens in the response

  h.g.revokedRefresh.add('refresh-sam@example.test');
  h.db.accounts[0].status = 'ok';
  h.connect.tokens = new (h.connect.tokens.constructor as typeof import('./tokens.ts').AccessTokens)(h.db, h.deps.api, h.deps.now);
  const res2 = await handleConnect(post({ action: 'list' }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  assertEquals((await res2.json()).accounts[0].status, 'needs_signin');
  assertEquals(h.db.accounts[0].status, 'needs_signin');
});

Deno.test('connect disconnect: revokes the token, deletes the account, calendars and imported events', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  const cal = h.db.addCalendar(acct, { google_id: 'primary', channel_id: 'ch', channel_resource_id: 'res' });
  h.db.imported.push({ id: uid(), user_id: h.userId, google_calendar_id: cal.id, google_event_id: 'a', source: 'google', title: 'A', day: '2026-11-03', start_min: 0, end_min: 60, all_day: false, days: 1, etag: null, organizer_email: null, is_mine: false, deleted_at: null });
  const ev = h.db.addEvent({ user_id: h.userId, visibility: 'public' });
  h.db.addTarget(ev, cal);
  const keep = h.db.addAccount(h.userId, 'sam@work.test');

  const res = await handleConnect(post({ action: 'disconnect', account_id: acct.id }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  assertEquals(res.status, 200);
  assertEquals(h.g.revoked, ['refresh-sam@example.test']);
  assertEquals(h.g.channelsStopped, [{ id: 'ch', resourceId: 'res' }]);
  assertEquals([h.db.accounts.map((a) => a.id), h.db.calendars.length, h.db.imported.length, h.db.targets.length], [[keep.id], 0, 0, 0]);
  assertEquals(h.db.appEvents.length, 1); // the user's own events stay

  // another user's account can't be disconnected
  const theirs = h.db.addAccount(uid(), 'x@example.test');
  const no = await handleConnect(post({ action: 'disconnect', account_id: theirs.id }, 'jwt-' + h.userId), h.connect, asUser(h.userId));
  assertEquals(no.status, 404);
  assert(h.db.accounts.some((a) => a.id === theirs.id));
});

Deno.test('connect list: ACL errors fall back to "not shared" for owned calendars', async () => {
  const h = harness();
  const acct = h.db.addAccount(h.userId, 'sam@example.test');
  h.g.aclStatus = 403;
  h.g.calendarList = [{ id: 'mine', accessRole: 'owner' }];
  await syncCalendarList(h.connect, acct);
  assertEquals(h.db.calendars[0].shared, false);
});
