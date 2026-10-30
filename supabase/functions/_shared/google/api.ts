/**
 * Thin Google OAuth + Calendar API client. `fetch`, the sleep used for backoff and the random source
 * are injectable, so tests run against a fake Google with no network and no waiting.
 *
 * Retries: 429, 5xx, rate-limit style 403s and network failures are retried with exponential
 * backoff (base 500 ms, doubling, jittered, capped at 8 s; `Retry-After` is honoured) at most
 * `maxRetries` times (default 4). The error that finally escapes has `transient = true`, which tells
 * the queue worker to leave the job un-acknowledged so it is retried later.
 */
import type {
  GoogleAclRule, GoogleCalendarListEntry, GoogleChannel, GoogleEvent, GoogleEventsPage, TokenResponse,
} from './types.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CAL_URL = 'https://www.googleapis.com/calendar/v3';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
] as const;
export const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
    /** true when the failure is worth retrying later (rate limit, 5xx, network) */
    public transient = false,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** The refresh token is no longer valid (revoked, expired, password change): the user must sign in again. */
export class InvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'InvalidGrantError';
  }
}

export interface GoogleApiConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  baseDelayMs?: number;
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError']);

interface Req {
  method: string;
  url: string;
  token?: string;
  json?: unknown;
  form?: Record<string, string>;
}

export class GoogleApi {
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private random: () => number;
  private maxRetries: number;
  private baseDelay: number;

  constructor(private cfg: GoogleApiConfig) {
    this.f = cfg.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = cfg.random ?? Math.random;
    this.maxRetries = cfg.maxRetries ?? 4;
    this.baseDelay = cfg.baseDelayMs ?? 500;
  }

  /* ------------------------------------------------------------ transport */

  private async once(r: Req): Promise<{ status: number; body: unknown; retryAfter: number | null }> {
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (r.token) headers.Authorization = 'Bearer ' + r.token;
    if (r.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(r.json);
    } else if (r.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(r.form).toString();
    }
    const res = await this.f(r.url, { method: r.method, headers, body });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const ra = Number(res.headers.get('Retry-After'));
    return { status: res.status, body: parsed, retryAfter: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null };
  }

  private static reasonOf(body: unknown): string | undefined {
    const b = body as { error?: { errors?: Array<{ reason?: string }> } | string } | null;
    if (b && typeof b.error === 'object') return b.error?.errors?.[0]?.reason;
    if (b && typeof b.error === 'string') return b.error;
    return undefined;
  }

  private static messageOf(body: unknown, status: number): string {
    const b = body as { error?: { message?: string } | string; error_description?: string } | string | null;
    if (typeof b === 'string') return b.slice(0, 200);
    if (b && typeof b.error === 'object' && b.error?.message) return b.error.message;
    if (b && typeof b.error === 'string') return b.error + (b.error_description ? ': ' + b.error_description : '');
    return 'Google API error ' + status;
  }

  /** One request with retry/backoff. Resolves for 2xx and for statuses in `okStatuses`; throws otherwise. */
  async request(r: Req, okStatuses: number[] = []): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      let res: { status: number; body: unknown; retryAfter: number | null } | null = null;
      let netErr: unknown;
      try {
        res = await this.once(r);
      } catch (e) {
        netErr = e;
      }

      if (res && ((res.status >= 200 && res.status < 300) || okStatuses.includes(res.status))) return res;

      const reason = res ? GoogleApi.reasonOf(res.body) : undefined;
      const retryable = !res || res.status === 429 || res.status >= 500 || (res.status === 403 && !!reason && RATE_REASONS.has(reason));
      if (retryable && attempt < this.maxRetries) {
        const backoff = Math.min(8000, this.baseDelay * 2 ** attempt) * (0.5 + this.random() / 2);
        await this.sleep(Math.max(backoff, res?.retryAfter ?? 0));
        continue;
      }
      if (!res) throw new GoogleApiError(0, 'network error: ' + (netErr instanceof Error ? netErr.message : String(netErr)), 'network', true);
      throw new GoogleApiError(res.status, GoogleApi.messageOf(res.body, res.status), reason, retryable);
    }
  }

  /* ---------------------------------------------------------------- OAuth */

  authUrl(o: { state: string; loginHint?: string }): string {
    const p = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: o.state,
    });
    if (o.loginHint) p.set('login_hint', o.loginHint);
    return AUTH_URL + '?' + p.toString();
  }

  async exchangeCode(code: string): Promise<TokenResponse> {
    const res = await this.request({
      method: 'POST', url: TOKEN_URL,
      form: {
        code, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
        redirect_uri: this.cfg.redirectUri, grant_type: 'authorization_code',
      },
    });
    return res.body as TokenResponse;
  }

  /** New access token for a refresh token. Throws {@link InvalidGrantError} when Google says invalid_grant. */
  async refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
    try {
      const res = await this.request({
        method: 'POST', url: TOKEN_URL,
        form: {
          refresh_token: refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'refresh_token',
        },
      });
      const b = res.body as { access_token: string; expires_in?: number };
      return { access_token: b.access_token, expires_in: b.expires_in ?? 3600 };
    } catch (e) {
      if (e instanceof GoogleApiError && (e.reason === 'invalid_grant' || (e.status === 400 && /invalid_grant/.test(e.message)))) {
        throw new InvalidGrantError(e.message);
      }
      throw e;
    }
  }

  /** Best effort: revoking an already-revoked token is not an error worth surfacing. */
  async revoke(token: string): Promise<boolean> {
    try {
      await this.request({ method: 'POST', url: REVOKE_URL, form: { token } }, [400]);
      return true;
    } catch {
      return false;
    }
  }

  async userinfo(accessToken: string): Promise<{ email?: string; email_verified?: boolean }> {
    const res = await this.request({ method: 'GET', url: USERINFO_URL, token: accessToken });
    return res.body as { email?: string; email_verified?: boolean };
  }

  /* -------------------------------------------------------------- calendars */

  async listCalendarList(token: string): Promise<GoogleCalendarListEntry[]> {
    const out: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '250', showHidden: 'true' });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await this.request({ method: 'GET', url: `${CAL_URL}/users/me/calendarList?${q}`, token });
      const b = res.body as { items?: GoogleCalendarListEntry[]; nextPageToken?: string };
      out.push(...(b.items ?? []));
      pageToken = b.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** ACL rules, or null when the account may not read them. */
  async listAcl(token: string, calendarId: string): Promise<GoogleAclRule[] | null> {
    try {
      const res = await this.request({ method: 'GET', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/acl?maxResults=250`, token });
      return (res.body as { items?: GoogleAclRule[] }).items ?? [];
    } catch (e) {
      if (e instanceof GoogleApiError && !e.transient) return null;
      throw e;
    }
  }

  /* ----------------------------------------------------------------- events */

  /**
   * One page of events. With `syncToken` this is an incremental sync; otherwise a bounded window
   * (`timeMin`/`timeMax`, RFC 3339). Throws GoogleApiError(410) when the sync token expired.
   */
  async listEvents(
    token: string, calendarId: string,
    o: { syncToken?: string | null; timeMin?: string; timeMax?: string; pageToken?: string },
  ): Promise<GoogleEventsPage> {
    const q = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' });
    if (o.syncToken) q.set('syncToken', o.syncToken);
    else {
      if (o.timeMin) q.set('timeMin', o.timeMin);
      if (o.timeMax) q.set('timeMax', o.timeMax);
    }
    if (o.pageToken) q.set('pageToken', o.pageToken);
    const res = await this.request({ method: 'GET', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events?${q}`, token });
    return res.body as GoogleEventsPage;
  }

  /** Creates an event. Pass `id` to choose it; a 409 (it already exists) is reported as `{ conflict: true }`. */
  async insertEvent(token: string, calendarId: string, body: object & { id?: string }): Promise<{ event: GoogleEvent | null; conflict: boolean }> {
    const res = await this.request({ method: 'POST', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events`, token, json: body }, [409]);
    return res.status === 409 ? { event: null, conflict: true } : { event: res.body as GoogleEvent, conflict: false };
  }

  /** Patches an event; null when it no longer exists (404) or was deleted (410). */
  async patchEvent(token: string, calendarId: string, eventId: string, body: object): Promise<{ event: GoogleEvent | null; gone: 404 | 410 | null }> {
    const res = await this.request({
      method: 'PATCH', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token, json: body,
    }, [404, 410]);
    return res.status === 404 || res.status === 410 ? { event: null, gone: res.status } : { event: res.body as GoogleEvent, gone: null };
  }

  /** Deletes an event; an event that is already gone (404/410) counts as deleted. */
  async deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
    await this.request({
      method: 'DELETE', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token,
    }, [404, 410]);
  }

  /* --------------------------------------------------------------- channels */

  async watchEvents(token: string, calendarId: string, body: { id: string; address: string; token: string; expiration?: number }): Promise<GoogleChannel> {
    const res = await this.request({
      method: 'POST', url: `${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/watch`, token,
      json: { ...body, type: 'web_hook' },
    });
    return res.body as GoogleChannel;
  }

  /** Stops a channel; one that has already expired (404) is fine. */
  async stopChannel(token: string, ch: { id: string; resourceId: string }): Promise<void> {
    await this.request({ method: 'POST', url: `${CAL_URL}/channels/stop`, token, json: ch }, [404]);
  }
}
