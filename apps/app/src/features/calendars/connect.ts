/**
 * Connect Google (CA 2): start the OAuth flow on the `google-connect` function, open it in
 * the system browser session, and read the answer.
 *
 *   native  `expo-web-browser` `openAuthSessionAsync(url, 'aicalendar://google/connected')`
 *           (ASWebAuthenticationSession / Custom Tab). The function redirects there with
 *           `?connected=1&account_id=…` or `?error=…`.
 *   web     a full-page redirect; Google comes back to `<origin>/settings/calendars?…`, which the
 *           Calendars screen reads once (`parseConnectReturn`). Both URLs are on the function's
 *           GOOGLE_RETURN_URLS allow-list (supabase/functions/_shared/google/README.md).
 *
 * The URL handling is pure; `runConnect` takes its I/O as dependencies so it is unit-tested.
 */
import { splitUrl } from '@/lib/deepLinks';

export const NATIVE_RETURN_URL = 'aicalendar://google/connected';
/** Where the web flow lands (any path on the origin is allowed by the function's allow-list). */
export const WEB_RETURN_PATH = '/settings/calendars';

export type ConnectPlatform = 'web' | 'native';

export function returnUrlFor(platform: ConnectPlatform, origin = ''): string {
  return platform === 'web' ? origin.replace(/\/+$/, '') + WEB_RETURN_PATH : NATIVE_RETURN_URL;
}

export type ConnectResult =
  | { kind: 'connected'; accountId: string | null }
  | { kind: 'error'; code: string; message: string }
  /** the browser sheet was closed, or Google said no without an error code */
  | { kind: 'cancelled' };

/** CA 2.6: Google said no, or the sheet was closed. */
export const CANCELLED_MESSAGE = 'Google said no. Nothing was saved.';

/** What the person reads for each error code the callback can send (connect.ts `fail(code)`). */
export function connectErrorMessage(code: string): string {
  switch (code) {
    case 'access_denied':
      return CANCELLED_MESSAGE;
    case 'missing_scope':
      return 'Calendar access wasn’t granted. Allow both calendar permissions and try again.';
    case 'wrong_account':
      return 'That’s a different Google account. Sign in with the one you’re reconnecting.';
    case 'no_refresh_token':
    case 'no_email':
      return 'Google didn’t finish signing in. Try again.';
    case 'offline':
      return 'You’re offline. Connect Google when you’re back online.';
    default:
      return 'Couldn’t connect Google. Try again in a moment.';
  }
}

/**
 * Reads the return URL (`aicalendar://google/connected?connected=1&account_id=…`, the web URL with
 * the same query, or a bare query string). `null` when it carries no answer at all.
 */
export function parseConnectReturn(url: string | null | undefined): ConnectResult | null {
  if (!url) return null;
  const { query, hash } = splitUrl(url);
  const p = { ...hash, ...query };
  if (p.error) {
    return p.error === 'access_denied'
      ? { kind: 'cancelled' }
      : { kind: 'error', code: p.error, message: connectErrorMessage(p.error) };
  }
  if (p.connected === '1' || p.connected === 'true') return { kind: 'connected', accountId: p.account_id || null };
  return null;
}

export interface ConnectDeps {
  platform: ConnectPlatform;
  /** `window.location.origin` on web */
  origin?: string;
  invoke(name: string, body: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  openAuth(url: string, returnUrl: string): Promise<{ type: string; url?: string }>;
  /** web: leave the app for `url` */
  redirect(url: string): void;
}

export type ConnectOutcome = ConnectResult | { kind: 'redirecting' };

/**
 * Start (or `reconnect`, with `accountId`) and open the browser session. Never throws: failures
 * come back as `{ kind: 'error' }`.
 */
export async function runConnect(deps: ConnectDeps, opts: { accountId?: string; loginHint?: string } = {}): Promise<ConnectOutcome> {
  const returnUrl = returnUrlFor(deps.platform, deps.origin);
  const body: Record<string, unknown> = opts.accountId
    ? { action: 'reconnect', account_id: opts.accountId, return_url: returnUrl }
    : { action: 'start', return_url: returnUrl, ...(opts.loginHint ? { login_hint: opts.loginHint } : {}) };
  let url: string | null = null;
  try {
    const { data, error } = await deps.invoke('google-connect', body);
    const u = (data as { url?: unknown } | null)?.url;
    if (!error && typeof u === 'string' && u) url = u;
  } catch {
    url = null;
  }
  if (!url) return { kind: 'error', code: 'start_failed', message: connectErrorMessage('start_failed') };

  if (deps.platform === 'web') {
    deps.redirect(url);
    return { kind: 'redirecting' };
  }
  try {
    const res = await deps.openAuth(url, returnUrl);
    if (res.type !== 'success') return { kind: 'cancelled' };
    return parseConnectReturn(res.url) ?? { kind: 'cancelled' };
  } catch {
    return { kind: 'error', code: 'browser_failed', message: connectErrorMessage('browser_failed') };
  }
}
