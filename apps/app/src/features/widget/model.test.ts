import { composeUrl, dayUrl, eventUrl, goalUrl, signinUrl } from './links';
import { fmtClock, fmtRange, parseLocal, staleLabel, staleLevel } from './labels';
import { buildModel } from './model';
import { cats, data, dataWithDinner, goals, NOW, snapshotAt } from './fixtures';
import { parseDeepLink } from '@/lib/deepLinks';

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();
/** 9am session not done yet, as in the in-progress frames. */
const running = { ...data, events: data.events.map((e) => (e.id === 'e1' ? { ...e, done: false } : e)) };

describe('labels (Design Spec strings)', () => {
  it('formats times and ranges', () => {
    expect(fmtClock(750, '12h')).toBe('12:30pm');
    expect(fmtClock(840, '12h')).toBe('2pm');
    expect(fmtClock(540, '24h')).toBe('09:00');
    const r = (a: string, b: string, c: '12h' | '24h' = '12h') => fmtRange(parseLocal(a)!, parseLocal(b)!, c);
    expect(r('2026-10-30T12:30', '2026-10-30T13:15')).toBe('12:30–1:15pm');
    expect(r('2026-10-30T09:00', '2026-10-30T11:30')).toBe('9–11:30am');
    expect(r('2026-10-30T11:00', '2026-10-30T12:30')).toBe('11am–12:30pm');
    expect(r('2026-10-30T12:30', '2026-10-30T13:15', '24h')).toBe('12:30–13:15');
  });

  it('stale levels and text', () => {
    const MIN = 60000;
    expect(staleLevel(10 * MIN)).toBe('fresh');
    expect(staleLevel(30 * MIN)).toBe('stale');
    expect(staleLevel(23 * 60 * MIN)).toBe('stale');
    expect(staleLevel(25 * 60 * MIN)).toBe('old');
    expect(staleLabel(3 * 60 * MIN)).toBe('Updated 3h ago');
    expect(staleLabel(45 * MIN)).toBe('Updated 45m ago');
  });
});

describe('Large (WG 1a)', () => {
  const snap = snapshotAt();
  const m = buildModel(snap, NOW.getTime(), 'large');

  it('header: date, now and what is left', () => {
    expect(m.header).toMatchObject({ title: 'Fri 30 Oct', sub: 'Now 11:48 · 6 left', stale: false, showPlus: true });
  });

  it('rows: the finished session dimmed, the now line, then the next four, and "+ 2 more today"', () => {
    expect(m.items.map((i) => (i.kind === 'now' ? 'now ' + i.time : i.kind === 'row' ? i.row.title : 'card'))).toEqual([
      'Sync layer, part two', 'now 11:48', 'Lunch', 'Review offline queue PR', 'Order dog food', 'Dog walk',
    ]);
    expect(m.more).toBe('+ 2 more today');
    const first = m.items[0];
    expect(first.kind === 'row' && first.row.done).toBe(true);
  });

  it('goals: three, with ring, left today, total left and deadline', () => {
    expect(m.goals).toHaveLength(3);
    for (const g of m.goals) {
      expect(g.ring).toBeGreaterThanOrEqual(0);
      expect(g.total).toMatch(/h left$|m left$/);
      expect(g.deadline).toMatch(/(weeks|days|day) left$/);
      expect(g.url).toBe(goalUrl(g.id));
    }
    expect(m.goals.every((g) => g.today === 'Done today' || /left today$/.test(g.today))).toBe(true);
  });

  it('check on goal sessions only; none on someone else’s event; initials chip', () => {
    const rows = m.items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
    expect(rows.find((r) => r.title === 'Review offline queue PR')!.check).toBe(true);
    expect(rows.find((r) => r.title === 'Lunch')!.check).toBe(false);
    const dinner = buildModel(snapshotAt(new Date(2026, 9, 30, 18, 50), { data: dataWithDinner }), at(18, 50), 'large').items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
    const d = dinner.find((r) => r.title.startsWith('Dinner'))!;
    expect(d.check).toBe(false);
    expect(d.owner).toBeTruthy();
  });

  it('tap targets are the spec’s deep links, and they parse in the app', () => {
    expect(m.url).toBe('aicalendar://day/2026-10-30');
    const urls = [eventUrl('e3'), goalUrl('g2'), dayUrl('2026-10-30'), composeUrl(), signinUrl()];
    expect(urls).toEqual([
      'aicalendar://event/e3', 'aicalendar://goal/g2', 'aicalendar://day/2026-10-30', 'aicalendar://compose', 'aicalendar://signin',
    ]);
    expect(urls.map((u) => parseDeepLink(u).kind)).toEqual(['event', 'goal', 'day', 'compose', 'signin']);
    const row = m.items.find((i) => i.kind === 'row' && i.row.id === 'e3');
    expect(row && row.kind === 'row' && row.row.url).toBe('aicalendar://event/e3');
  });
});

describe('Large, event in progress (WG 1b)', () => {
  const now = at(11, 5);
  const m = buildModel(snapshotAt(new Date(now), { data: running }), now, 'large');
  it('the running event grows into a card and costs two rows', () => {
    const card = m.items[0];
    expect(card.kind).toBe('card');
    if (card.kind === 'card') {
      expect(card.endsIn).toBe('Ends in 25 min');
      expect(card.progress).toBeCloseTo((11 * 60 + 5 - 540) / 150, 2);
    }
    expect(m.items.filter((i) => i.kind === 'row')).toHaveLength(3);
    expect(m.items.some((i) => i.kind === 'now')).toBe(false);
    expect(m.header.sub).toBe('Now 11:05 · 7 left');
    expect(m.more).toBe('+ 3 more today');
  });
});

describe('empty day (WG 1c)', () => {
  const sunday = new Date(2026, 10, 1, 11, 48);
  const snap = snapshotAt(sunday, {
    data: { events: [{ id: 'm1', day: '2026-11-02', cat: 'Deep work', title: 'Sync layer, part three', start: 540, end: 600 }], cats, goals },
  });
  const m = buildModel(snap, sunday.getTime(), 'large');
  it('"Add a note" replaces the "+": only one add button', () => {
    expect(m.header).toMatchObject({ title: 'Sun 1 Nov', sub: 'Free day', showPlus: false });
    expect(m.empty).toEqual({ next: 'Next: Mon 9am · Sync layer, part three' });
    expect(m.items).toEqual([]);
  });
  it('Small is one tap target that opens the composer', () => {
    const s = buildModel(snap, sunday.getTime(), 'small');
    expect(s.small).toEqual({ kind: 'empty', date: 'Sun 1 Nov' });
    expect(s.url).toBe('aicalendar://compose');
    expect(s.header.showPlus).toBe(false);
  });
});

describe('signed out (WG 1d)', () => {
  it('links to sign-in at every size', () => {
    for (const layout of ['small', 'medium', 'large', 'xl'] as const) {
      const m = buildModel(null, NOW.getTime(), layout);
      expect(m.state).toBe('signedOut');
      expect(m.url).toBe('aicalendar://signin');
      expect(m.header.showPlus).toBe(false);
    }
  });
});

describe('Medium and Small (WG 2)', () => {
  it('Medium: next three events, two goals, no now line', () => {
    const m = buildModel(snapshotAt(), NOW.getTime(), 'medium');
    expect(m.items.map((i) => (i.kind === 'row' ? i.row.title : i.kind))).toEqual(['Lunch', 'Review offline queue PR', 'Order dog food']);
    expect(m.goals).toHaveLength(2);
    expect(m.goals.every((g) => g.deadline === null)).toBe(true);
    expect(m.more).toBeNull();
  });
  it('Android Medium shows four rows, Large seven', () => {
    expect(buildModel(snapshotAt(), NOW.getTime(), 'medium', { platform: 'android' }).items).toHaveLength(4);
    const big = buildModel(snapshotAt(), NOW.getTime(), 'large', { platform: 'android' });
    expect(big.items.filter((i) => i.kind === 'row')).toHaveLength(7);
    expect(big.more).toBeNull();
  });
  it('Small: what is next, and when', () => {
    const s = buildModel(snapshotAt(), NOW.getTime(), 'small').small;
    expect(s).toMatchObject({ kind: 'next', when: 'in 42 min', title: 'Lunch', range: '12:30–1:15pm' });
    expect(buildModel(snapshotAt(), NOW.getTime(), 'small').goals).toEqual([]);
  });
  it('Small, in progress: minutes left and a progress bar', () => {
    const now = at(11, 5);
    const s = buildModel(snapshotAt(new Date(now), { data: running }), now, 'small').small;
    expect(s).toMatchObject({ kind: 'now', minsLeft: '25 min', title: 'Sync layer, part two', range: '9–11:30am' });
  });
});

describe('stale (WG 6a)', () => {
  it('under 30 min: nothing extra', () => {
    const m = buildModel(snapshotAt(), NOW.getTime() + 20 * 60000, 'large');
    expect(m.level).toBe('fresh');
    expect(m.header.stale).toBe(false);
    expect(m.banner).toBeNull();
  });
  it('3 h old: "Updated 3h ago", times still right', () => {
    const m = buildModel(snapshotAt(), NOW.getTime() + 3 * 3600000, 'large');
    expect(m.header).toMatchObject({ sub: 'Updated 3h ago', stale: true });
    expect(m.banner).toBe('Can’t refresh. Showing 3h old data.');
    expect(m.strip).toBeNull();
    expect(m.goalsDim).toBe(false);
  });
  it('over 24 h: goals dim and the strip asks to open Calendar', () => {
    const m = buildModel(snapshotAt(), NOW.getTime() + 26 * 3600000, 'large');
    expect(m.level).toBe('old');
    expect(m.strip).toBe('Open Calendar to refresh');
    expect(m.goalsDim).toBe(true);
    expect(m.goals.every((g) => g.today === '' && g.ring === 0)).toBe(true);
  });
  it('after midnight the goal numbers are yesterday’s, so they dim', () => {
    const m = buildModel(snapshotAt(new Date(2026, 9, 30, 23, 50)), new Date(2026, 9, 31, 0, 10).getTime(), 'large');
    expect(m.goalsDim).toBe(true);
  });
});

describe('privacy and clock', () => {
  it('hides private titles when the setting is on', () => {
    const m = buildModel(snapshotAt(NOW, { hidePrivate: true }), NOW.getTime(), 'large');
    const titles = m.items.flatMap((i) => (i.kind === 'row' ? [i.row.title] : []));
    expect(titles).toContain('Lunch'); // public
    expect(titles).toContain('Private event');
    expect(titles).not.toContain('Review offline queue PR');
  });
  it('follows the 24-hour clock', () => {
    const m = buildModel(snapshotAt(NOW, { clock: '24h' }), NOW.getTime(), 'large');
    expect(m.header.sub).toBe('Now 11:48 · 6 left');
    const lunch = m.items.find((i) => i.kind === 'row' && i.row.id === 'e3');
    expect(lunch && lunch.kind === 'row' && lunch.row.time).toBe('12:30');
  });
});

describe('iPad (WG 3)', () => {
  it('today and tomorrow columns', () => {
    const m = buildModel(snapshotAt(), NOW.getTime(), 'xl');
    expect(m.xl!.today.label).toBe('Today · 6 left');
    expect(m.xl!.today.nowTime).toBe('11:48');
    expect(m.xl!.tomorrow.label).toBe('Tomorrow · Sat 31');
    expect(m.xl!.tomorrow.rows.map((r) => r.title)).toEqual(['Long run', 'Family brunch']);
    expect(m.xl!.tomorrow.planned).toBe('3h 30m planned');
  });
});

void data;
