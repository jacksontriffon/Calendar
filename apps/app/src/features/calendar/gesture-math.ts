/**
 * Gesture -> time maths, kept pure (and marked as worklets) so the Gesture
 * Handler callbacks can call them on the UI thread and jest can test them.
 */
import { ZLEVELS } from '@calendar/core';

/* Worklet-safe copies of core's clamp / snapTo / zNear: functions imported from
   another module can't be called on the UI thread unless they are worklets. */
const clamp = (v: number, a: number, b: number): number => {
  'worklet';
  return Math.max(a, Math.min(b, v));
};
const snapTo = (m: number, step: number): number => {
  'worklet';
  return Math.round(m / step) * step;
};
const zNear = (z: number): number => {
  'worklet';
  let best = ZLEVELS[0] as number;
  for (let i = 1; i < ZLEVELS.length; i++) if (Math.abs(ZLEVELS[i] - z) < Math.abs(best - z)) best = ZLEVELS[i];
  return best;
};

export type DragMode = 'move' | 'top' | 'bottom';

export interface DragOrigin {
  start: number;
  end: number;
  /** column index the event started in */
  dayIdx: number;
}

export interface DragResult { start: number; end: number; dayIdx: number }

/**
 * Where a drag ends up. `dy` / `dx` are the finger's translation in px; the
 * time moves in `step` minutes (core `stepFor(zoom)`): move shifts the whole
 * event (and can change day), top/bottom resize one edge. Minimum length is one step.
 */
export function dragOutcome(
  mode: DragMode, o: DragOrigin, dy: number, dx: number, hourH: number, colW: number, nCols: number, step: number,
): DragResult {
  'worklet';
  const dm = snapTo((dy / hourH) * 60, step);
  if (mode === 'move') {
    const len = o.end - o.start;
    const start = clamp(snapTo(o.start + dm, step), 0, 1440 - step);
    const dayIdx = clamp(Math.round(o.dayIdx + dx / colW), 0, nCols - 1);
    return { start, end: start + len, dayIdx };
  }
  if (mode === 'top') {
    const start = clamp(snapTo(o.start + dm, step), 0, Math.min(o.end - step, 1440 - step));
    return { start, end: o.end, dayIdx: o.dayIdx };
  }
  const end = clamp(snapTo(o.end + dm, step), o.start + step, o.start + 1440);
  return { start: o.start, end, dayIdx: o.dayIdx };
}

/** The history label a finished drag gets ("Moved · X" / "Retimed · X"). */
export const dragLabel = (mode: DragMode, title: string): string =>
  (mode === 'move' ? 'Moved · ' : 'Retimed · ') + (title || 'event');

/** True when the drag changed anything (otherwise nothing is committed). */
export const dragChanged = (o: DragOrigin, r: DragResult): boolean => o.start !== r.start || o.end !== r.end || o.dayIdx !== r.dayIdx;

/** Pinch: 1 / -1 when the finger gap has changed by more than 1.45x, else 0. */
export function pinchStep(ratio: number): 1 | -1 | 0 {
  'worklet';
  return ratio > 1.45 ? 1 : ratio < 1 / 1.45 ? -1 : 0;
}

/** The zoom level `dir` steps from `cur`, clamped to the available levels. */
export function stepZoom(cur: number, dir: number): number {
  'worklet';
  const i = clamp((ZLEVELS as readonly number[]).indexOf(zNear(cur)) + dir, 0, ZLEVELS.length - 1);
  return ZLEVELS[i];
}

/** Zoom label shown while pinching: "Default", "+70%", "−60%". */
export const zoomLabel = (z: number): string =>
  z === 1 ? 'Default' : (z > 1 ? '+' : '−') + Math.round(Math.abs(z - 1) * 100) + '%';

/** Horizontal swipe: the page offset while dragging, and whether releasing navigates. */
export function swipeOffset(dx: number): number {
  'worklet';
  return Math.sign(dx) * Math.min(Math.abs(dx) * 0.62, 98);
}
export function swipeDir(dx: number): 1 | -1 | 0 {
  'worklet';
  return Math.abs(dx) > 48 ? (dx < 0 ? 1 : -1) : 0;
}

/** Scroll offset that keeps the hour under the pinch focus in place when the scale changes. */
export function anchoredScroll(anchorHour: number, focusY: number, newHourH: number): number {
  'worklet';
  return Math.max(0, anchorHour * newHourH - focusY);
}
