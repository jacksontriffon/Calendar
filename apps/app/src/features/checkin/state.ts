/**
 * Device-local "last seen / last check-in" stamps (the prototype's `aical.seen`,
 * `aical.ci`, `aical.win` localStorage keys). They are per-device on purpose and
 * never synced. Persisted to localStorage on web; in memory on native until the
 * app has a device key-value store (MMKV arrives with the sync layer).
 */
import { key } from '@calendar/core';

const mem: Record<string, string> = {};

function read(k: string): string {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) return ls.getItem(k) ?? mem[k] ?? '';
  } catch {
    /* blocked storage */
  }
  return mem[k] ?? '';
}

function write(k: string, v: string): void {
  mem[k] = v;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(k, v);
  } catch {
    /* blocked storage */
  }
}

export const deviceGet = read;
export const deviceSet = write;

const SEEN = 'aical.seen';
const CI = 'aical.ci';
const WIN = 'aical.win';

/** Epoch ms the user last looked at the calendar (0 when never). */
export const getLastSeen = (): number => Number(read(SEEN)) || 0;
export const stampSeen = (now = Date.now()): void => write(SEEN, String(now));
export const getLastCheckIn = (): number => Number(read(CI)) || 0;
export const stampCheckIn = (now = Date.now()): void => write(CI, String(now));
/** Day key a win check-in last ran, or ''. */
export const getLastWinDay = (): string => read(WIN);
export const stampWinDay = (today: Date): void => write(WIN, key(today));
