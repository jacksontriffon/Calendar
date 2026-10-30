import {
  currentUsage, describeUsage, formatResetDate, formatUsage, isLimitReached, modelLabel, nextReset, parseUsage, recordUsage, resetUsage,
  getUsageState, usagePercent,
} from './usage';

const u = (used: number, limit = 200, resetsOn = '2026-11-01') => ({ used, limit, resetsOn });

describe('usage formatting', () => {
  it('formats "of LIMIT · resets <date>" the way the spec shows it', () => {
    expect(formatUsage(u(38))).toBe('of 200 · resets Nov 1');
    expect(formatResetDate('2026-12-01')).toBe('Dec 1');
    expect(formatResetDate('2027-01-01')).toBe('Jan 1');
  });

  it('computes the bar and the limit state', () => {
    expect(usagePercent(u(38))).toBe(19);
    expect(usagePercent(u(250))).toBe(100);
    expect(isLimitReached(u(199))).toBe(false);
    expect(isLimitReached(u(200))).toBe(true);
    expect(isLimitReached(null)).toBe(false);
  });

  it('finds the first of next month', () => {
    expect(nextReset('2026-10-30')).toBe('2026-11-01');
    expect(nextReset('2026-12-15')).toBe('2027-01-01');
  });

  it('parses the server usage and rejects junk', () => {
    expect(parseUsage({ used: 3.2, limit: 200, resetsOn: '2026-11-01' })).toEqual(u(3));
    expect(parseUsage({ used: 'x', limit: 200, resetsOn: '2026-11-01' })).toBeNull();
    expect(parseUsage({ used: 1, limit: 0, resetsOn: '2026-11-01' })).toBeNull();
    expect(parseUsage({ used: 1, limit: 200, resetsOn: 'Nov 1' })).toBeNull();
    expect(parseUsage(null)).toBeNull();
  });

  it('counts a stored usage from a past month as unused', () => {
    expect(currentUsage(u(200), '2026-10-30')).toEqual(u(200));
    expect(currentUsage(u(200), '2026-11-01')).toEqual(u(0, 200, '2026-12-01'));
    expect(currentUsage(null, '2026-11-01')).toBeNull();
  });

  it('turns model ids into labels', () => {
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-sonnet-4-5')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-opus-5-1')).toBe('Opus 5.1');
    expect(modelLabel('something-else')).toBe('something-else');
    expect(modelLabel(null)).toBe('Haiku 4.5');
  });
});

describe('describeUsage', () => {
  it('shows the connected state with the count', () => {
    const v = describeUsage({ on: true, online: true, usage: u(38), model: 'claude-haiku-4-5' });
    expect(v).toMatchObject({ status: 'ok', count: '38', detail: 'of 200 · resets Nov 1', percent: 19 });
    expect(v.headline).toBe('Connected · Haiku 4.5. Included with your account.');
  });

  it('shows the limit-reached state (OA 6.6)', () => {
    const v = describeUsage({ on: true, online: true, usage: u(200), model: 'claude-haiku-4-5' });
    expect(v.status).toBe('limit');
    expect(v.headline).toBe('Monthly notes used · using the on-device parser until Nov 1.');
    expect(v.note).toContain('The on-device parser takes over until Nov 1.');
    expect(v.percent).toBe(100);
  });

  it('shows the offline state without a count (OA 6.5)', () => {
    const v = describeUsage({ on: true, online: false, usage: u(38), model: null });
    expect(v).toMatchObject({ status: 'offline', count: '—', detail: 'Updates when you’re online', percent: null });
    expect(v.headline).toContain('Haiku 4.5 takes over when you’re back online.');
  });

  it('shows the off state (OA 6.3/6.4)', () => {
    const v = describeUsage({ on: false, online: true, usage: u(38), model: null });
    expect(v.status).toBe('off');
    expect(v.headline).toBe('Off — the built-in offline parser handles everything.');
    expect(v.note).toBe('Not counting while Claude parsing is off.');
  });

  it('copes with no usage yet', () => {
    const v = describeUsage({ on: true, online: true, usage: null, model: null });
    expect(v).toMatchObject({ status: 'ok', count: '—', detail: '', percent: null });
  });
});

describe('the persisted latest value', () => {
  beforeEach(() => resetUsage());

  it('keeps the latest usage and model, merging partial updates', () => {
    recordUsage(u(5), 'claude-haiku-4-5');
    recordUsage(u(6));
    expect(getUsageState()).toMatchObject({ usage: u(6), model: 'claude-haiku-4-5' });
    recordUsage(undefined, 'claude-sonnet-4-5');
    expect(getUsageState()).toMatchObject({ usage: u(6), model: 'claude-sonnet-4-5' });
    recordUsage(null);
    expect(getUsageState().usage).toEqual(u(6));
  });
});
