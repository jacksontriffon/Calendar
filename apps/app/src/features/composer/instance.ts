/**
 * The one composer the app runs: `createComposer` wired to the real store, toast, Supabase
 * transport and clock. Screens import `composer` (and `useComposer`) from here.
 */
import { useSyncExternalStore } from 'react';

import { showToast } from '@/components/toast';
import { detectTimeZone } from '@/lib/tz';
import { getStore } from '@/store';
import { callAi } from '../ai/client';
import { setAiHighlight } from '../ai/highlight';
import { supabaseInvoker } from '../ai/invoker';
import { recordUsage } from '../ai/usage';
import { openRecap } from '../story/StoryHost';
import { createComposer, fetchCheckInQuestions, type ComposerDeps, type ComposerState } from './controller';

let profileTz: string | null = null;
/** The signed-in profile's zone (the Composer component keeps it current); the device's is the fallback. */
export const setProfileTimeZone = (tz: string | null | undefined): void => {
  profileTz = tz || null;
};

export const clockNow = (): { today: Date; nowMin: number; nowMs: number } => {
  const n = new Date();
  return { today: new Date(n.getFullYear(), n.getMonth(), n.getDate()), nowMin: n.getHours() * 60 + n.getMinutes(), nowMs: n.getTime() };
};

export const realDeps: ComposerDeps = {
  getData: () => getStore().getState().data,
  getPrefs: () => getStore().getState().prefs,
  applyResult: (r) => getStore().applyResult(r),
  newId: () => getStore().newId(),
  now: clockNow,
  tz: () => profileTz ?? detectTimeZone(),
  call: (req) => callAi(req, { invoke: supabaseInvoker }),
  toast: (t) => {
    showToast(t);
  },
  recordUsage,
  highlight: setAiHighlight,
  openRecap,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
};

export const composer = createComposer(realDeps);

export const useComposer = (): ComposerState =>
  useSyncExternalStore(composer.subscribe, composer.getState, composer.getState);

/** Check-in questions from Claude, or null to use the local ones. */
export const aiCheckInQuestions = (lastSeen: number) => fetchCheckInQuestions(realDeps, lastSeen);
