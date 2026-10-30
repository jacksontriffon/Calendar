import { dnum, key, addDays, type CalendarData, type ProtoEvent } from '@calendar/core';

import { buildRecap, slideText, storyFontSize, storySlides } from './model';

const today = dnum('2026-10-30'); // a Friday
const dk = (n: number) => key(addDays(today, n));
const ev = (id: string, day: string, start: number, end: number, win?: string, extra: Partial<ProtoEvent> = {}): ProtoEvent => ({
  id, day, cat: 'Deep work', title: 'Deep work', start, end, done: true, ...(win ? { win: { text: win, at: 1 } } : {}), ...extra,
});
const data: CalendarData = {
  cats: { 'Deep work': 240, Other: 28 },
  goals: [{ id: 'g1', title: 'Deep work', cat: 'Deep work', outcome: '', hours: 40, start: dk(-20), deadline: dk(30), hue: 240 }],
  events: [
    ev('a', dk(-3), 540, 600, 'Drafted the intro'), // Tue
    ev('b', dk(-2), 540, 720, 'Finished chapter 3'), // Wed, longest
    ev('c', dk(-1), 540, 570, 'Tidied notes', { cat: 'Other', title: 'Chores' }),
    ev('d', dk(-9), 540, 600, 'Last week'),
    ev('e', dk(0), 540, 600),
  ],
};

describe('weekly recap', () => {
  it('collects this week’s wins and picks the longest session per goal as core', () => {
    const r = buildRecap(data, today, 0);
    expect(r.weekLabel).toBe('This week');
    expect(r.list.map((w) => w.text)).toEqual(['Drafted the intro', 'Finished chapter 3', 'Tidied notes']);
    expect(r.core.map((w) => w.text)).toEqual(['Finished chapter 3']);
    expect(r.groups.map((g) => g.name)).toEqual(['Deep work', 'Other']);
    expect(r.totals).toMatch(/^3 wins · /);
  });

  it('a star overrides the default core pick', () => {
    const d2 = { ...data, events: data.events.map((e) => (e.id === 'a' ? { ...e, win: { text: 'Drafted the intro', at: 1, core: true } } : e)) };
    const r = buildRecap(d2, today, 0);
    expect(r.core.map((w) => w.e.id).sort()).toEqual(['a', 'b']);
  });

  it('looks back a week, and says so when nothing was logged', () => {
    const r = buildRecap(data, today, -1);
    expect(r.weekLabel).toBe('Last week');
    expect(r.list).toHaveLength(1);
    const none = buildRecap({ ...data, events: [] }, today, 0);
    expect(storySlides(none)).toEqual([{ k: 'empty' }]);
    expect(slideText(none, { k: 'empty' }, 0).big).toBe('No wins yet');
  });

  it('builds cover, one slide per core win, and the end slide', () => {
    const r = buildRecap(data, today, 0);
    const slides = storySlides(r);
    expect(slides.map((s) => s.k)).toEqual(['cover', 'win', 'end']);
    expect(slideText(r, slides[0], 0).big).toBe('3 wins');
    expect(slideText(r, slides[1], 0).kicker).toBe('Core win 1 of 1 · Deep work');
    expect(storyFontSize(10)).toBe(42);
    expect(storyFontSize(200)).toBe(23);
  });
});
