import { readEntryPrefs } from '@/features/auth/entryPrefs';
import { initials } from '@/features/auth/initials';

import { decideEntryStage } from './entry';
import { parseLegacyImport, summarizeCounts, failureDetail } from './legacyImport';
import {
  advance,
  chooseCalendars,
  currentStep,
  initialSetup,
  profilePatch,
  progressSegments,
  setName,
  skip,
  stepLabel,
  stepsFor,
} from './steps';

const start = (platform = 'ios') => initialSetup({ name: ' Sam Rivera ', tz: 'America/Los_Angeles', platform });

describe('setup steps', () => {
  it('has three steps on a phone and two on web', () => {
    expect(stepsFor('ios')).toEqual(['you', 'calendars', 'notifications']);
    expect(stepsFor('android')).toEqual(['you', 'calendars', 'notifications']);
    expect(stepsFor('web')).toEqual(['you', 'calendars']);
  });

  it('starts on "you" with the provider name trimmed and the detected zone', () => {
    const s = start();
    expect(currentStep(s)).toBe('you');
    expect(s.name).toBe('Sam Rivera');
    expect(s.tz).toBe('America/Los_Angeles');
    expect(stepLabel(s)).toBe('Step 1 of 3 · You');
    expect(progressSegments(s)).toEqual([true, false, false]);
  });

  it('advances one step at a time and finishes after the last', () => {
    let s = start();
    s = advance(s);
    expect(stepLabel(s)).toBe('Step 2 of 3 · Calendars');
    expect(progressSegments(s)).toEqual([true, true, false]);
    s = advance(s);
    expect(currentStep(s)).toBe('notifications');
    expect(s.finished).toBe(false);
    s = advance(s);
    expect(s.finished).toBe(true);
    expect(advance(s)).toBe(s);
  });

  it('every step is skippable and records what was skipped', () => {
    let s = skip(start());
    expect(currentStep(s)).toBe('calendars');
    s = skip(s);
    expect(s.calendars).toBe('skipped');
    expect(currentStep(s)).toBe('notifications');
    s = skip(s);
    expect(s.notifications).toBe('skipped');
    expect(s.finished).toBe(true);
  });

  it('skipping after choosing keeps the choice', () => {
    let s = chooseCalendars(advance(start()), 'google');
    s = skip(s);
    expect(s.calendars).toBe('google');
  });

  it('web finishes after calendars', () => {
    let s = start('web');
    s = advance(advance(s));
    expect(s.finished).toBe(true);
  });

  it('profile patch skips a blank name but always writes the zone', () => {
    expect(profilePatch(start())).toEqual({ display_name: 'Sam Rivera', tz: 'America/Los_Angeles' });
    expect(profilePatch(setName(start(), '   '))).toEqual({ tz: 'America/Los_Angeles' });
  });
});

describe('entry stage', () => {
  const profile = (prefs: object) => ({ id: 'u', display_name: null, avatar_url: null, tz: 'UTC', prefs }) as never;
  const stage = (over: object) => decideEntryStage({ status: 'signedIn', profileState: 'ready', profile: profile({}), ...over } as never);

  it('waits for the profile, and reports a failed load', () => {
    expect(stage({ profile: null, profileState: 'loading' })).toBe('loading');
    expect(stage({ profile: null, profileState: 'error' })).toBe('error');
    expect(stage({ status: 'signedOut', profile: null })).toBe('loading');
  });

  it('import first, then setup, then the app', () => {
    expect(stage({})).toBe('import');
    expect(stage({ profile: profile({ legacyImport: { status: 'none', at: 'x' } }) })).toBe('onboarding');
    expect(stage({ profile: profile({ legacyImport: { status: 'none', at: 'x' }, onboarded: true }) })).toBe('app');
  });

  it('a skipped import counts as done; an imported one with onboarded goes straight in', () => {
    expect(stage({ profile: profile({ legacyImport: { status: 'skipped', at: 'x' } }) })).toBe('onboarding');
    expect(stage({ profile: profile({ legacyImport: { status: 'imported', at: 'x' }, onboarded: true }) })).toBe('app');
  });

  it('keeps the app mounted while the session is expired', () => {
    expect(stage({ status: 'expired', profile: profile({ legacyImport: { status: 'none', at: 'x' }, onboarded: true }) })).toBe('app');
  });

  it('ignores prefs of the wrong shape', () => {
    expect(readEntryPrefs({ onboarded: 'yes', legacyImport: { status: 'weird' } })).toEqual({});
    expect(readEntryPrefs(null)).toEqual({});
    expect(readEntryPrefs({ onboarded: true, view: 'day3' })).toEqual({ onboarded: true });
  });
});

describe('legacy-import response', () => {
  it('none means skip silently', () => {
    expect(parseLegacyImport({ status: 'none' })).toEqual({ kind: 'none' });
    expect(parseLegacyImport({ status: 'NONE' })).toEqual({ kind: 'none' });
  });

  it('reads counts nested or top-level', () => {
    expect(parseLegacyImport({ status: 'ok', counts: { events: 142, goals: 6, categories: 9 } })).toEqual({
      kind: 'imported',
      counts: { events: 142, goals: 6, categories: 9 },
      lastSaved: undefined,
    });
    expect(parseLegacyImport({ status: 'imported', events: 3, goals: 0, categories: 2, lastSaved: 'Oct 29' })).toEqual({
      kind: 'imported',
      counts: { events: 3, goals: 0, categories: 2 },
      lastSaved: 'Oct 29',
    });
  });

  it('errors and unreadable bodies are errors', () => {
    expect(parseLegacyImport({ status: 'error', ref: '8f2a1c', stage: 'goals' })).toEqual({ kind: 'error', ref: '8f2a1c', stage: 'goals' });
    expect(parseLegacyImport({ error: 'boom' })).toEqual({ kind: 'error', ref: undefined, stage: undefined });
    expect(parseLegacyImport(null)).toEqual({ kind: 'error' });
    expect(parseLegacyImport('nope')).toEqual({ kind: 'error' });
  });

  it('words the summary and failure', () => {
    expect(summarizeCounts({ events: 142, goals: 6, categories: 9 })).toBe('142 events, 6 goals, 9 categories came over from the web app.');
    expect(summarizeCounts({ events: 1, goals: 1, categories: 1 })).toBe('1 event, 1 goal, 1 category came over from the web app.');
    expect(failureDetail('goals')).toBe('It stopped while copying goals. Nothing was lost, and your web calendar is untouched.');
    expect(failureDetail()).toBe('Nothing was lost, and your web calendar is untouched.');
  });
});

describe('initials', () => {
  it('takes two letters', () => {
    expect(initials('Sam Rivera')).toBe('SR');
    expect(initials('sam')).toBe('SA');
    expect(initials('Mary Jane Watson')).toBe('MW');
    expect(initials('sam.rivera@gmail.com')).toBe('SR');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});
