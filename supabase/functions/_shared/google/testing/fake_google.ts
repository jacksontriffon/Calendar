/**
 * A fake Google (OAuth + Calendar API) behind a `fetch` function, for tests. It keeps per-calendar
 * event stores with a change log, so incremental sync (`syncToken`), cancellations, paging, 410 Gone
 * and JSON-merge-patch behaviour are exercised without any network.
 */
import type {
  GoogleAclRule, GoogleCalendarListEntry, GoogleChannel, GoogleEvent, TokenResponse,
} from '../types.ts';

export interface Call {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  body: any; // deno-lint-ignore no-explicit-any
}

interface FakeCal {
  events: Map<string, GoogleEvent>;
  log: Array<{ version: number; event: GoogleEvent }>;
  version: number;
  deleted: Set<string>;
}

interface Failure {
  match: (c: Call) => boolean;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  times: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// deno-lint-ignore no-explicit-any
const mergePatch = (target: any, patch: any): any => {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
};

export class FakeGoogle {
  calls: Call[] = [];
  calendars = new Map<string, FakeCal>();
  calendarList: GoogleCalendarListEntry[] = [];
  acl = new Map<string, GoogleAclRule[]>();
  aclStatus = 200;
  revokedRefresh = new Set<string>();
  revoked: string[] = [];
  channelsStopped: Array<{ id: string; resourceId: string }> = [];
  channelsCreated: Array<{ calendar: string; id: string; token: string; address: string }> = [];
  code: TokenResponse = { access_token: 'at-code', expires_in: 3600, refresh_token: 'rt-new', scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly' };
  userinfo: { email?: string; email_verified?: boolean } = { email: 'sam@example.test', email_verified: true };
  pageSize = 250;
  expireSyncTokens = false;
  failures: Failure[] = [];
  /** Retry-After etc. are not modelled; `etagSeq` makes etags unique */
  private etagSeq = 0;
  private channelSeq = 0;

  /* ---- fixtures ---- */
  private cal(id: string): FakeCal {
    let c = this.calendars.get(id);
    if (!c) {
      c = { events: new Map(), log: [], version: 0, deleted: new Set() };
      this.calendars.set(id, c);
    }
    return c;
  }
  /** Create or replace an event as someone else would on Google. */
  setEvent(calId: string, ev: GoogleEvent): GoogleEvent {
    const c = this.cal(calId);
    const stored: GoogleEvent = { status: 'confirmed', creator: { email: 'someone@example.test' }, organizer: { email: 'someone@example.test' }, ...ev, etag: `"${++this.etagSeq}"` };
    c.events.set(ev.id, stored);
    c.deleted.delete(ev.id);
    c.log.push({ version: ++c.version, event: stored });
    return stored;
  }
  cancel(calId: string, id: string): void {
    const c = this.cal(calId);
    const prev = c.events.get(id);
    const stored: GoogleEvent = { id, status: 'cancelled', etag: `"${++this.etagSeq}"`, ...(prev ? { recurringEventId: prev.recurringEventId } : {}) };
    c.events.set(id, stored);
    c.deleted.add(id);
    c.log.push({ version: ++c.version, event: stored });
  }
  /** Live (not cancelled) events of a calendar. */
  live(calId: string): GoogleEvent[] {
    return [...this.cal(calId).events.values()].filter((e) => e.status !== 'cancelled');
  }
  failNext(match: (c: Call) => boolean, status: number, times = 1, body?: unknown, headers?: Record<string, string>): void {
    this.failures.push({ match, status, body, times, headers });
  }
  writes(): Call[] {
    return this.calls.filter((c) => c.path.includes('/calendar/v3/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method) && !c.path.endsWith('/events/watch') && !c.path.endsWith('/channels/stop'));
  }

  /* ---- fetch ---- */
  fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    let body: any = undefined; // deno-lint-ignore no-explicit-any
    if (raw !== undefined) {
      body = headers.get('Content-Type')?.includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    }
    const call: Call = { method: (init?.method ?? 'GET').toUpperCase(), url: url.href, path: url.host + url.pathname, query: url.searchParams, auth: headers.get('Authorization'), body };
    this.calls.push(call);

    const f = this.failures.find((x) => x.times > 0 && x.match(call));
    if (f) {
      f.times--;
      return Promise.resolve(json(f.status, f.body ?? { error: { code: f.status, message: 'injected failure' } }, f.headers));
    }
    return Promise.resolve(this.route(call, url));
  };

  private route(call: Call, url: URL): Response {
    const { method, body } = call;
    const p = url.pathname;

    if (url.host === 'oauth2.googleapis.com') {
      if (p === '/token') {
        if (body.grant_type === 'authorization_code') return body.code === 'bad-code' ? json(400, { error: 'invalid_grant' }) : json(200, this.code);
        if (this.revokedRefresh.has(body.refresh_token)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return json(200, { access_token: 'at-' + body.refresh_token, expires_in: 3600, token_type: 'Bearer' });
      }
      if (p === '/revoke') {
        this.revoked.push(body.token);
        return json(200, {});
      }
    }
    if (url.host === 'openidconnect.googleapis.com' && p === '/v1/userinfo') return json(200, this.userinfo);

    const m = /^\/calendar\/v3(\/.*)$/.exec(p);
    if (!m) return json(404, { error: { code: 404, message: 'no such route ' + p } });
    const rest = m[1];

    if (rest === '/users/me/calendarList') return json(200, { items: this.calendarList });
    if (rest === '/channels/stop') {
      this.channelsStopped.push(body);
      return json(204 === 204 ? 200 : 200, {});
    }
    let mm = /^\/calendars\/([^/]+)\/acl$/.exec(rest);
    if (mm) {
      if (this.aclStatus !== 200) return json(this.aclStatus, { error: { code: this.aclStatus, message: 'forbidden' } });
      return json(200, { items: this.acl.get(decodeURIComponent(mm[1])) ?? [] });
    }
    mm = /^\/calendars\/([^/]+)\/events\/watch$/.exec(rest);
    if (mm && method === 'POST') {
      const cal = decodeURIComponent(mm[1]);
      this.channelsCreated.push({ calendar: cal, id: body.id, token: body.token, address: body.address });
      const ch: GoogleChannel = { id: body.id, resourceId: 'res-' + ++this.channelSeq, expiration: String(Date.now() + 7 * 86400000) };
      return json(200, ch);
    }
    mm = /^\/calendars\/([^/]+)\/events$/.exec(rest);
    if (mm) {
      const cal = decodeURIComponent(mm[1]);
      return method === 'GET' ? this.list(cal, url) : this.insert(cal, body);
    }
    mm = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(rest);
    if (mm) {
      const cal = decodeURIComponent(mm[1]);
      const id = decodeURIComponent(mm[2]);
      return method === 'PATCH' ? this.patch(cal, id, body) : this.remove(cal, id);
    }
    return json(404, { error: { code: 404, message: 'no such route ' + rest } });
  }

  private list(calId: string, url: URL): Response {
    const c = this.cal(calId);
    const token = url.searchParams.get('syncToken');
    let items: GoogleEvent[];
    if (token) {
      if (this.expireSyncTokens) return json(410, { error: { code: 410, message: 'Sync token is no longer valid, a full sync is required.', errors: [{ reason: 'fullSyncRequired' }] } });
      const since = Number(token.replace('tok-', ''));
      const latest = new Map<string, GoogleEvent>();
      for (const l of c.log) if (l.version > since) latest.set(l.event.id, l.event);
      items = [...latest.values()];
    } else {
      const min = Date.parse(url.searchParams.get('timeMin') ?? '') || -Infinity;
      const max = Date.parse(url.searchParams.get('timeMax') ?? '') || Infinity;
      items = [...c.events.values()].filter((e) => {
        if (e.status === 'cancelled') return false;
        const s = Date.parse(e.start?.dateTime ?? e.start?.date ?? '');
        return !(s < min || s > max);
      });
    }
    const from = Number(url.searchParams.get('pageToken') ?? 0);
    const page = items.slice(from, from + this.pageSize);
    const out: Record<string, unknown> = { items: page };
    if (from + this.pageSize < items.length) out.nextPageToken = String(from + this.pageSize);
    else out.nextSyncToken = 'tok-' + c.version;
    return json(200, out);
  }

  private insert(calId: string, body: GoogleEvent): Response {
    const c = this.cal(calId);
    if (!body.id) body = { ...body, id: 'auto' + ++this.etagSeq };
    if (c.events.has(body.id)) return json(409, { error: { code: 409, message: 'The requested identifier already exists.' } });
    return json(200, this.setEvent(calId, { creator: { email: 'sam@example.test' }, organizer: { email: 'sam@example.test' }, ...body }));
  }

  private patch(calId: string, id: string, patch: object): Response {
    const c = this.cal(calId);
    if (c.deleted.has(id)) return json(410, { error: { code: 410, message: 'Resource has been deleted' } });
    const cur = c.events.get(id);
    if (!cur) return json(404, { error: { code: 404, message: 'Not Found' } });
    return json(200, this.setEvent(calId, mergePatch(cur, patch)));
  }

  private remove(calId: string, id: string): Response {
    const c = this.cal(calId);
    if (c.deleted.has(id)) return json(410, { error: { code: 410, message: 'Resource has been deleted' } });
    if (!c.events.has(id)) return json(404, { error: { code: 404, message: 'Not Found' } });
    this.cancel(calId, id);
    return new Response(null, { status: 204 });
  }
}
