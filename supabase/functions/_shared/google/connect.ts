/**
 * google-connect: OAuth connect / callback / list / disconnect / reconnect.
 *
 * `callback` is the only unauthenticated entry point (Google redirects the browser to it). It trusts
 * nothing but a `state` this service issued: single use, bound to the user and the return URL that
 * were requested through an authenticated call, ten-minute expiry. The return URL is checked against
 * the allow-list (`GOOGLE_RETURN_URLS`) both when it is requested and again here.
 */
import { EVENTS_SCOPE, GoogleApi, GoogleApiError, InvalidGrantError } from './api.ts';
import type { GoogleDb } from './db.ts';
import { HttpError, json, redirect } from './http.ts';
import { canWrite, mapCalendarEntry, newCalendarDefaults, normRole } from './mapping.ts';
import { hashState, isAllowedReturnUrl, looksLikeState, newState, STATE_TTL_SECONDS, withParams } from './state.ts';
import { AccessTokens, NeedsSigninError } from './tokens.ts';
import type { AccountRow, CalendarRow, TokenResponse } from './types.ts';

export interface ConnectDeps {
  db: GoogleDb;
  api: GoogleApi;
  tokens: AccessTokens;
  /** allow-listed return URLs (`GOOGLE_RETURN_URLS`); the first is the default */
  returnUrls: string[];
  log: (msg: string, extra?: unknown) => void;
}

/* ------------------------------------------------------------ start / reconnect */

export async function startConnect(
  deps: ConnectDeps, userId: string, o: { returnUrl?: string; loginHint?: string; accountId?: string },
): Promise<{ url: string }> {
  const returnUrl = o.returnUrl ?? deps.returnUrls[0];
  if (!returnUrl || !isAllowedReturnUrl(returnUrl, deps.returnUrls)) {
    throw new HttpError(400, 'return_url is not allowed', 'return_url_not_allowed');
  }
  let loginHint = o.loginHint;
  if (o.accountId) {
    const account = await deps.db.getAccount(o.accountId);
    if (!account || account.user_id !== userId) throw new HttpError(404, 'account not found', 'not_found');
    loginHint = account.email;
  }
  const state = newState();
  await deps.db.createOAuthState({
    hash: await hashState(state), userId, returnUrl, accountId: o.accountId ?? null, ttlSeconds: STATE_TTL_SECONDS,
  });
  return { url: deps.api.authUrl({ state, loginHint }) };
}

/* -------------------------------------------------------------------- callback */

const idTokenEmail = (idToken: string | undefined): string | null => {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
    // Received straight from Google's token endpoint over TLS, so the signature need not be re-verified.
    return typeof json.email === 'string' && json.email_verified !== false ? json.email : null;
  } catch {
    return null;
  }
};

/** A plain-text error for failures where there is no trustworthy place to redirect to. */
const badRequest = (code: string, message: string): Response => json({ error: code, message }, 400);

export async function handleCallback(deps: ConnectDeps, query: URLSearchParams): Promise<Response> {
  const stateParam = query.get('state');
  if (!looksLikeState(stateParam)) return badRequest('invalid_state', 'Missing or malformed state.');
  const st = await deps.db.consumeOAuthState(await hashState(stateParam));
  if (!st) return badRequest('invalid_state', 'This sign-in link is unknown, expired or was already used.');
  // The allow-list may have changed since `start`; never redirect to a URL that is not on it.
  if (!isAllowedReturnUrl(st.return_url, deps.returnUrls)) return badRequest('return_url_not_allowed', 'The return URL is not allowed.');

  const fail = (code: string): Response => redirect(withParams(st.return_url, { error: code }));

  const googleError = query.get('error');
  if (googleError) return fail(googleError === 'access_denied' ? 'access_denied' : 'google_error');
  const code = query.get('code');
  if (!code) return fail('missing_code');

  let tokens: TokenResponse;
  try {
    tokens = await deps.api.exchangeCode(code);
  } catch (e) {
    deps.log('code exchange failed', e instanceof Error ? e.message : String(e));
    return fail('token_exchange_failed');
  }
  if (!tokens.access_token) return fail('token_exchange_failed');
  // Granular consent lets the user untick scopes; without calendar.events we can't publish.
  if (tokens.scope && !tokens.scope.split(' ').includes(EVENTS_SCOPE)) return fail('missing_scope');

  let email = idTokenEmail(tokens.id_token);
  if (!email) {
    try {
      const info = await deps.api.userinfo(tokens.access_token);
      email = info.email_verified === false ? null : info.email ?? null;
    } catch {
      email = null;
    }
  }
  if (!email) return fail('no_email');
  email = email.trim().toLowerCase();

  try {
    let account: AccountRow | null = await deps.db.findAccountByEmail(st.user_id, email);
    // Reconnect is for one account: signing in as somebody else must not touch (or create) anything.
    if (st.account_id && account?.id !== st.account_id) return fail('wrong_account');
    if (!account) {
      if (!tokens.refresh_token) return fail('no_refresh_token');
      account = await deps.db.insertAccount(st.user_id, email);
    }
    if (tokens.refresh_token) {
      await deps.db.setRefreshToken(account.id, tokens.refresh_token); // also sets status = 'ok'
    } else if (account.status !== 'ok' || !(await deps.db.getRefreshToken(account.id))) {
      return fail('no_refresh_token'); // `prompt=consent` makes this rare
    }

    deps.tokens.prime(account.id, tokens.access_token, tokens.expires_in ?? 3600);
    const calendars = await syncCalendarList(deps, { ...account, status: 'ok' });
    // Reconnect: pick up where we left off.
    await deps.db.retryFailedTargets(account.id);
    for (const c of calendars) if (c.show_in_app) await deps.db.enqueueImport(c.id);

    return redirect(withParams(st.return_url, { connected: '1', account_id: account.id }));
  } catch (e) {
    deps.log('callback failed', e instanceof Error ? e.message : String(e));
    return fail('server_error');
  }
}

/* ------------------------------------------------------------------ calendar list */

/**
 * Refreshes `google_calendars` for an account from Google's calendar list. New calendars get the
 * defaults (the primary: show_in_app and can_publish; everything else off); existing rows keep the
 * user's two toggles (except `can_publish` is cleared if write access was lost). Calendars Google no
 * longer lists are deleted (with their imported events).
 */
export async function syncCalendarList(deps: ConnectDeps, account: AccountRow): Promise<CalendarRow[]> {
  const token = await deps.tokens.get(account.id);
  const entries = (await deps.api.listCalendarList(token)).filter((e) => !e.deleted);
  const existing = await deps.db.listCalendars(account.id);
  const byGoogleId = new Map(existing.map((c) => [c.google_id, c]));

  for (const e of entries) {
    const role = normRole(e.accessRole);
    const acl = role === 'owner' ? await deps.api.listAcl(token, e.id) : null;
    const f = mapCalendarEntry(e, acl, account.email);
    const ex = byGoogleId.get(e.id);
    if (!ex) {
      byGoogleId.set(e.id, await deps.db.insertCalendar(account.user_id, account.id, { ...f, ...newCalendarDefaults(f) }));
      continue;
    }
    const patch: Partial<CalendarRow> = {};
    if (ex.name !== f.name) patch.name = f.name;
    if (ex.color !== f.color) patch.color = f.color;
    if (ex.access_role !== f.access_role) patch.access_role = f.access_role;
    if (ex.is_primary !== f.is_primary) patch.is_primary = f.is_primary;
    if (ex.shared !== f.shared) patch.shared = f.shared;
    if (ex.can_publish && !canWrite(f.access_role)) patch.can_publish = false;
    if (Object.keys(patch).length) {
      await deps.db.updateCalendar(ex.id, patch);
      byGoogleId.set(e.id, { ...ex, ...patch });
    }
  }

  if (entries.length) {
    const live = new Set(entries.map((e) => e.id));
    for (const c of existing) {
      if (!live.has(c.google_id)) {
        await deps.db.deleteCalendar(c.id);
        byGoogleId.delete(c.google_id);
      }
    }
  }
  return [...byGoogleId.values()];
}

/* ------------------------------------------------------------------------- list */

export interface AccountView {
  id: string;
  email: string;
  status: string;
  calendars: Array<Pick<CalendarRow, 'id' | 'google_id' | 'name' | 'color' | 'access_role' | 'is_primary' | 'shared' | 'show_in_app' | 'can_publish' | 'last_synced_at'>>;
}

const view = (a: AccountRow, cals: CalendarRow[]): AccountView => ({
  id: a.id, email: a.email, status: a.status,
  calendars: cals.map((c) => ({
    id: c.id, google_id: c.google_id, name: c.name, color: c.color, access_role: c.access_role, is_primary: c.is_primary,
    shared: c.shared, show_in_app: c.show_in_app, can_publish: c.can_publish, last_synced_at: c.last_synced_at,
  })),
});

/** Refreshes every signed-in account's calendar list and returns the user's accounts with their calendars. */
export async function listAccounts(deps: ConnectDeps, userId: string): Promise<AccountView[]> {
  const out: AccountView[] = [];
  for (const a of await deps.db.listAccounts(userId)) {
    let account = a;
    if (a.status === 'ok') {
      try {
        await syncCalendarList(deps, a);
      } catch (e) {
        if (e instanceof NeedsSigninError) account = { ...a, status: 'needs_signin' };
        else deps.log('calendar list refresh failed for ' + a.id, e instanceof Error ? e.message : String(e));
      }
    }
    out.push(view(account, await deps.db.listCalendars(a.id)));
  }
  return out;
}

/* ------------------------------------------------------------------- disconnect */

/**
 * Stops the account's watch channels, revokes the refresh token, deletes the account (the database
 * cascades to its calendars, imported events and targets, and deletes the Vault secret). Google
 * copies of events the user published stay on their Google calendar.
 */
export async function disconnectAccount(deps: ConnectDeps, userId: string, accountId: string): Promise<void> {
  const account = await deps.db.getAccount(accountId);
  if (!account || account.user_id !== userId) throw new HttpError(404, 'account not found', 'not_found');

  const refresh = await deps.db.getRefreshToken(accountId);
  if (account.status === 'ok') {
    try {
      const token = await deps.tokens.get(accountId);
      for (const c of await deps.db.listCalendars(accountId)) {
        if (c.channel_id && c.channel_resource_id) {
          try { await deps.api.stopChannel(token, { id: c.channel_id, resourceId: c.channel_resource_id }); } catch { /* expires on its own */ }
        }
      }
    } catch (e) {
      if (!(e instanceof NeedsSigninError || e instanceof InvalidGrantError || e instanceof GoogleApiError)) throw e;
    }
  }
  if (refresh) await deps.api.revoke(refresh);
  await deps.db.deleteAccount(accountId);
}
