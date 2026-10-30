/**
 * The widget clock follows the device's 12/24-hour setting (open question 6;
 * the app has no preference of its own yet). `expo-localization` reads it from
 * the OS, and `getCalendars()` is cheap, so this is re-read on every write.
 */
import { getCalendars } from 'expo-localization';

import type { Clock } from './types';

export function deviceClock(): Clock {
  try {
    return getCalendars()[0]?.uses24hourClock ? '24h' : '12h';
  } catch {
    return '12h';
  }
}
