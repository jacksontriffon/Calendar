import { describe, expect, it } from 'vitest';
import { ALIAS, DEFCATS, DUR, HUES, SPARE, defaultCats, hueFor, matchCat, normCat, spareHue, wordRx } from '../src/index.ts';

describe('default categories', () => {
  it('Work, Food, Health, Family, Social, Routine, Pets with the prototype hues', () => {
    expect([...DEFCATS]).toEqual(['Work', 'Food', 'Health', 'Family', 'Social', 'Routine', 'Pets']);
    expect(defaultCats()).toEqual({ Work: 255, Food: 72, Health: 132, Family: 28, Social: 12, Routine: 104, Pets: 166 });
  });
  it('returns a fresh copy each time', () => {
    const a = defaultCats();
    a.Work = 1;
    expect(defaultCats().Work).toBe(255);
  });
  it('default durations', () => expect(DUR).toEqual({ Work: 60, Food: 45, Health: 60, Family: 90, Social: 120, Routine: 30, Pets: 40 }));
});

describe('hues', () => {
  it('hueFor: user hue, then built-in, then 30', () => {
    expect(hueFor({ Work: 240 }, 'Work')).toBe(240);
    expect(hueFor({}, 'Work')).toBe(HUES.Work);
    expect(hueFor({}, 'Gym')).toBe(132);
    expect(hueFor({}, 'Unheard of')).toBe(30);
  });
  it('is not fooled by Object.prototype names', () => {
    expect(hueFor({}, 'constructor')).toBe(30);
    expect(hueFor({}, 'toString')).toBe(30);
  });
  it('spareHue picks the first unused', () => {
    expect(spareHue({})).toBe(SPARE[0]);
    expect(spareHue({ a: 350, b: 170 })).toBe(290);
    expect(spareHue(Object.fromEntries(SPARE.map((h, i) => ['c' + i, h])))).toBeUndefined();
  });
});

describe('normCat', () => {
  it('folds aliases into the default buckets', () => {
    expect(normCat('Lunch')).toBe('Food');
    expect(normCat('lunch')).toBe('Food');
    expect(normCat('GYM')).toBe('Health');
    expect(normCat('Dog walk')).toBe('Pets');
    expect(normCat('Meetings')).toBe('Work');
    expect(normCat('Travel')).toBe('Routine');
    expect(normCat('Friends')).toBe('Social');
    expect(normCat('Kids')).toBe('Family');
  });
  it('quirk: Routine itself folds to Health (user categories are matched before aliasing)', () => {
    expect(ALIAS.Routine).toBe('Health');
    expect(normCat('Routine')).toBe('Health');
  });
  it('passes through unknown names and null/undefined', () => {
    expect(normCat('Origami')).toBe('Origami');
    expect(normCat(null)).toBeNull();
    expect(normCat(undefined)).toBeUndefined();
    expect(normCat('constructor')).toBe('constructor');
  });
});

describe('wordRx / matchCat', () => {
  it('matches whole words with simple suffixes', () => {
    const rx = wordRx('run');
    expect(rx.test(' run ')).toBe(true);
    expect(rx.test(' running ')).toBe(false); // "running" is its own keyword; suffixes are only s/es/ing/ed/d
    expect(wordRx('walk').test(' walking ')).toBe(true);
    expect(rx.test(' runs ')).toBe(true);
    expect(rx.test(' prune ')).toBe(false);
    expect(wordRx('stand-up').test(' stand up ')).toBe(true);
    expect(wordRx('1:1').test(' 1:1 with sam ')).toBe(true);
  });
  it('keyword table assigns a default category', () => {
    expect(matchCat('gym with dan', [])).toBe('Health');
    expect(matchCat('lunch', [])).toBe('Food');
    expect(matchCat('walk the dog', [])).toBe('Pets');
    expect(matchCat('standup', [])).toBe('Work');
    expect(matchCat('mum', [])).toBe('Family');
    expect(matchCat('call mum', [])).toBe('Work'); // "call" is longer than "mum"
    expect(matchCat('call home', [])).toBe('Family');
    expect(matchCat('pick up parcel', [])).toBe('Routine');
    expect(matchCat('drinks with friends', [])).toBe('Social');
    expect(matchCat('zzz qqq', [])).toBeNull();
  });
  it('the longest phrase wins over a shorter one', () => {
    // "dinner with" (Social) is longer than "dinner" (Food)
    expect(matchCat('dinner with sam', [])).toBe('Social');
    expect(matchCat('dinner', [])).toBe('Food');
  });
  it("the user's own categories come first", () => {
    expect(matchCat('novel writing', ['Novel'])).toBe('Novel');
    expect(matchCat('gym', ['Gym'])).toBe('Gym');
    expect(matchCat('gym', [])).toBe('Health');
  });
});
