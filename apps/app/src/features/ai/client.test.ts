import type { CalendarData } from '@calendar/core';

import { AiError, MAX_EVENTS, callAi, mapInvokeError, slimData, toBody, type AiInvoker, type AiRequest } from './client';

const data: CalendarData = {
  events: [
    { id: 'e1', day: '2026-10-30', cat: 'Work', title: 'Standup', start: 570, end: 585, visibility: 'public', source: 'google', isMine: false, seriesId: 's1' },
    { id: 'e2', day: '2026-10-30', cat: 'Health', title: 'Run', start: 420, end: 480, done: true, allDay: false },
  ],
  cats: { Work: 220, Health: 140 },
  goals: [],
};
const base: AiRequest = { mode: 'note', note: 'gym at 7', today: '2026-10-30', nowMin: 600, tz: 'Europe/London', data };

/** The pieces of supabase-js's FunctionsHttpError the client reads: a name and a Response-like context. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  context: { status, json: async () => body, clone() { return this; } },
});
const fetchError = (inner: unknown = new TypeError('Network request failed')) => ({ name: 'FunctionsFetchError', context: inner });

describe('mapInvokeError', () => {
  const usage = { used: 200, limit: 200, resetsOn: '2026-11-01' };

  it('maps the monthly limit with its usage', async () => {
    const e = await mapInvokeError(httpError(429, { error: 'limit', used: 200, limit: 200, resetsOn: '2026-11-01', usage }));
    expect(e).toBeInstanceOf(AiError);
    expect(e.kind).toBe('limit');
    expect(e.usage).toEqual(usage);
    expect(e.status).toBe(429);
  });

  it('maps the per-minute limit with retryAfter (rounded up, default 10)', async () => {
    const a = await mapInvokeError(httpError(429, { error: 'rate_limit', retryAfter: 6.2, usage }));
    expect(a.kind).toBe('rate_limit');
    expect(a.retryAfter).toBe(7);
    const b = await mapInvokeError(httpError(429, { error: 'rate_limit' }));
    expect(b.retryAfter).toBe(10);
  });

  it('maps auth, unusable replies and rejected requests', async () => {
    expect((await mapInvokeError(httpError(401, { error: 'unauthorized' }))).kind).toBe('auth');
    expect((await mapInvokeError(httpError(502, { error: 'bad_reply', usage }))).kind).toBe('bad_reply');
    expect((await mapInvokeError(httpError(413, { error: 'too_large' }))).kind).toBe('bad_request');
    expect((await mapInvokeError(httpError(400, { error: 'bad_note', message: 'note is required' }))).kind).toBe('bad_request');
  });

  it('maps provider trouble (and keeps the refunded usage)', async () => {
    for (const code of ['upstream_unavailable', 'upstream_timeout', 'upstream_auth', 'server_config', 'internal']) {
      const e = await mapInvokeError(httpError(code === 'upstream_timeout' ? 504 : 502, { error: code, usage }));
      expect(e.kind).toBe('provider');
      expect(e.usage).toEqual(usage);
    }
    expect((await mapInvokeError({ name: 'FunctionsRelayError', context: {} })).kind).toBe('provider');
  });

  it('maps a lost connection to offline and an abort to timeout', async () => {
    expect((await mapInvokeError(fetchError())).kind).toBe('offline');
    expect((await mapInvokeError(fetchError({ name: 'AbortError' }))).kind).toBe('timeout');
    expect((await mapInvokeError(new TypeError('Failed to fetch'))).kind).toBe('offline');
  });

  it('keeps an AiError as it is and wraps anything else', async () => {
    const own = new AiError('timeout');
    expect(await mapInvokeError(own)).toBe(own);
    expect((await mapInvokeError(new Error('boom'))).kind).toBe('unknown');
    expect((await mapInvokeError(httpError(500, 'not json'))).kind).toBe('provider');
  });
});

describe('callAi', () => {
  it('returns ops, usage and model from a good reply', async () => {
    const invoke: AiInvoker = jest.fn(async () => ({
      data: { ok: true, mode: 'note', ops: [{ op: 'create', title: 'Gym' }], model: 'claude-haiku-4-5', usage: { used: 38, limit: 200, resetsOn: '2026-11-01' } },
      error: null,
    }));
    const r = await callAi(base, { invoke });
    expect(r.ops).toHaveLength(1);
    expect(r.usage).toEqual({ used: 38, limit: 200, resetsOn: '2026-11-01' });
    expect(r.model).toBe('claude-haiku-4-5');
    expect(invoke).toHaveBeenCalledWith('ai-schedule', expect.objectContaining({ body: expect.objectContaining({ mode: 'note', note: 'gym at 7', tz: 'Europe/London' }) }));
  });

  it('throws the mapped error when the function reports one', async () => {
    const invoke: AiInvoker = async () => ({ data: null, error: httpError(429, { error: 'limit', usage: { used: 200, limit: 200, resetsOn: '2026-11-01' } }) });
    await expect(callAi(base, { invoke })).rejects.toMatchObject({ kind: 'limit', usage: { used: 200 } });
  });

  it('rejects replies without operations', async () => {
    await expect(callAi(base, { invoke: async () => ({ data: { ok: true }, error: null }) })).rejects.toMatchObject({ kind: 'bad_reply' });
    await expect(callAi(base, { invoke: async () => ({ data: 'hello', error: null }) })).rejects.toMatchObject({ kind: 'provider' });
  });

  it('times out, aborting the request', async () => {
    let signal: AbortSignal | undefined;
    const invoke: AiInvoker = (_n, o) => {
      signal = o.signal;
      return new Promise(() => {});
    };
    await expect(callAi(base, { invoke, timeoutMs: 15 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('turns a thrown fetch error into offline', async () => {
    const invoke: AiInvoker = async () => { throw new TypeError('Network request failed'); };
    await expect(callAi(base, { invoke })).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('toBody', () => {
  it('sends a note with the snapshot, and only the keys that apply', () => {
    const b = toBody({ ...base, noAsk: true });
    expect(b).toMatchObject({ mode: 'note', note: 'gym at 7', noAsk: true, today: '2026-10-30', nowMin: 600, tz: 'Europe/London' });
    expect(b).not.toHaveProperty('goalId');
    expect(b).not.toHaveProperty('lastSeen');
    expect(toBody(base)).not.toHaveProperty('noAsk');
  });

  it('adds goalId and adjustMode for goal adjustments', () => {
    const b = toBody({ ...base, mode: 'adjust', goalId: 'g1', adjustMode: 'reduce' });
    expect(b).toMatchObject({ mode: 'adjust', goalId: 'g1', adjustMode: 'reduce' });
  });

  it('sends lastSeen (not a note) for check-ins', () => {
    const b = toBody({ ...base, mode: 'checkin', lastSeen: 123 });
    expect(b.lastSeen).toBe(123);
    expect(b).not.toHaveProperty('note');
  });
});

describe('slimData', () => {
  it('keeps only the fields the function reads', () => {
    const s = slimData(data);
    expect(s.events[0]).toEqual({ id: 'e1', day: '2026-10-30', cat: 'Work', title: 'Standup', start: 570, end: 585 });
    expect(s.events[1]).toEqual({ id: 'e2', day: '2026-10-30', cat: 'Health', title: 'Run', start: 420, end: 480, done: true });
    expect(s.cats).toBe(data.cats);
  });

  it('caps the number of events, newest days first', () => {
    const many = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({
      id: 'x' + i, day: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), cat: 'Work', title: 't', start: 0, end: 15,
    }));
    const s = slimData({ ...data, events: many });
    expect(s.events).toHaveLength(MAX_EVENTS);
  });
});
