/**
 * Where a signed-in user goes next. Decided from the profile row, so it
 * survives restarts and works across devices:
 *
 *   loading     the profile hasn't arrived yet
 *   error       it couldn't be loaded (offline on a cold start, say)
 *   import      `prefs.legacyImport` is unset: ask the server to import the old web calendar (OA 3)
 *   onboarding  `prefs.onboarded` is unset: first-run setup (OA 2)
 *   app         the calendar
 *
 * A returning web user with an old calendar skips setup: the import screen
 * writes `onboarded` along with its own flag.
 */
import { readEntryPrefs } from '@/features/auth/entryPrefs';
import type { ProfileRow } from '@/features/auth/profile';
import type { AuthStatus, ProfileState } from '@/features/auth/session';

export type EntryStage = 'loading' | 'error' | 'import' | 'onboarding' | 'app';

export function decideEntryStage(args: {
  status: AuthStatus;
  profileState: ProfileState;
  profile: ProfileRow | null;
}): EntryStage {
  const { status, profileState, profile } = args;
  if (status === 'loading' || status === 'signedOut') return 'loading';
  if (!profile) return profileState === 'error' ? 'error' : 'loading';
  const prefs = readEntryPrefs(profile.prefs);
  if (!prefs.legacyImport) return 'import';
  if (!prefs.onboarded) return 'onboarding';
  return 'app';
}
