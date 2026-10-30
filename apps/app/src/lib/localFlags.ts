/**
 * Tiny per-install key/value flags (AsyncStorage on native, localStorage on
 * web). Deliberately NOT SecureStore: iOS keychain items survive an app
 * reinstall, and these flags mean "this install has done X".
 *
 * Storage can throw or come back empty (private windows, cleared data), so
 * every read and write is wrapped and callers must work without it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'calendar.flag.';

export const FLAGS = {
  /** The Welcome intro animation has played on this install. */
  welcomePlayed: 'welcome.played',
  /** Provider of the last successful sign-in ('apple' | 'google'): the re-sign-in sheet lists it first. */
  lastProvider: 'auth.lastProvider',
} as const;

export async function getFlag(name: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

export async function setFlag(name: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + name, value);
  } catch {
    // Not persisted: the flag just won't survive a relaunch.
  }
}

export async function clearFlag(name: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + name);
  } catch {
    // ignore
  }
}
