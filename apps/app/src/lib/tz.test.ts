import { cityName, detectTimeZone, gmtOffsetLabel, isValidTimeZone, listTimeZones, offsetMinutes } from './tz';
import { collectRoutePaths, hasRoute, normalizeRoutePath } from './useRouteExists';

describe('time zones', () => {
  it('detects a valid zone', () => {
    expect(isValidTimeZone(detectTimeZone())).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('names the city', () => {
    expect(cityName('America/Los_Angeles')).toBe('Los Angeles');
    expect(cityName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(cityName('UTC')).toBe('UTC');
  });

  it('formats offsets at a fixed date', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    expect(offsetMinutes('America/Los_Angeles', winter)).toBe(-480);
    expect(gmtOffsetLabel('America/Los_Angeles', summer)).toBe('GMT−7');
    expect(gmtOffsetLabel('Asia/Kolkata', winter)).toBe('GMT+5:30');
    expect(gmtOffsetLabel('UTC', winter)).toBe('GMT');
  });

  it('always lists the current zone', () => {
    expect(listTimeZones('Pacific/Chatham')).toContain('Pacific/Chatham');
    expect(listTimeZones().length).toBeGreaterThan(20);
  });
});

describe('route lookup', () => {
  it('normalises groups and index', () => {
    expect(normalizeRoutePath('/(app)/settings/index')).toBe('/settings');
    expect(normalizeRoutePath('/settings/calendars/phone')).toBe('/settings/calendars/phone');
    expect(normalizeRoutePath('/(app)')).toBe('/');
  });

  it('finds routes in a sitemap tree', () => {
    type N = Parameters<typeof collectRoutePaths>[0];
    const node = (href: string, children: N[] = [], isInternal = false): NonNullable<N> => ({
      contextKey: href,
      filename: href,
      href,
      isInternal,
      isGenerated: false,
      children: children as NonNullable<N>[],
    });
    const tree = node('/', [node('/settings', [node('/settings/account')]), node('/_sitemap', [], true)]);
    const paths = collectRoutePaths(tree);
    expect(hasRoute(paths, '/settings/account')).toBe(true);
    expect(hasRoute(paths, '/settings/calendars/phone')).toBe(false);
    expect(hasRoute(paths, '/_sitemap')).toBe(false);
  });
});
