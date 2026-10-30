import { describe, expect, it } from 'vitest';
import {
  addDays, ago, clamp, dnum, dur, endOfPeriod, fmt, fmtDur, fmtShort, hm, hrs, key, minsIn, niceDate, pad, parseHM, periodDays, snap, snapTo,
  startOfPeriod, stepFor, weekKey, weekNum, zNear, ZLEVELS,
} from '../src/index.ts';

const d = (s: string) => dnum(s);

describe('pad / key / addDays', () => {
  it('pads to two digits', () => {
    expect(pad(0)).toBe('00');
    expect(pad(9)).toBe('09');
    expect(pad(10)).toBe('10');
  });
  it('formats local dates as YYYY-MM-DD', () => {
    expect(key(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(key(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
  it('crosses month and year boundaries', () => {
    expect(key(addDays(d('2026-12-31'), 1))).toBe('2027-01-01');
    expect(key(addDays(d('2027-01-01'), -1))).toBe('2026-12-31');
    expect(key(addDays(d('2026-01-31'), 1))).toBe('2026-02-01');
    expect(key(addDays(d('2026-03-01'), -1))).toBe('2026-02-28');
  });
  it('knows leap years', () => {
    expect(key(addDays(d('2024-02-28'), 1))).toBe('2024-02-29');
    expect(key(addDays(d('2024-02-28'), 2))).toBe('2024-03-01');
    expect(key(addDays(d('2026-02-28'), 1))).toBe('2026-03-01');
    expect(key(addDays(d('2026-10-30'), 365))).toBe('2027-10-30');
  });
  it('truncates the time of day', () => {
    const x = addDays(new Date(2026, 5, 1, 17, 45), 0);
    expect([x.getHours(), x.getMinutes()]).toEqual([0, 0]);
  });
  it('dnum parses keys as local midnight and tolerates slashes', () => {
    const x = dnum('2026-10-30');
    expect([x.getFullYear(), x.getMonth(), x.getDate(), x.getHours()]).toEqual([2026, 9, 30, 0]);
    expect(+dnum('2026/10/30')).toBe(+x);
    expect(Number.isNaN(+dnum('nonsense'))).toBe(true);
  });
  it('minsIn measures from local midnight of a day', () => {
    expect(minsIn('2026-10-30', new Date(2026, 9, 30, 14, 20).getTime())).toBe(860);
    expect(minsIn('2026-10-29', new Date(2026, 9, 30, 0, 30).getTime())).toBe(1470);
  });
});

describe('time formatting', () => {
  it('fmt: 0, noon, last minute', () => {
    expect(fmt(0)).toBe('12am');
    expect(fmt(720)).toBe('12pm');
    expect(fmt(1439)).toBe('11:59pm');
  });
  it('fmt: wraps and handles minutes', () => {
    expect(fmt(60)).toBe('1am');
    expect(fmt(545)).toBe('9:05am');
    expect(fmt(1440)).toBe('12am');
    expect(fmt(1500)).toBe('1am');
    expect(fmt(-1)).toBe('11:59pm');
    expect(fmt(780)).toBe('1pm');
  });
  it('fmtShort drops am/pm', () => {
    expect(fmtShort(0)).toBe('12');
    expect(fmtShort(1439)).toBe('11:59');
    expect(fmtShort(795)).toBe('1:15');
  });
  it('hm is 24h and wraps', () => {
    expect(hm(0)).toBe('00:00');
    expect(hm(1439)).toBe('23:59');
    expect(hm(1500)).toBe('01:00');
    expect(hm(-60)).toBe('23:00');
  });
  it('fmtDur', () => {
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(125)).toBe('2h 5m');
    expect(fmtDur(0)).toBe('0m');
  });
});

describe('parseHM', () => {
  const cases: Array<[string, number | null]> = [
    ['9', 540], ['9:30', 570], ['9.30', 570], ['930', 570], ['9pm', 1260], ['9 30 am', 570], ['12am', 0], ['12pm', 720],
    ['1pm', 780], ['12:15am', 15], [' 5 pm ', 1020], ['23:59', 1439], ['00:00', 0],
    ['24:00', null], ['7:60', null], ['abc', null], ['', null], ['9:5', null],
  ];
  cases.forEach(([s, want]) => it(JSON.stringify(s) + ' -> ' + want, () => expect(parseHM(s)).toBe(want)));
  it('round-trips fmt', () => {
    for (let m = 0; m < 1440; m += 17) expect(parseHM(fmt(m))).toBe(m);
  });
});

describe('rounding helpers', () => {
  it('snap to 15, snapTo step, clamp', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(22)).toBe(15);
    expect(snap(23)).toBe(30);
    expect(snapTo(12, 10)).toBe(10);
    expect(snapTo(15, 10)).toBe(20);
    expect(snapTo(2, 5)).toBe(0);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
  it('zoom levels', () => {
    expect(zNear(1.2)).toBe(1);
    expect(zNear(1.4)).toBe(1.7);
    expect(zNear(100)).toBe(5.2);
    expect(stepFor(5.2)).toBe(5);
    expect(stepFor(3)).toBe(10);
    expect(stepFor(1)).toBe(15);
    expect(stepFor(0.4)).toBe(15);
    expect(stepFor(undefined)).toBe(15);
    expect(ZLEVELS.length).toBe(6);
  });
});

describe('weeks and periods', () => {
  it('weeks start on Monday', () => {
    expect(weekKey(d('2026-10-30'))).toBe('2026-10-26'); // Friday
    expect(weekKey(d('2026-10-26'))).toBe('2026-10-26'); // Monday
    expect(weekKey(d('2026-11-01'))).toBe('2026-10-26'); // Sunday
    expect(weekKey(d('2027-01-01'))).toBe('2026-12-28'); // across the year
  });
  it('ISO week numbers', () => {
    expect(weekNum('2026-01-01')).toBe(1);
    expect(weekNum('2026-10-30')).toBe(44);
    expect(weekNum('2026-12-31')).toBe(53);
    expect(weekNum('2027-01-01')).toBe(53);
    expect(weekNum('2024-12-30')).toBe(1);
  });
  it('start/end/length of every scope', () => {
    const x = d('2026-11-18');
    expect(key(startOfPeriod('day', x))).toBe('2026-11-18');
    expect(key(startOfPeriod('week', x))).toBe('2026-11-16');
    expect(key(startOfPeriod('month', x))).toBe('2026-11-01');
    expect(key(startOfPeriod('quarter', x))).toBe('2026-10-01');
    expect(key(startOfPeriod('year', x))).toBe('2026-01-01');
    expect(periodDays('day', startOfPeriod('day', x))).toBe(1);
    expect(periodDays('week', startOfPeriod('week', x))).toBe(7);
    expect(periodDays('month', startOfPeriod('month', x))).toBe(30);
    expect(periodDays('quarter', startOfPeriod('quarter', x))).toBe(92);
    expect(periodDays('year', startOfPeriod('year', x))).toBe(365);
    expect(periodDays('year', d('2028-01-01'))).toBe(366);
    expect(periodDays('month', d('2028-02-01'))).toBe(29);
    expect(key(endOfPeriod('month', d('2026-12-01')))).toBe('2027-01-01');
    expect(key(endOfPeriod('whatever', d('2026-12-28')))).toBe('2027-01-04');
  });
});

describe('niceDate', () => {
  it('ordinal suffixes', () => {
    expect(niceDate('2026-10-01')).toBe('1st Oct');
    expect(niceDate('2026-10-02')).toBe('2nd Oct');
    expect(niceDate('2026-10-03')).toBe('3rd Oct');
    expect(niceDate('2026-10-04')).toBe('4th Oct');
    expect(niceDate('2026-10-11')).toBe('11th Oct');
    expect(niceDate('2026-10-12')).toBe('12th Oct');
    expect(niceDate('2026-10-13')).toBe('13th Oct');
    expect(niceDate('2026-10-21')).toBe('21st Oct');
    expect(niceDate('2026-10-22')).toBe('22nd Oct');
    expect(niceDate('2026-10-23')).toBe('23rd Oct');
  });
  it('September is "Sept"; junk is empty', () => {
    expect(niceDate('2026-09-03')).toBe('3rd Sept');
    expect(niceDate('')).toBe('');
    expect(niceDate(null)).toBe('');
    expect(niceDate('2026-10')).toBe('');
    expect(niceDate('2026-10-0')).toBe('');
  });
});

describe('hrs / dur', () => {
  it('hrs keeps one decimal under ten', () => {
    expect(hrs(0)).toBe('0');
    expect(hrs(1)).toBe('1');
    expect(hrs(1.25)).toBe('1.3');
    expect(hrs(9.94)).toBe('9.9');
    expect(hrs(9.95)).toBe('10');
    expect(hrs(12.4)).toBe('12');
    expect(hrs(-1.5)).toBe('-1.5');
    expect(hrs('3')).toBe('3');
    expect(hrs(NaN)).toBe('0');
    expect(hrs(null)).toBe('0');
  });
  it('dur renders sub-hour amounts in minutes (min 5, steps of 5)', () => {
    expect(dur(0.5)).toBe('30m');
    expect(dur(0.04)).toBe('5m');
    expect(dur(0.25)).toBe('15m');
    expect(dur(0.99)).toBe('60m'); // prototype quirk: rounds to 60m rather than 1h
    expect(dur(1)).toBe('1h');
    expect(dur(1.25)).toBe('1.3h');
    expect(dur(0)).toBe('0h');
    expect(dur(-3)).toBe('0h');
  });
});

describe('ago', () => {
  const now = 1_000_000_000_000;
  it('buckets', () => {
    expect(ago(now - 30e3, now)).toBe('just now');
    expect(ago(now + 5e3, now)).toBe('just now');
    expect(ago(now - 60e3, now)).toBe('1 min ago');
    expect(ago(now - 5 * 60e3, now)).toBe('5 mins ago');
    expect(ago(now - 3600e3, now)).toBe('1 hour ago');
    expect(ago(now - 5 * 3600e3, now)).toBe('5 hours ago');
    expect(ago(now - 24 * 3600e3, now)).toBe('yesterday');
    expect(ago(now - 72 * 3600e3, now)).toBe('3 days ago');
  });
});
