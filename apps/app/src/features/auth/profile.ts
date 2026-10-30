/**
 * `profiles` access for the entry flow: display name, time zone and the
 * `prefs` flags this phase owns (`onboarded`, `legacyImport`).
 *
 * `profiles.prefs` is one jsonb object shared with the calendar settings
 * (view, font, zoom, sun, ai), so writes merge into the current value rather
 * than replace it.
 */
import type { Json, Profile } from '@calendar/db';

import { supabase } from '@/lib/supabase';

import { asPrefs, type PrefsObject } from './entryPrefs';

export { asPrefs, readEntryPrefs } from './entryPrefs';
export type { EntryPrefs, LegacyImportRecord, PrefsObject } from './entryPrefs';

export type ProfileRow = Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'tz' | 'prefs'>;

const COLUMNS = 'id, display_name, avatar_url, tz, prefs';

export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The profile row, created if missing. The `handle_new_user` trigger makes it
 * at sign-up, so a miss only happens for accounts that pre-date the trigger.
 */
export async function ensureProfile(userId: string): Promise<ProfileRow> {
  const existing = await fetchProfile(userId);
  if (existing) return existing;
  const { data, error } = await supabase.from('profiles').insert({ id: userId }).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateProfileFields(
  userId: string,
  patch: { display_name?: string | null; tz?: string },
): Promise<ProfileRow> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Merge `patch` into `profiles.prefs` (read, merge, write) and return the new row. */
export async function mergeProfilePrefs(userId: string, patch: PrefsObject): Promise<ProfileRow> {
  const current = await fetchProfile(userId);
  if (!current) throw new Error('Profile not found');
  const prefs: PrefsObject = { ...asPrefs(current.prefs), ...patch };
  const { data, error } = await supabase
    .from('profiles')
    .update({ prefs: prefs as NonNullable<Json> })
    .eq('id', userId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data;
}
