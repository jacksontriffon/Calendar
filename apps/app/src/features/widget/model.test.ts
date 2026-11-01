import { composeUrl, dayUrl, eventUrl, goalUrl, signinUrl } from './links';
import { fmtClock, fmtRange, parseLocal, staleLabel, staleLevel } from './labels';
import { tapCarousel } from './carousel';
import { buildModel, type Item } from './model';
import { cats, data, dataWide, dataWithDinner, goals, NOW, snapshotAt } from './fixtures';
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

const MIN = 60000;
const names = (items: Item[]) => items.map((i) => (i.kind === 'now' ? 'now ' + i.time : i.kind === 'row' ? i.row.title : 'card ' + i.row.title));
/** a tap on the carousel a second before `NOW` */
const tapped = (patch: Parameters<typeof tapCarousel>[1], at = NOW.getTime() - 1000) => tapCarousel(null, patch, at);

describe('Large, Today (WG 1g)', () => {
  const snap = snapshotAt(NOW, { data: dataWide });
  const m = buildModel(snap, NOW.getTime(), 'large');

  it('header: the date with the month under it, no "Now" line, no "+", no count', () => {
    expect(m.header).toMatchObject({ title: 'Fri 30', month: 'October', stale: false, showPlus: false });
    expect(m.header.sub).toBe('Now 11:48');
    expect(m.header.sub).not.toMatch(/left/);
    expect(m.url).toBe('aicalendar://day/2026-10-30');
  });

  it('Today page: the finished session, the now line, what fits, and "+ 1 more today"', () => {
    expect(m.pager).toMatchObject({ day: 0, heading: 'Today', summary: null });
    expect(names(m.items)).toEqual(['Sync layer, part two', 'now 11:48', 'Lunch', 'Review offline queue PR', 'Order dog food', 'Dog walk', 'Easy 6k']);
    expect(m.more).toBe('+ 1 more today');
    const first = m.items[0];
    expect(first.kind === 'row' && first.row.done).toBe(true);
  });

  it('Yesterday and Tomorrow peek with their summary and first event; the dots show where you are', () => {
    expect(m.pager!.before).toMatchObject({ offset: -1, label: 'Yesterday · Thu 29', summary: '2 of 3 done', empty: false });
    expect(m.pager!.before!.row!.title).toBe('Sync layer, part one');
    expect(m.pager!.after).toMatchObject({ offset: 1, label: 'Tomorrow · Sat 31', summary: '4h 55m planned' });
    expect(m.pager!.after!.row!.title).toBe('Long run');
    expect(m.pager!.dots).toEqual([-1, 0, 1]);
  });

  it('no check buttons anywhere: a done event is only struck through', () => {
    const rows = [...m.items, ...[m.pager!.before, m.pager!.after].map((p) => (p!.row ? ({ kind: 'row', row: p!.row } as Item) : null))].flatMap((i) =>
      i && i.kind === 'row' ? [i.row] : [],
    );
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.check === false)).toBe(true);
  });

  it('message field: a placeholder that opens the composer, with the accent for the send button', () => {
    expect(m.compose).toEqual({ placeholder: 'Add or change an event…', url: 'aicalendar://compose' });
    expect(m.accent).toBe('#cf7b58');
  });

  it('goals: two a page with the time left inside the ring, and page dots for the rest', () => {
    expect(m.goals).toHaveLength(2);
    expect(m.goalPages).toEqual({ index: 0, count: 2 });
    for (const g of m.goals) {
      expect(g.ring).toBeGreaterThanOrEqual(0);
      expect(g.left).toMatch(/^(\d+h)?( ?\d+m)?$/);
      expect(g.url).toBe(goalUrl(g.id));
    }
    const second = buildModel(snap, NOW.getTime(), 'large', { carousel: tapped({ large: 1 }) });
    expect(second.goals).toHaveLength(1);
    expect(second.goalPages).toEqual({ index: 1, count: 2 });
    // the order is the snapshot's (furthest behind first), split across the pages
    expect([...m.goals, ...second.goals].map((g) => g.id)).toEqual(snap.goals.map((g) => g.id));
  });

  it('a page past the last clamps to it', () => {
    expect(buildModel(snap, NOW.getTime(), 'large', { carousel: tapped({ large: 9 }) }).goalPages).toEqual({ index: 1, count: 2 });
  });

  it('tap targets are the spec’s deep links, and they parse in the app', () => {
    const urls = [eventUrl('e3'), goalUrl('g2'), dayUrl('2026-10-30'), composeUrl(), signinUrl()];
    expect(urls).toEqual([
      'aicalendar://event/e3', 'aicalendar://goal/g2', 'aicalendar://day/2026-10-30', 'aicalendar://compose', 'aicalendar://signin',
    ]);
    expect(urls.map((u) => parseDeepLink(u).kind)).toEqual(['event', 'goal', 'day', 'compose', 'signin']);
    const row = m.items.find((i) => i.kind === 'row' && i.row.id === 'e3');
    expect(row && row.kind === 'row' && row.row.url).toBe('aicalendar://event/e3');
  });

  it('initials chip on someone else’s event, never a check', () => {
    const dinner = buildModel(snapshotAt(new Date(2026, 9, 30, 18, 50), { data: dataWithDinner }), at(18, 50), 'large').items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
    const d = dinner.find((r) => r.title.startsWith('Dinner'))!;
    expect(d.check).toBe(false);
    expect(d.owner).toBeTruthy();
  });
});

describe('Large, Yesterday and Tomorrow (WG 1h, 1i)', () => {
  const snap = snapshotAt(NOW, { data: dataWide });

  it('Yesterday: every event, "2 of 3 done", the header date follows, Today peeks below', () => {
    const m = buildModel(snap, NOW.getTime(), 'large', { carousel: tapped({ day: -1 }) });
    expect(m.header).toMatchObject({ title: 'Thu 29', month: 'October' });
    expect(m.url).toBe('aicalendar://day/2026-10-29');
    expect(m.pager).toMatchObject({ day: -1, heading: 'Yesterday', summary: '2 of 3 done', before: null });
    expect(names(m.items)).toEqual(['Sync layer, part one', 'Lunch', 'Easy 5k', 'Reading']);
    expect(m.more).toBeNull();
    expect(m.items.flatMap((i) => (i.kind === 'row' ? [i.row.done] : []))).toEqual([true, false, true, false]);
    expect(m.pager!.after).toMatchObject({ offset: 0, label: 'Today · Fri 30', summary: null });
    expect(m.pager!.after!.row!.title).toBe('Lunch');
  });

  it('Tomorrow: every event, "4h 55m planned", Today peeks above', () => {
    const m = buildModel(snap, NOW.getTime(), 'large', { carousel: tapped({ day: 1 }) });
    expect(m.header).toMatchObject({ title: 'Sat 31', month: 'October' });
    expect(m.pager).toMatchObject({ day: 1, heading: 'Tomorrow', summary: '4h 55m planned', after: null });
    expect(names(m.items)).toEqual(['Long run', 'Family brunch', 'Dog walk', 'Reading']);
    expect(m.pager!.before).toMatchObject({ offset: 0, label: 'Today · Fri 30' });
  });

  it('the month in the header follows the day too', () => {
    const lateOct = new Date(2026, 9, 31, 12, 0);
    const m = buildModel(snapshotAt(lateOct, { data: dataWide }), lateOct.getTime(), 'large', { carousel: tapped({ day: 1 }, lateOct.getTime() - 1000) });
    expect(m.header).toMatchObject({ title: 'Sun 1', month: 'November' });
  });

  it('a day with nothing on it says so; its summary is empty', () => {
    const monday = new Date(2026, 10, 2, 11, 48); // yesterday, Sun 1 Nov, is empty
    const m = buildModel(snapshotAt(monday, { data: dataWide }), monday.getTime(), 'large', { carousel: tapped({ day: -1 }, monday.getTime() - 1000) });
    expect(m.items).toEqual([]);
    expect(m.empty).toEqual({ next: null });
    expect(m.pager).toMatchObject({ day: -1, summary: null });
  });

  it('a long day gets "+ n more" instead of overflowing', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: 'z' + i, day: '2026-10-31', cat: 'Food', title: 'Z' + i, start: 360 + i * 60, end: 400 + i * 60 }));
    const m = buildModel(snapshotAt(NOW, { data: { events: many, cats, goals } }), NOW.getTime(), 'large', { carousel: tapped({ day: 1 }) });
    const rows = m.items.filter((i) => i.kind === 'row').length;
    // 185 pt: nine 20 pt rows fit, but the "+ n more" line (14 pt) needs room too, so eight
    expect(rows).toBe(8);
    expect(m.more).toBe('+ 6 more');
  });
});

describe('carousel reset', () => {
  const snap = snapshotAt(NOW, { data: dataWide });
  it('goes home after 5 minutes without a tap', () => {
    const state = tapCarousel(null, { day: 1, large: 1 }, NOW.getTime() - 4 * MIN);
    const m = buildModel(snap, NOW.getTime(), 'large', { carousel: state });
    expect(m.pager!.day).toBe(1);
    expect(m.goalPages!.index).toBe(1);
    const later = buildModel(snap, NOW.getTime() + 2 * MIN, 'large', { carousel: state });
    expect(later.pager!.day).toBe(0);
    expect(later.goalPages!.index).toBe(0);
  });
  it('goes home at midnight', () => {
    const night = new Date(2026, 9, 30, 23, 58).getTime();
    const state = tapCarousel(null, { day: -1 }, night);
    expect(buildModel(snapshotAt(new Date(night), { data: dataWide }), night + MIN, 'large', { carousel: state }).pager!.day).toBe(-1);
    const after = new Date(2026, 9, 31, 0, 1).getTime();
    expect(buildModel(snapshotAt(new Date(after), { data: dataWide }), after, 'large', { carousel: state }).pager!.day).toBe(0);
  });
});

describe('Large, event in progress', () => {
  const now = at(11, 5);
  const m = buildModel(snapshotAt(new Date(now), { data: running }), now, 'large');
  it('the running event becomes a card in place of the now line', () => {
    const card = m.items[0];
    expect(card.kind).toBe('card');
    if (card.kind === 'card') {
      expect(card.endsIn).toBe('Ends in 25 min');
      expect(card.progress).toBeCloseTo((11 * 60 + 5 - 540) / 150, 2);
    }
    expect(m.items.some((i) => i.kind === 'now')).toBe(false);
    expect(m.header.sub).toBe('Now 11:05');
  });
  it('the card costs 44 pt, so fewer rows fit: 44 + 4 x 20 + 14 for "+ 2 more today" = 138 of 148', () => {
    expect(m.items.filter((i) => i.kind === 'row')).toHaveLength(4);
    expect(m.more).toBe('+ 2 more today');
  });
});

describe('empty day', () => {
  const sunday = new Date(2026, 10, 1, 11, 48);
  const snap = snapshotAt(sunday, {
    data: { events: [{ id: 'm1', day: '2026-11-02', cat: 'Deep work', title: 'Sync layer, part three', start: 540, end: 600 }], cats, goals },
  });
  it('Large: "Nothing scheduled" with the next event; the message field is the one way to add', () => {
    const m = buildModel(snap, sunday.getTime(), 'large');
    expect(m.header).toMatchObject({ title: 'Sun 1', month: 'November', showPlus: false });
    expect(m.empty).toEqual({ next: 'Next: Mon 9am · Sync layer, part three' });
    expect(m.items).toEqual([]);
    expect(m.compose).toMatchObject({ url: 'aicalendar://compose' });
    // Tomorrow still shows its event
    expect(m.pager!.after!.row!.title).toBe('Sync layer, part three');
  });
  it('iPad and Android keep "Add a note" in place of the "+": only one add button', () => {
    const m = buildModel(snap, sunday.getTime(), 'large', { platform: 'android' });
    expect(m.header).toMatchObject({ title: 'Sun 1 Nov', sub: 'Free day', showPlus: false });
    expect(m.empty).toEqual({ next: 'Next: Mon 9am · Sync layer, part three' });
    expect(m.compose).toBeNull();
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
      expect(m.compose).toBeNull();
    }
  });
});

describe('Medium (WG 2i)', () => {
  const snap = snapshotAt(NOW, { data: dataWide });
  const m = buildModel(snap, NOW.getTime(), 'medium');

  it('today only: no pager, whatever the carousel says', () => {
    expect(m.pager).toBeNull();
    expect(buildModel(snap, NOW.getTime(), 'medium', { carousel: tapped({ day: 1 }) }).header.title).toBe('Fri 30');
    expect(m.header).toMatchObject({ title: 'Fri 30', month: 'October', showPlus: false });
  });

  it('list: the finished session, the now line, the next three and "+ 3 more today"', () => {
    expect(names(m.items)).toEqual(['Sync layer, part two', 'now 11:48', 'Lunch', 'Review offline queue PR', 'Order dog food']);
    expect(m.more).toBe('+ 3 more today');
    expect(m.items.every((i) => i.kind !== 'row' || i.row.check === false)).toBe(true);
  });

  it('goals: one at a time, three dots, a tap to reach the others', () => {
    expect(m.goals).toHaveLength(1);
    expect(m.goalPages).toEqual({ index: 0, count: 3 });
    expect(m.goals[0].left).toMatch(/^(\d+h)?( ?\d+m)?$/);
    const third = buildModel(snap, NOW.getTime(), 'medium', { carousel: tapped({ medium: 2 }) });
    expect(third.goalPages).toEqual({ index: 2, count: 3 });
    expect(third.goals[0].id).toBe(snap.goals[2].id);
    // Large and Medium page separately
    expect(buildModel(snap, NOW.getTime(), 'large', { carousel: tapped({ medium: 2 }) }).goalPages!.index).toBe(0);
  });

  it('the message field is the same as Large’s', () => {
    expect(m.compose).toEqual(buildModel(snap, NOW.getTime(), 'large').compose);
  });
});

describe('Android and Small keep their layouts', () => {
  it('Android Medium shows four rows with two goals and a "+"; Large seven rows with three goals and deadlines', () => {
    const med = buildModel(snapshotAt(), NOW.getTime(), 'medium', { platform: 'android' });
    expect(med.items).toHaveLength(4);
    expect(med.goals).toHaveLength(2);
    expect(med.goalPages).toBeNull();
    expect(med.header.showPlus).toBe(true);
    const big = buildModel(snapshotAt(), NOW.getTime(), 'large', { platform: 'android' });
    expect(big.items.filter((i) => i.kind === 'row')).toHaveLength(7);
    expect(big.more).toBeNull();
    expect(big.goals).toHaveLength(3);
    expect(big.goals.every((g) => /(weeks|days|day) left$/.test(g.deadline ?? ''))).toBe(true);
    expect(big.header).toMatchObject({ title: 'Fri 30 Oct', sub: 'Now 11:48', showPlus: true });
    expect(big.pager).toBeNull();
  });
  it('Android keeps the check on goal sessions only, never on someone else’s event', () => {
    const rows = buildModel(snapshotAt(), NOW.getTime(), 'large', { platform: 'android' }).items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
    expect(rows.find((r) => r.title === 'Review offline queue PR')!.check).toBe(true);
    expect(rows.find((r) => r.title === 'Lunch')!.check).toBe(false);
    const dinner = buildModel(snapshotAt(new Date(2026, 9, 30, 18, 50), { data: dataWithDinner }), at(18, 50), 'large', { platform: 'android' }).items.flatMap((i) => (i.kind === 'row' ? [i.row] : []));
    expect(dinner.find((r) => r.title.startsWith('Dinner'))!.check).toBe(false);
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
    const m = buildModel(snapshotAt(), NOW.getTime() + 20 * MIN, 'large');
    expect(m.level).toBe('fresh');
    expect(m.header.stale).toBe(false);
    expect(m.banner).toBeNull();
  });
  it('3 h old: the cloud-off mark, times still right; Android adds the banner', () => {
    const m = buildModel(snapshotAt(), NOW.getTime() + 3 * 3600000, 'large');
    expect(m.header).toMatchObject({ sub: 'Updated 3h ago', stale: true });
    expect(m.banner).toBeNull();
    expect(m.strip).toBeNull();
    expect(m.goalsDim).toBe(false);
    const a = buildModel(snapshotAt(), NOW.getTime() + 3 * 3600000, 'large', { platform: 'android' });
    expect(a.banner).toBe('Can’t refresh. Showing 3h old data.');
    expect(a.strip).toBeNull();
  });
  it('over 24 h: goals dim; Android shows the strip, the iPhone puts it in the message field', () => {
    const m = buildModel(snapshotAt(), NOW.getTime() + 26 * 3600000, 'large');
    expect(m.level).toBe('old');
    expect(m.goalsDim).toBe(true);
    expect(m.goals.every((g) => g.today === '' && g.left === '' && g.ring === 0)).toBe(true);
    expect(m.strip).toBeNull();
    expect(m.compose).toEqual({ placeholder: 'Open Calendar to refresh', url: 'aicalendar://compose' });
    expect(buildModel(snapshotAt(), NOW.getTime() + 26 * 3600000, 'large', { platform: 'android' }).strip).toBe('Open Calendar to refresh');
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
    expect(m.header.sub).toBe('Now 11:48');
    expect(m.items.find((i) => i.kind === 'now')).toEqual({ kind: 'now', time: '11:48' });
    const lunch = m.items.find((i) => i.kind === 'row' && i.row.id === 'e3');
    expect(lunch && lunch.kind === 'row' && lunch.row.time).toBe('12:30');
  });
});

describe('iPad (WG 3)', () => {
  it('today and tomorrow columns, without the count', () => {
    const m = buildModel(snapshotAt(), NOW.getTime(), 'xl');
    expect(m.xl!.today.label).toBe('Today');
    expect(m.xl!.today.nowTime).toBe('11:48');
    expect(m.xl!.tomorrow.label).toBe('Tomorrow · Sat 31');
    expect(m.xl!.tomorrow.rows.map((r) => r.title)).toEqual(['Long run', 'Family brunch']);
    expect(m.xl!.tomorrow.planned).toBe('3h 30m planned');
    expect(m.header.sub).toBe('Now 11:48');
    expect(m.header.showPlus).toBe(true);
    expect(m.pager).toBeNull();
  });
});

void data;
