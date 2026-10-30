import {
  deepLinkToPath,
  isIsoDate,
  parseAuthCallback,
  parseDeepLink,
  parseParams,
  systemPathToAppPath,
} from './deepLinks';

describe('parseDeepLink', () => {
  it('reads every link in the spec table', () => {
    expect(parseDeepLink('aicalendar://event/e3')).toEqual({ kind: 'event', id: 'e3' });
    expect(parseDeepLink('aicalendar://event/0b6f1c2e-1111-4222-8333-944455556666')).toEqual({
      kind: 'event',
      id: '0b6f1c2e-1111-4222-8333-944455556666',
    });
    expect(parseDeepLink('aicalendar://goal/g2')).toEqual({ kind: 'goal', id: 'g2' });
    expect(parseDeepLink('aicalendar://day/2026-10-30')).toEqual({ kind: 'day', date: '2026-10-30' });
    expect(parseDeepLink('aicalendar://compose')).toEqual({ kind: 'compose' });
    expect(parseDeepLink('aicalendar://signin')).toEqual({ kind: 'signin' });
    expect(parseDeepLink('aicalendar://auth/callback?code=abc')).toEqual({ kind: 'auth-callback' });
    expect(parseDeepLink('aicalendar://google/connected')).toEqual({ kind: 'google-connected' });
  });

  it('tolerates triple slashes, trailing slashes, queries and bare paths', () => {
    expect(parseDeepLink('aicalendar:///event/e3')).toEqual({ kind: 'event', id: 'e3' });
    expect(parseDeepLink('aicalendar://compose/')).toEqual({ kind: 'compose' });
    expect(parseDeepLink('aicalendar://goal/g2?x=1#y')).toEqual({ kind: 'goal', id: 'g2' });
    expect(parseDeepLink('/event/e3')).toEqual({ kind: 'event', id: 'e3' });
    expect(parseDeepLink('AICALENDAR://signin')).toEqual({ kind: 'signin' });
  });

  it('rejects other schemes, bad ids and impossible dates', () => {
    expect(parseDeepLink('https://example.com/event/e3')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://event')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://event/../../etc')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://event/a b')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://day/2026-02-30')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://day/30-10-2026')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://auth/other')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('aicalendar://nope')).toEqual({ kind: 'unknown' });
    expect(parseDeepLink('')).toEqual({ kind: 'unknown' });
  });
});

describe('isIsoDate', () => {
  it('checks real calendar dates', () => {
    expect(isIsoDate('2026-10-30')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
  });
});

describe('systemPathToAppPath', () => {
  it('maps links to routes', () => {
    expect(systemPathToAppPath('aicalendar://event/e3')).toBe('/event/e3');
    expect(systemPathToAppPath('aicalendar://goal/g2')).toBe('/goal/g2');
    expect(systemPathToAppPath('aicalendar://day/2026-10-30')).toBe('/?day=2026-10-30');
    expect(systemPathToAppPath('aicalendar://compose')).toBe('/?compose=1');
    expect(systemPathToAppPath('aicalendar://signin')).toBe('/welcome');
    expect(systemPathToAppPath('aicalendar://google/connected')).toBe('/settings/calendars');
    expect(systemPathToAppPath('aicalendar://auth/callback?code=x')).toBe('/');
  });

  it('sends unknown links to the calendar and leaves in-app paths alone', () => {
    expect(systemPathToAppPath('aicalendar://wat')).toBe('/');
    expect(systemPathToAppPath('/settings/account')).toBe('/settings/account');
  });

  it('deepLinkToPath encodes ids', () => {
    expect(deepLinkToPath({ kind: 'event', id: 'a-b_c' })).toBe('/event/a-b_c');
  });
});

describe('parseAuthCallback', () => {
  it('reads a PKCE code', () => {
    expect(parseAuthCallback('aicalendar://auth/callback?code=abc123')).toEqual({ kind: 'code', code: 'abc123' });
    expect(parseAuthCallback('https://calendar.test/?code=x%2By&state=1')).toEqual({ kind: 'code', code: 'x+y' });
  });

  it('reads implicit tokens from the fragment', () => {
    expect(parseAuthCallback('aicalendar://auth/callback#access_token=a&refresh_token=r&type=bearer')).toEqual({
      kind: 'tokens',
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it('reports errors from either place, before anything else', () => {
    expect(parseAuthCallback('aicalendar://auth/callback?error=access_denied&error_description=User+cancelled')).toEqual({
      kind: 'error',
      message: 'User cancelled',
    });
    expect(parseAuthCallback('aicalendar://auth/callback#error=server_error')).toEqual({ kind: 'error', message: 'server_error' });
  });

  it('returns none when there is nothing', () => {
    expect(parseAuthCallback('aicalendar://auth/callback')).toEqual({ kind: 'none' });
  });
});

describe('parseParams', () => {
  it('decodes, skips malformed pairs and handles bare keys', () => {
    expect(parseParams('a=1&b=%20x&c&d=%E0%A4%A')).toEqual({ a: '1', b: ' x', c: '' });
    expect(parseParams('')).toEqual({});
  });
});
