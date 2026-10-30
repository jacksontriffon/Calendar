/**
 * Categories: default set, hues, alias folding and the offline keyword matcher.
 * Ported from the prototype's top-level constants.
 */
import { cap } from './time.ts';

/** category name -> hue (an `SWATCH` key; see tokens.ts). Insertion order is display order. */
export type CatMap = Record<string, number>;

export const DEFCATS = ['Work', 'Food', 'Health', 'Family', 'Social', 'Routine', 'Pets'] as const;

/** Prototype hues for the default categories plus legacy/colloquial names. */
export const HUES: Record<string, number> = {
  Work: 255, Food: 72, Health: 132, Family: 28, Social: 12, Routine: 104, Pets: 166,
  Focus: 255, Rest: 132, Lunch: 72, Dinner: 72, Errands: 104, 'Dog walk': 166, Reading: 132, Gym: 132,
  Travel: 104, Admin: 104, Other: 48,
};

/** Hues handed out to new categories/goals in order, first one not already in use. */
export const SPARE = [350, 170, 290, 60, 240, 125, 28, 1000] as const;

/** Default duration (minutes) per default category. */
export const DUR: Record<string, number> = { Work: 60, Food: 45, Health: 60, Family: 90, Social: 120, Routine: 30, Pets: 40 };

/* Own-property lookup: the prototype indexed plain objects directly, which
   makes a category literally named "constructor" resolve to a function. */
const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

/** The user's hue for a category, if it exists in the map (own properties only). */
export const catHue = (cats: CatMap, cat: string): number | undefined => own(cats, cat);

/** Default duration in minutes for a category's events (`DUR`), if it has one. */
export const defaultDur = (cat: string): number | undefined => own(DUR, cat);

/** Hue for a category name in `HUES`, if it has a built-in one. */
export const builtinHue = (cat: string): number | undefined => own(HUES, cat);

/** A fresh copy of the default categories with the prototype's hues. */
export const defaultCats = (): CatMap => {
  const out: CatMap = {};
  DEFCATS.forEach((k) => { out[k] = HUES[k]; });
  return out;
};

/** Hue for `cat`: the user's own, else the built-in, else 30. */
export const hueFor = (cats: CatMap, cat: string): number => {
  const u = own(cats, cat);
  if (u != null) return u;
  const b = own(HUES, cat);
  return b != null ? b : 30;
};

/** First spare hue not used by any category (undefined once all are taken). */
export const spareHue = (cats: CatMap): number | undefined => {
  const used = Object.keys(cats).map((k) => cats[k]);
  return SPARE.find((x) => used.indexOf(x) < 0);
};

/** Legacy / colloquial names fold into the seven buckets. */
export const ALIAS: Record<string, string> = {
  Lunch: 'Food', Dinner: 'Food', Breakfast: 'Food', Brunch: 'Food', Coffee: 'Food', Meals: 'Food',
  Gym: 'Health', Exercise: 'Health', Fitness: 'Health', Workout: 'Health', Sport: 'Health', Sports: 'Health',
  Reading: 'Health', Routine: 'Health', Sleep: 'Health', Downtime: 'Health', Break: 'Health', Rest: 'Health',
  Focus: 'Work', Study: 'Work',
  Travel: 'Routine', Commute: 'Routine', Admin: 'Routine', Chores: 'Routine', Shopping: 'Routine', Errand: 'Routine', Errands: 'Routine',
  'Dog walk': 'Pets', Dog: 'Pets', Cat: 'Pets', Walkies: 'Pets', Kids: 'Family', Meetings: 'Work', Meeting: 'Work', Calls: 'Work',
  Deep: 'Work', 'Deep work': 'Work', Friends: 'Social',
};

/** Offline matcher keywords per default category. */
export const KEYS: Record<string, string[]> = {
  Work: ['work', 'working', 'job', 'shift', 'meeting', 'meet', 'standup', 'stand-up', 'sync', 'huddle', '1:1', 'one-on-one', 'call', 'zoom', 'interview', 'client', 'customer', 'stakeholder', 'demo', 'presentation', 'present', 'deck', 'slides', 'email', 'inbox', 'slack', 'review', 'pr', 'retro', 'sprint', 'planning', 'kickoff', 'offsite', 'office', 'deploy', 'ship', 'launch', 'report', 'standup call', 'check-in', 'focus', 'deep work', 'write', 'writing', 'draft', 'design', 'build', 'code', 'coding', 'prototype', 'study', 'studying', 'research', 'homework', 'revise', 'thesis', 'essay', 'course', 'lecture', 'class', 'exam', 'brainstorm'],
  Food: ['eat', 'eating', 'breakfast', 'brunch', 'lunch', 'dinner', 'supper', 'snack', 'coffee', 'tea', 'cafe', 'restaurant', 'takeout', 'takeaway', 'cook', 'cooking', 'bake', 'baking', 'meal', 'meal prep', 'lunchtime', 'pizza', 'sushi', 'bbq', 'reservation', 'table for'],
  Health: ['gym', 'workout', 'work out', 'run', 'running', 'jog', 'jogging', 'lift', 'lifting', 'weights', 'yoga', 'pilates', 'swim', 'swimming', 'cycle', 'cycling', 'spin', 'ride', 'hike', 'hiking', 'stretch', 'physio', 'therapy', 'therapist', 'doctor', 'dentist', 'clinic', 'meds', 'medication', 'vitamins', 'check up', 'rest', 'break', 'nap', 'sleep', 'bed', 'bedtime', 'wind down', 'relax', 'chill', 'read', 'reading', 'book', 'chapter', 'kindle', 'journal', 'meditate', 'meditation', 'shower', 'bath', 'downtime', 'tv', 'movie', 'film', 'series', 'podcast', 'music', 'hobby'],
  Family: ['family', 'mum', 'mom', 'dad', 'mother', 'father', 'parents', 'sister', 'brother', 'kid', 'kids', 'son', 'daughter', 'baby', 'grandma', 'grandpa', 'in-laws', 'wife', 'husband', 'partner', 'anniversary', 'call home', 'school run'],
  Pets: ['pet', 'pets', 'dog', 'dogs', 'puppy', 'dog walk', 'walk the dog', 'walkies', 'cat', 'cats', 'kitten', 'vet', 'groomer', 'grooming', 'litter', 'feed the dog', 'feed the cat', 'kennel', 'fetch', 'leash', 'rabbit', 'hamster', 'fish tank', 'aquarium', 'birdcage'],
  Social: ['friend', 'friends', 'drinks', 'beers', 'pub', 'bar', 'party', 'birthday', 'date', 'date night', 'catch up', 'catchup', 'hang out', 'hangout', 'wedding', 'concert', 'gig', 'meetup', 'game night', 'dinner with', 'lunch with', 'coffee with', 'drinks with', 'visit', 'housewarming'],
  Routine: ['errand', 'errands', 'bank', 'post office', 'post', 'package', 'parcel', 'pharmacy', 'chemist', 'shop', 'shopping', 'store', 'groceries', 'grocery', 'market', 'laundry', 'dishes', 'tidy', 'clean', 'cleaning', 'chores', 'bins', 'trash', 'haircut', 'barber', 'dry clean', 'car', 'mot', 'repair', 'insurance', 'renew', 'dmv', 'appointment', 'admin', 'tax', 'taxes', 'invoice', 'bills', 'budget', 'paperwork', 'forms', 'pick up', 'drop off', 'commute', 'drive', 'driving', 'train', 'flight', 'fly', 'airport', 'bus', 'taxi', 'uber', 'travel', 'trip', 'pack', 'packing'],
};

/** Words the offline parser skips when guessing a category from a title. */
export const STOP = ['do', 'go', 'going', 'the', 'a', 'an', 'my', 'some', 'finish', 'finished', 'start', 'edit', 'make', 'write', 'call', 'meet', 'take', 'get', 'got', 'have', 'then', 'and', 'of', 'with', 'without', 'for', 'to', 'at', 'on', 'in', 'up', 'out', 'more', 'again', 'quick', 'quickly', 'new', 'bit', 'little', 'all', 'about', 'around', 'need', 'needs', 'must', 'should', 'maybe', 'try', 'sort', 'stuff', 'thing', 'things'];

/** Named times of day (minutes) the offline parser understands. */
export const WORDT: Record<string, number> = {
  noon: 720, midday: 720, midnight: 0, morning: 540, afternoon: 840, evening: 1140,
  tonight: 1200, night: 1260, lunchtime: 780, dawn: 360, 'first thing': 480,
};

export const rxEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word (with simple plural/tense suffixes) matcher; spaces and hyphens are interchangeable. */
export const wordRx = (w: string): RegExp =>
  new RegExp('(?:^|[^a-z0-9])' + rxEsc(String(w).toLowerCase()).replace(/[\s\-]+/g, '[\\s\\-]+') + '(?:s|es|ing|ed|d)?(?:[^a-z0-9]|$)', 'i');

interface CatRx { cat: string; n: number; rx: RegExp }
let CATRX: CatRx[] | null = null;
/* Built on first use, longest phrase first (stable sort keeps table order for ties). */
const catRx = (): CatRx[] => {
  if (CATRX) return CATRX;
  const list: CatRx[] = [];
  Object.keys(KEYS).forEach((k) => KEYS[k].forEach((w) => list.push({ cat: k, n: w.length, rx: wordRx(w) })));
  list.sort((a, b) => b.n - a.n);
  return (CATRX = list);
};

/** Fold a legacy/colloquial category name into one of the default buckets. */
export const normCat = <T extends string | null | undefined>(c: T): T | string => {
  if (c == null) return c;
  return own(ALIAS, c) || own(ALIAS, cap(String(c).toLowerCase())) || c;
};

/**
 * Longest phrase wins: the user's own category names first, then the keyword
 * table. Returns null when nothing matches.
 */
export const matchCat = (title: string, known: readonly string[]): string | null => {
  const t = ' ' + String(title).toLowerCase() + ' ';
  let best: string | null = null;
  let bn = 0;
  known.forEach((k) => {
    if (k.length > bn && wordRx(k).test(t)) { best = k; bn = k.length; }
  });
  if (best) return best;
  const list = catRx();
  for (let i = 0; i < list.length; i++) if (list[i].rx.test(t)) return list[i].cat;
  return null;
};
