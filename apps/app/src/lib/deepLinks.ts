/**
 * Deep links (Design Spec, Deep links (L)). One scheme, `aicalendar://`.
 *
 *   aicalendar://event/{id}        event sheet over the week view
 *   aicalendar://goal/{id}         goal sheet
 *   aicalendar://day/{yyyy-mm-dd}  week view on that day
 *   aicalendar://compose           week view, composer focused
 *   aicalendar://signin            Welcome (the signed-out widget card)
 *   aicalendar://auth/callback     return from Apple / Google sign-in (no screen)
 *   aicalendar://google/connected  return from the Connect Google browser session
 *
 * Pure functions only (no React, no router) so they are unit-tested and so
 * `app/+native-intent.tsx` stays a thin wrapper.
 */

export type DeepLink =
  | { kind: 'event'; id: string }
  | { kind: 'goal'; id: string }
  | { kind: 'day'; date: string }
  | { kind: 'compose' }
  | { kind: 'signin' }
  | { kind: 'auth-callback' }
  | { kind: 'google-connected' }
  | { kind: 'unknown' };

export const APP_SCHEME = 'aicalendar';

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written yyyy-mm-dd (rejects 2026-02-30). */
export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dim = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[mo - 1];
}

/** `a=1&b=2` -> `{a:'1', b:'2'}` (decoded; later keys win). */
export function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, ' '))] = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      // malformed escape: skip the pair
    }
  }
  return out;
}

/** Splits a URL or path into its path segments, query params and fragment params. */
export function splitUrl(input: string): { scheme: string | null; segments: string[]; query: Record<string, string>; hash: Record<string, string> } {
  let rest = input.trim();
  let scheme: string | null = null;
  const sm = SCHEME_RE.exec(rest);
  if (sm) {
    scheme = sm[1].toLowerCase();
    rest = rest.slice(sm[0].length);
  }
  let hash = '';
  const hi = rest.indexOf('#');
  if (hi !== -1) {
    hash = rest.slice(hi + 1);
    rest = rest.slice(0, hi);
  }
  let query = '';
  const qi = rest.indexOf('?');
  if (qi !== -1) {
    query = rest.slice(qi + 1);
    rest = rest.slice(0, qi);
  }
  const segments = rest.split('/').filter(Boolean);
  return { scheme, segments, query: parseParams(query), hash: parseParams(hash) };
}

/** Parse an `aicalendar://` URL (a bare `/event/1` path is accepted too). */
export function parseDeepLink(input: string): DeepLink {
  if (!input) return { kind: 'unknown' };
  const { scheme, segments } = splitUrl(input);
  if (scheme !== null && scheme !== APP_SCHEME) return { kind: 'unknown' };
  const [head, arg] = segments;
  switch (head) {
    case 'event':
      return arg && ID_RE.test(arg) ? { kind: 'event', id: arg } : { kind: 'unknown' };
    case 'goal':
      return arg && ID_RE.test(arg) ? { kind: 'goal', id: arg } : { kind: 'unknown' };
    case 'day':
      return arg && isIsoDate(arg) ? { kind: 'day', date: arg } : { kind: 'unknown' };
    case 'compose':
      return { kind: 'compose' };
    case 'signin':
      return { kind: 'signin' };
    case 'auth':
      return arg === 'callback' ? { kind: 'auth-callback' } : { kind: 'unknown' };
    case 'google':
      return arg === 'connected' ? { kind: 'google-connected' } : { kind: 'unknown' };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * The in-app route a deep link opens.
 *
 * Contract with the calendar screens (`app/(app)/index.tsx`): the week view
 * reads `day` (yyyy-mm-dd) and `compose` (`1`) search params.
 */
export function deepLinkToPath(link: DeepLink): string {
  switch (link.kind) {
    case 'event':
      return `/event/${encodeURIComponent(link.id)}`;
    case 'goal':
      return `/goal/${encodeURIComponent(link.id)}`;
    case 'day':
      return `/?day=${link.date}`;
    case 'compose':
      return '/?compose=1';
    case 'signin':
      return '/welcome';
    case 'google-connected':
      return '/settings/calendars';
    case 'auth-callback':
    case 'unknown':
      return '/';
  }
}

/**
 * `redirectSystemPath` for `app/+native-intent.tsx`: turn an incoming system
 * URL into an app route. Anything that is not one of our links (an ordinary
 * in-app path such as `/settings`) is returned untouched.
 */
export function systemPathToAppPath(path: string): string {
  const { scheme } = splitUrl(path);
  if (scheme === null) return path;
  return deepLinkToPath(parseDeepLink(path));
}

/* ---------- auth callback ---------- */

export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/**
 * Reads what Supabase sends back to `aicalendar://auth/callback` (or to the
 * web origin): `?code=` (PKCE), `#access_token=&refresh_token=` (implicit) or
 * `error` / `error_description` in either place.
 */
export function parseAuthCallback(url: string): AuthCallback {
  const { query, hash } = splitUrl(url);
  const p = { ...hash, ...query };
  if (p.error || p.error_description) {
    return { kind: 'error', message: p.error_description || p.error || 'Sign-in failed' };
  }
  if (p.code) return { kind: 'code', code: p.code };
  if (p.access_token && p.refresh_token) {
    return { kind: 'tokens', accessToken: p.access_token, refreshToken: p.refresh_token };
  }
  return { kind: 'none' };
}
