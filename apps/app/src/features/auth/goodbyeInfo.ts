import { useSyncExternalStore } from 'react';

/**
 * What the goodbye screen needs after the session is gone. Held in memory
 * (not in the URL) and lost on reload, in which case Goodbye is generic.
 */
let info: { name: string | null } = { name: null };

// True from a successful delete until Done is pressed. The root layout only
// registers the goodbye route while this is set (or the user is signed out),
// so a signed-in user whose route is hidden never falls back onto it.
let pending = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const setGoodbyeInfo = (next: { name: string | null }): void => {
  info = next;
  pending = true;
  emit();
};

export const clearGoodbyeInfo = (): void => {
  info = { name: null };
  pending = false;
  emit();
};

export const getGoodbyeInfo = (): { name: string | null } => info;

/** Whether an account was just deleted and Goodbye has not been dismissed. */
export function useGoodbyePending(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => false,
  );
}

/** "Sam Rivera" -> "Sam" */
export const firstName = (name: string | null | undefined): string | null => {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || null;
};
