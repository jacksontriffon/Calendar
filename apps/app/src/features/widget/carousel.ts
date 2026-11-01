/**
 * Carousel state for the iPhone Large and Medium widgets (Design Spec WG 1g to
 * 1i, 2i). A widget cannot swipe or scroll, so a tap on a peek, a dot or the
 * goals runs an App Intent (iOS 17) that writes this state to the shared
 * storage and reloads the timeline. The widget reads it back when it draws.
 *
 * Three independent pieces, each with the time of its last tap:
 *  - `day`:    the day the Large widget shows, -1 / 0 / +1 (Yesterday, Today, Tomorrow)
 *  - `large`:  the goal page on Large (two goals a page)
 *  - `medium`: the goal page on Medium (one goal a page)
 *
 * Reset rule (decided with issue 5): each piece goes home (Today, the first goal)
 * 5 minutes after its last tap, and at midnight. Nothing is stored for "home",
 * so an expired piece just reads as 0; the extension adds a timeline entry at
 * the expiry time so the widget redraws at home without anyone tapping.
 *
 * Pure: the Swift extension mirrors this in `Snapshot.swift` (`Carousel`).
 */
import { dayKey } from './labels';

export type DayOffset = -1 | 0 | 1;

/** A tap this old no longer counts. */
export const CAROUSEL_TIMEOUT_MS = 5 * 60000;

/** What is stored: the last value of each piece and when it was set (ISO, UTC). */
export interface CarouselState {
  day: DayOffset;
  dayAt: string;
  large: number;
  largeAt: string;
  medium: number;
  mediumAt: string;
}

/** What the widget draws from. */
export interface Carousel {
  day: DayOffset;
  large: number;
  medium: number;
}

export const HOME: Carousel = { day: 0, large: 0, medium: 0 };

const BLANK: CarouselState = { day: 0, dayAt: '', large: 0, largeAt: '', medium: 0, mediumAt: '' };

/** Set on the same local day as `nowMs`, and no more than the timeout ago (a future stamp, from a clock change, is expired). */
const live = (at: string, nowMs: number): boolean => {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age <= CAROUSEL_TIMEOUT_MS && dayKey(new Date(t)) === dayKey(new Date(nowMs));
};

const page = (n: number): number => (Number.isInteger(n) && n > 0 ? n : 0);

/** The carousels as they read at `nowMs`: stored values that have not expired, home for the rest. */
export function resolveCarousel(state: CarouselState | null | undefined, nowMs: number): Carousel {
  if (!state) return HOME;
  return {
    day: live(state.dayAt, nowMs) && (state.day === -1 || state.day === 1) ? state.day : 0,
    large: live(state.largeAt, nowMs) ? page(state.large) : 0,
    medium: live(state.mediumAt, nowMs) ? page(state.medium) : 0,
  };
}

/** The state after a tap that sets `patch`: the patched pieces are stamped `nowMs`, the others keep their stamps. */
export function tapCarousel(state: CarouselState | null | undefined, patch: Partial<Carousel>, nowMs: number): CarouselState {
  const cur = state ?? BLANK;
  const at = new Date(nowMs).toISOString();
  return {
    day: patch.day ?? cur.day,
    dayAt: patch.day !== undefined ? at : cur.dayAt,
    large: patch.large ?? cur.large,
    largeAt: patch.large !== undefined ? at : cur.largeAt,
    medium: patch.medium ?? cur.medium,
    mediumAt: patch.medium !== undefined ? at : cur.mediumAt,
  };
}

/** The ISO times at which a piece of `state` expires, after `nowMs` (the extension adds a timeline entry at each). */
export function carouselExpiries(state: CarouselState | null | undefined, nowMs: number): number[] {
  if (!state) return [];
  return [state.dayAt, state.largeAt, state.mediumAt]
    .map((at) => Date.parse(at) + CAROUSEL_TIMEOUT_MS + 1000)
    .filter((t) => !Number.isNaN(t) && t > nowMs);
}

/** Parse the stored JSON; null when absent or malformed. */
export function parseCarousel(raw: string | null | undefined): CarouselState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CarouselState> | null;
    if (!v || typeof v !== 'object') return null;
    const str = (x: unknown) => (typeof x === 'string' ? x : '');
    const num = (x: unknown) => (typeof x === 'number' ? x : 0);
    return {
      day: v.day === -1 || v.day === 1 ? v.day : 0,
      dayAt: str(v.dayAt),
      large: num(v.large),
      largeAt: str(v.largeAt),
      medium: num(v.medium),
      mediumAt: str(v.mediumAt),
    };
  } catch {
    return null;
  }
}
