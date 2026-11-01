import { CAROUSEL_TIMEOUT_MS, carouselExpiries, HOME, parseCarousel, resolveCarousel, tapCarousel } from './carousel';

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m).getTime();

describe('carousel state', () => {
  it('nothing stored reads as home', () => {
    expect(resolveCarousel(null, at(12))).toEqual(HOME);
    expect(resolveCarousel(undefined, at(12))).toEqual(HOME);
  });

  it('a tap stamps only the piece it sets', () => {
    const a = tapCarousel(null, { day: -1 }, at(12));
    expect(a).toMatchObject({ day: -1, dayAt: new Date(at(12)).toISOString(), large: 0, largeAt: '', medium: 0, mediumAt: '' });
    const b = tapCarousel(a, { large: 1 }, at(12, 3));
    expect(b.day).toBe(-1);
    expect(b.dayAt).toBe(a.dayAt);
    expect(b).toMatchObject({ large: 1, largeAt: new Date(at(12, 3)).toISOString() });
  });

  it('each piece expires on its own, 5 minutes after its own tap', () => {
    const s = tapCarousel(tapCarousel(null, { day: 1 }, at(12)), { medium: 2 }, at(12, 4));
    expect(resolveCarousel(s, at(12, 4))).toEqual({ day: 1, large: 0, medium: 2 });
    // 6 min after the day tap, 2 after the goal tap
    expect(resolveCarousel(s, at(12, 6))).toEqual({ day: 0, large: 0, medium: 2 });
    expect(resolveCarousel(s, at(12, 4) + CAROUSEL_TIMEOUT_MS + 1)).toEqual(HOME);
  });

  it('expires at midnight, and a stamp from the future (clock change) does not count', () => {
    const s = tapCarousel(null, { day: -1, large: 1 }, new Date(2026, 9, 30, 23, 59).getTime());
    expect(resolveCarousel(s, new Date(2026, 9, 31, 0, 1).getTime())).toEqual(HOME);
    expect(resolveCarousel(tapCarousel(null, { day: 1 }, at(13)), at(12))).toEqual(HOME);
  });

  it('never reads a bad stored value', () => {
    expect(resolveCarousel({ day: 1, dayAt: 'nope', large: -3, largeAt: new Date(at(12)).toISOString(), medium: 1.5, mediumAt: new Date(at(12)).toISOString() }, at(12))).toEqual(HOME);
  });

  it('lists when to redraw: just after each piece expires', () => {
    const s = tapCarousel(tapCarousel(null, { day: 1 }, at(12)), { large: 1 }, at(12, 2));
    const times = carouselExpiries(s, at(12, 3));
    expect(times).toEqual([at(12) + CAROUSEL_TIMEOUT_MS + 1000, at(12, 2) + CAROUSEL_TIMEOUT_MS + 1000]);
    expect(carouselExpiries(s, at(13))).toEqual([]);
    expect(carouselExpiries(null, at(12))).toEqual([]);
  });

  it('round-trips through JSON; garbage is null', () => {
    const s = tapCarousel(null, { day: -1, medium: 2 }, at(12));
    expect(parseCarousel(JSON.stringify(s))).toEqual(s);
    expect(parseCarousel('nope')).toBeNull();
    expect(parseCarousel(null)).toBeNull();
    expect(parseCarousel('7')).toBeNull();
  });
});
