import { DEFAULT_PREFS, goalToday, goalsToday, minutesOfDay, goalStats, RING, ringDash, SWATCH } from '@calendar/core';

import { cats, data, dataWithDinner, events, goals, NOW, snapshotAt, user } from './fixtures';
import { applyOps, buildSnapshot, fingerprint, MAX_EVENTS } from './snapshot';
import { DARK, LIGHT } from './tokens';
import { ringOf, leftTodayLabel } from './labels';
import { parseSnapshot } from './read';

describe('buildSnapshot', () => {
  const snap = snapshotAt();

  it('is null when signed out', () => {
    expect(buildSnapshot({ data, prefs: DEFAULT_PREFS, user: null, now: NOW, clock: '12h' })).toBeNull();
  });

  it('has the WG 5 shape', () => {
    expect(snap.v).toBe(1);
    expect(snap.writtenAt).toBe(NOW.toISOString());
    expect(snap.day).toBe('2026-10-30');
    expect(snap.session).toEqual({ userId: 'u_8f3c', name: 'Sam' });
    expect(snap.prefs).toMatchObject({ font: 'serif', clock: '12h', weekStart: 1, hidePrivate: false });
    expect(snap.cats).toMatchObject({ 'Deep work': 240, Reading: 290 });
    expect(snap.ops).toEqual([]);
  });

  it('covers yesterday to 7 days ahead, without all-day events', () => {
    const ids = snap.events.map((e) => e.id);
    expect(ids).toEqual(['e1', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 't1', 't2']);
    expect(ids).not.toContain('old');
    expect(ids).not.toContain('far');
    expect(ids).not.toContain('allday');
  });

  it('writes floating local start and end', () => {
    const lunch = snap.events.find((e) => e.id === 'e3')!;
    expect(lunch.s).toBe('2026-10-30T12:30');
    expect(lunch.e).toBe('2026-10-30T13:15');
    expect(lunch).toMatchObject({ t: 'Lunch', cat: 'Food', hue: 60, vis: 'public', owner: null, done: false });
  });

  it('writes an event that runs past midnight with the next day in `e`', () => {
    const late = { ...data, events: [{ id: 'x', day: '2026-10-30', cat: 'Food', title: 'Late', start: 1380, end: 1500 }] };
    const s = snapshotAt(NOW, { data: late });
    expect(s.events[0]).toMatchObject({ s: '2026-10-30T23:00', e: '2026-10-31T01:00' });
  });

  it('marks someone else’s events with initials and no check', () => {
    const withOthers = snapshotAt(NOW, { data: dataWithDinner });
    const e9 = withOthers.events.find((e) => e.id === 'e9')!;
    expect(e9.owner).not.toBeNull();
    expect(e9.check).toBe(false);
    const custom = buildSnapshot({
      data: dataWithDinner, prefs: DEFAULT_PREFS, user, now: NOW, clock: '12h', ownerOf: (e) => (e.id === 'e9' ? 'MC' : null),
    })!;
    expect(custom.events.find((e) => e.id === 'e9')!.owner).toBe('MC');
    expect(withOthers.events.filter((e) => e.id !== 'e9').every((e) => e.owner === null)).toBe(true);
  });

  it('flags private and public events', () => {
    expect(snap.events.find((e) => e.id === 'e4')!.vis).toBe('private');
    expect(snapshotAt(NOW, { data: dataWithDinner }).events.find((e) => e.id === 'e9')!.vis).toBe('public');
  });

  it('shows checks only on goal sessions (open question 5)', () => {
    const checks = Object.fromEntries(snap.events.map((e) => [e.id, e.check]));
    expect(checks).toMatchObject({ e1: true, e4: true, e7: true, e8: true, t1: true, e3: false, e5: false, e6: false });
    expect(snap.events.find((e) => e.id === 'e4')!.goal).toBe('g1');
  });

  it('caps events at 60, keeping what has not ended', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: 'm' + i, day: '2026-10-30', cat: 'Food', title: 'M' + i, start: 20 + (i % 70) * 15, end: 35 + (i % 70) * 15,
    }));
    const s = snapshotAt(NOW, { data: { events: many, cats, goals: [] } });
    expect(s.events.length).toBe(MAX_EVENTS);
  });

  it('carries both colour schemes and the swatches, with no coloured text', () => {
    expect(snap.tokens.dark).toEqual(DARK);
    expect(snap.tokens.light).toEqual(LIGHT);
    expect(DARK.ink).toBe('#ffffff');
    expect(LIGHT.ink).toBe('#000000');
    expect(snap.tokens.swatch['240']).toBe(SWATCH[240]);
    expect(snap.tokens.amber).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('round-trips through JSON and parseSnapshot', () => {
    expect(parseSnapshot(JSON.stringify(snap))).toEqual(snap);
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snap, v: 2 }))).toBeNull();
  });

  it('fingerprint ignores writtenAt only', () => {
    const later = snapshotAt(new Date(NOW.getTime() + 60000));
    expect(fingerprint(later)).toBe(fingerprint(snap));
    expect(fingerprint(snapshotAt(NOW, { clock: '24h' }))).not.toBe(fingerprint(snap));
  });

  it('is small', () => {
    expect(JSON.stringify(snap).length).toBeLessThan(25000);
  });
});

describe('goals match core', () => {
  const snap = snapshotAt();
  const ctx = { today: new Date(2026, 9, 30), nowMin: minutesOfDay(NOW), nowMs: NOW.getTime() };

  it('uses core goalToday for need, done and total left', () => {
    const core = goalsToday(goals, events, ctx);
    for (const g of snap.goals) {
      const c = core.find((x) => x.id === g.id)!;
      expect(g.todayNeed).toBeCloseTo(c.todayNeed, 3);
      expect(g.todayDone).toBeCloseTo(c.todayDone, 3);
      expect(g.hours - g.done).toBeCloseTo(c.totalLeft, 2);
      expect(ringOf(g.todayNeed, g.todayDone)).toBeCloseTo(c.ring, 2);
      expect(leftTodayLabel(g.todayNeed, g.todayDone)).toBe(c.label);
    }
  });

  it('counts the 9am Deep work session as done today', () => {
    const dw = snap.goals.find((g) => g.id === 'g1')!;
    expect(dw.todayDone).toBeCloseTo(goalToday(goals[0], events, ctx).todayDone, 3);
    expect(dw.todayDone).toBeGreaterThan(0);
    expect(dw.done).toBeCloseTo(goalStats(goals[0], events, ctx).done, 3);
  });

  it('orders furthest behind first, then nearest deadline', () => {
    const deltas = snap.goals.map((g) => goalStats(goals.find((x) => x.id === g.id)!, events, ctx).delta);
    expect([...deltas].sort((a, b) => a - b)).toEqual(deltas);
  });

  it('drops goals that are not active today', () => {
    const s = snapshotAt(NOW, { data: { events, cats, goals: [...goals, { ...goals[0], id: 'old', start: '2026-01-01', deadline: '2026-02-01' }] } });
    expect(s.goals.map((g) => g.id)).not.toContain('old');
  });

  it('ring geometry is the app’s: 18 viewBox, r 7.5, stroke 2.5, from the top', () => {
    expect(RING).toMatchObject({ viewBox: 18, r: 7.5, stroke: 2.5, rotation: -90 });
    expect(ringDash(0.25).dashoffset).toBeCloseTo(RING.circumference * 0.75, 5);
  });
});

describe('empty day', () => {
  it('has no events today and keeps the next one in the window', () => {
    const sunday = new Date(2026, 10, 1, 11, 48);
    const s = snapshotAt(sunday, { data: { events: [{ id: 'm1', day: '2026-11-02', cat: 'Deep work', title: 'Sync layer, part three', start: 540, end: 600 }], cats, goals } });
    expect(s.day).toBe('2026-11-01');
    expect(s.events.map((e) => e.id)).toEqual(['m1']);
  });
});

describe('applyOps', () => {
  const snap = snapshotAt();
  const after = new Date(NOW.getTime() + 90000).toISOString();

  it('dims the row and moves the goal ring', () => {
    const out = applyOps(snap, [{ op: 'done', ev: 'e4', at: after }]);
    expect(out.events.find((e) => e.id === 'e4')!.done).toBe(true);
    const before = snap.goals.find((g) => g.id === 'g1')!;
    const next = out.goals.find((g) => g.id === 'g1')!;
    expect(next.todayDone).toBeCloseTo(before.todayDone + 0.5, 3);
    expect(next.done).toBeCloseTo(before.done + 0.5, 3);
    expect(snap.events.find((e) => e.id === 'e4')!.done).toBe(false);
  });

  it('ignores ops older than the snapshot, unknown events and someone else’s events', () => {
    const before = new Date(NOW.getTime() - 1000).toISOString();
    expect(applyOps(snap, [{ op: 'done', ev: 'e4', at: before }])).toBe(snap);
    expect(applyOps(snap, [{ op: 'done', ev: 'nope', at: after }]).events).toEqual(snap.events);
    const others = snapshotAt(NOW, { data: dataWithDinner });
    expect(applyOps(others, [{ op: 'done', ev: 'e9', at: after }]).events.find((e) => e.id === 'e9')!.done).toBe(false);
  });
});
