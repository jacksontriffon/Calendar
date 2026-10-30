/**
 * OAuth `state` nonces and the return-URL allow-list.
 *
 * The `state` sent to Google is 32 random bytes. Only its SHA-256 is stored (table
 * `google_oauth_states`), bound to the user, the requested return URL and, for "reconnect", the
 * account. It is single use and expires after ten minutes, so the unauthenticated `callback` can trust
 * nothing but a state it issued itself.
 */
import { sha256Hex } from './publish_map.ts';

export const STATE_TTL_SECONDS = 600;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const newState = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

export const hashState = (state: string): Promise<string> => sha256Hex(state);

/** A well-formed `state` value (rejects junk before touching the database). */
export const looksLikeState = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9_-]{43}$/.test(s);

/** `GOOGLE_RETURN_URLS`: comma-separated entries, blanks dropped. */
export const parseReturnUrls = (raw: string | null | undefined): string[] =>
  (raw || '').split(',').map((s) => s.trim()).filter(Boolean);

const parse = (s: string): URL | null => {
  try {
    return new URL(s);
  } catch {
    return null;
  }
};

/**
 * Whether `url` may be redirected to after connecting.
 *  - An `http(s)` entry without a path (`https://www.claude-calendar.com`) allows any URL on that origin.
 *  - An `http(s)` entry with a path allows that path and anything beneath it on the same origin.
 *  - Any other scheme (`aicalendar://google/connected`) must match scheme, host and path exactly
 *    (a query string or fragment is fine).
 * URLs with embedded credentials, and anything not on the list, are refused.
 */
export const isAllowedReturnUrl = (url: string | null | undefined, allow: ReadonlyArray<string>): boolean => {
  if (!url) return false;
  const u = parse(url);
  if (!u || u.username || u.password) return false;
  return allow.some((entry) => {
    const a = parse(entry);
    if (!a || u.protocol !== a.protocol) return false;
    if (a.protocol === 'http:' || a.protocol === 'https:') {
      if (u.origin !== a.origin) return false;
      const base = a.pathname.replace(/\/+$/, '');
      return base === '' || u.pathname === base || u.pathname.startsWith(base + '/');
    }
    return u.host === a.host && u.pathname.replace(/\/+$/, '') === a.pathname.replace(/\/+$/, '');
  });
};

/** `url` with extra query parameters (works for custom schemes too). */
export const withParams = (url: string, params: Record<string, string | undefined>): string => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};
