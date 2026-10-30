import { assertEquals } from '@std/assert';
import { envFrom } from '../_shared/env.ts';
import { HttpError } from '../_shared/http.ts';
import { FakeAdmin } from '../_shared/testing/fake_admin.ts';
import type { SupabaseClient } from '../_shared/supabase.ts';
import { GOOGLE_REVOKE_URL, handle } from './handler.ts';
import type { AccountDeleteDeps } from './handler.ts';

type GoogleReply = { status: number; body?: string } | { throws: Error };

const setup = (opts: { tokens?: Record<string, string | null>; google?: Record<string, GoogleReply>; userId?: string } = {}) => {
  const userId = opts.userId ?? 'user-1';
  const tokens = opts.tokens ?? { 'acc-1': 'tok-1', 'acc-2': 'tok-2' };
  const db = new FakeAdmin({
    google_accounts: [
      ...Object.keys(tokens).map((id) => ({ id, user_id: userId, email: id + '@example.test' })),
      { id: 'other-acc', user_id: 'user-2', email: 'other@example.test' },
    ],
    profiles: [{ id: userId }],
  });
  db.rpcs.get_google_refresh_token = (a) => tokens[a.p_account_id as string] ?? null;
  const order: string[] = [];
  const revokes: Array<{ url: string; method: string; type: string | null; token: string | null }> = [];
  const origDelete = db.auth.admin.deleteUser;
  db.auth.admin.deleteUser = (id: string) => {
    order.push('deleteUser:' + id + ':remaining-google-rows=' + db.rows('google_accounts').filter((r) => r.user_id === id).length);
    return origDelete(id);
  };
  const fetchFn = ((url: string, init: RequestInit) => {
    const params = new URLSearchParams(String(init.body));
    const token = params.get('token');
    revokes.push({ url, method: init.method ?? 'GET', type: new Headers(init.headers).get('content-type'), token });
    order.push('revoke:' + token);
    const r = opts.google?.[token ?? ''] ?? { status: 200 };
    if ('throws' in r) return Promise.reject(r.throws);
    return Promise.resolve(new Response(r.body ?? '{}', { status: r.status }));
  }) as unknown as typeof fetch;
  const deps: AccountDeleteDeps = {
    env: envFrom({}),
    fetch: fetchFn,
    auth: () => Promise.resolve({ id: userId, email: null }),
    admin: () => db as unknown as SupabaseClient,
    now: () => new Date(),
  };
  const call = async (init: RequestInit = {}) => {
    const res = await handle(new Request('http://localhost/account-delete', { method: 'POST', headers: { authorization: 'Bearer jwt' }, ...init }), deps);
    return { res, body: await res.json().catch(() => null) };
  };
  return { db, deps, order, revokes, call, userId };
};

Deno.test('revokes every Google refresh token, removes the connections, then deletes the user', async () => {
  const t = setup();
  const { res, body } = await t.call();
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true });
  assertEquals(t.revokes, [
    { url: GOOGLE_REVOKE_URL, method: 'POST', type: 'application/x-www-form-urlencoded', token: 'tok-1' },
    { url: GOOGLE_REVOKE_URL, method: 'POST', type: 'application/x-www-form-urlencoded', token: 'tok-2' },
  ]);
  // the user is deleted last, after both revocations and with the Google rows (and so, by trigger, the Vault secrets) gone
  assertEquals(t.order, ['revoke:tok-1', 'revoke:tok-2', 'deleteUser:user-1:remaining-google-rows=0']);
  assertEquals(t.db.deletedUsers, ['user-1']);
  assertEquals(t.db.rpcLog.map((r) => r.name), ['get_google_refresh_token', 'get_google_refresh_token']);
});

Deno.test('only the caller\'s accounts are touched', async () => {
  const t = setup();
  await t.call();
  assertEquals(t.db.rows('google_accounts').map((r) => r.id), ['other-acc']);
  assertEquals(t.db.rpcLog.map((r) => r.args.p_account_id), ['acc-1', 'acc-2']);
});

Deno.test('the user id comes from the JWT, not the request', async () => {
  const t = setup({ userId: 'user-from-jwt' });
  const { body } = await t.call({ headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ userId: 'user-2', user_id: 'user-2' }) });
  assertEquals(body, { ok: true });
  assertEquals(t.db.deletedUsers, ['user-from-jwt']);
  assertEquals(t.db.rows('google_accounts').map((r) => r.id), ['other-acc']);
});

Deno.test('a user with no Google accounts is just deleted', async () => {
  const t = setup({ tokens: {} });
  const { body } = await t.call();
  assertEquals(body, { ok: true });
  assertEquals(t.revokes.length, 0);
  assertEquals(t.db.deletedUsers, ['user-1']);
});

Deno.test('an account without a stored token (needs sign-in, or never completed) is skipped for revocation', async () => {
  const t = setup({ tokens: { 'acc-1': null, 'acc-2': 'tok-2' } });
  const { body } = await t.call();
  assertEquals(body, { ok: true });
  assertEquals(t.revokes.map((r) => r.token), ['tok-2']);
  assertEquals(t.db.deletedUsers, ['user-1']);
});

Deno.test('a token Google already considers invalid counts as revoked', async () => {
  const t = setup({ google: { 'tok-1': { status: 400, body: '{"error":"invalid_token","error_description":"Token expired or revoked"}' } } });
  const { res, body } = await t.call();
  assertEquals([res.status, body], [200, { ok: true }]);
  assertEquals(t.db.deletedUsers, ['user-1']);
});

Deno.test('Google being down does not block deleting the account', async () => {
  const t = setup({ google: { 'tok-1': { status: 503 }, 'tok-2': { throws: new TypeError('network down') } } });
  const { res, body } = await t.call();
  assertEquals([res.status, body], [200, { ok: true }]);
  assertEquals(t.revokes.length, 2, 'both were attempted');
  assertEquals(t.db.deletedUsers, ['user-1']);
});

Deno.test('if the user cannot be deleted the call fails, and a retry works', async () => {
  const t = setup();
  t.db.deleteUserError = 'database error deleting user';
  const first = await t.call();
  assertEquals([first.res.status, first.body.error], [502, 'delete_failed']);
  assertEquals(t.db.deletedUsers, []);
  t.db.deleteUserError = null;
  const second = await t.call();
  assertEquals([second.res.status, second.body], [200, { ok: true }]);
  assertEquals(t.db.deletedUsers, ['user-1']);
});

Deno.test('database errors before the deletion abort without deleting the user', async () => {
  const listing = setup();
  listing.db.failTables.google_accounts = 'permission denied';
  const a = await listing.call();
  assertEquals([a.res.status, a.body.error], [502, 'delete_failed']);
  assertEquals(listing.db.deletedUsers, []);

  const vault = setup();
  vault.db.rpcs.get_google_refresh_token = () => { throw new Error('vault unavailable'); };
  // an rpc handler that throws surfaces as an unhandled error -> 500, never a silent success
  const b = await vault.call();
  assertEquals(b.res.status, 500);
  assertEquals(vault.db.deletedUsers, []);
});

Deno.test('unauthenticated, wrong method, preflight', async () => {
  const t = setup();
  t.deps.auth = () => Promise.reject(new HttpError(401, 'unauthorized', 'Missing bearer token'));
  const a = await t.call();
  assertEquals([a.res.status, a.body.error], [401, 'unauthorized']);
  assertEquals(t.db.deletedUsers, []);
  assertEquals(t.revokes.length, 0);

  const b = await t.call({ method: 'GET' });
  assertEquals([b.res.status, b.body.error], [405, 'method_not_allowed']);
  const c = await handle(new Request('http://localhost/account-delete', { method: 'OPTIONS' }), t.deps);
  assertEquals(c.status, 204);
});
