import { DEFAULT_PREFS, type HistoryEntry } from '@calendar/core';

import { daylightNote, historyRows, regionLabel, sunForRegion, sunWithTime } from './model';

const entry = (id: string, label: string, kind: HistoryEntry['kind'], t: number): HistoryEntry => ({
  id, label, kind, t, before: { events: [], cats: {}, goals: [] }, after: { events: [], cats: {}, goals: [] },
});

describe('history rows', () => {
  it('strips source prefixes, tags them and says how long ago', () => {
    const now = 10_000_000;
    const rows = historyRows([
      entry('a', 'Claude · Added gym', 'claude', now - 5 * 60000),
      entry('b', 'Reverted · Moved · Standup', 'undo', now - 3600000),
      entry('c', 'Deleted · Lunch', 'delete', now - 86400000),
    ], now);
    expect(rows[0]).toMatchObject({ label: 'Added gym', tag: 'Claude', meta: '5 mins ago' });
    expect(rows[1]).toMatchObject({ label: 'Moved · Standup', tag: 'Reverted', meta: '1 hour ago' });
    expect(rows[2]).toMatchObject({ label: 'Deleted · Lunch', tag: '', meta: 'yesterday' });
  });
});

describe('sun settings', () => {
  it('takes a region, or a custom typed time', () => {
    expect(sunForRegion('Tokyo')).toEqual({ region: 'Tokyo', sunrise: 320, sunset: 1070 });
    expect(sunForRegion('Nowhere')).toBeNull();
    const custom = sunWithTime(DEFAULT_PREFS.sun, 'sunrise', '6:30');
    expect(custom).toEqual({ region: 'Custom', sunrise: 390, sunset: 1163 });
    expect(sunWithTime(DEFAULT_PREFS.sun, 'sunset', 'late')).toBeNull();
    expect(regionLabel('Custom')).toBe('Custom');
    expect(regionLabel('London')).toBe('London, UK');
  });

  it('notes the hours of daylight, or a mistake', () => {
    expect(daylightNote(DEFAULT_PREFS.sun)).toBe('Daylight 6:38am – 7:23pm · 12h 45m of light');
    expect(daylightNote({ region: 'Custom', sunrise: 900, sunset: 600 })).toBe('Sunset must come after sunrise.');
  });
});
