/**
 * The composer bar's measured height, so cards that sit above it (the check-in) clear it however
 * tall it has grown (multi-line note, one or two rows).
 */
import { useSyncExternalStore } from 'react';

let h = 88;
const subs = new Set<() => void>();

export const setComposerHeight = (next: number): void => {
  const r = Math.round(next);
  if (r === h || r <= 0) return;
  h = r;
  subs.forEach((s) => s());
};

export const useComposerHeight = (): number =>
  useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => {
        subs.delete(l);
      };
    },
    () => h,
    () => h,
  );
