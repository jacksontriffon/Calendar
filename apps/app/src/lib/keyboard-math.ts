/**
 * Soft-keyboard maths, kept pure (and marked as worklets, so the animated styles can call them on
 * the UI thread) so it can be unit tested without a device. `useKeyboardLift` feeds it the raw
 * keyboard events.
 *
 * "Lift" is the distance from the window's bottom edge up to the top of the keyboard, in points.
 */

/** Gap kept between the composer bar and whatever it sits on (the keyboard, or the home indicator). */
export const COMPOSER_GAP = 14;

export interface KeyboardFrame {
  /** top edge of the keyboard (screen coordinates) */
  screenY: number;
  height: number;
}

interface LiftInput extends KeyboardFrame {
  platform: string;
  /** full screen height; with `screenY` it tells a docked keyboard from a floating one */
  screenHeight: number;
  /** safe-area bottom inset (home indicator / navigation bar) */
  insetBottom: number;
}

/**
 * How far the keyboard covers the bottom of the window.
 *
 * - iOS reports the frame from the keyboard's top to the screen bottom (the home-indicator strip
 *   included). A hide event comes with `screenY` at the screen bottom, so the overlap is 0; a
 *   floating or undocked iPad keyboard never reaches the bottom, so it does not lift anything.
 * - Android (edge-to-edge) reports `ime.bottom - systemBars.bottom`: the navigation-bar strip is
 *   left out, so it is added back. `screenY` is not reliable there and is not used.
 * - Web needs nothing.
 */
export function keyboardLift({ platform, screenY, height, screenHeight, insetBottom }: LiftInput): number {
  if (!(height > 0)) return 0;
  if (platform === 'android') return height + Math.max(0, insetBottom);
  if (platform === 'ios') {
    if (screenY + height < screenHeight - 1) return 0;
    return Math.min(height, Math.max(0, screenHeight - screenY));
  }
  return 0;
}

/**
 * How far to raise the bottom column. The column already has `insetBottom` of padding under it, so
 * once the keyboard is up that inset is dropped (it would be a dead gap above the keyboard): the
 * column rises by the lift minus the inset, which leaves `COMPOSER_GAP` between it and the keyboard.
 * Never negative, so the column does not sink while the keyboard is still animating in.
 */
export function keyboardShift(lift: number, insetBottom: number): number {
  'worklet';
  return Math.max(0, lift - Math.max(0, insetBottom));
}

/** The padding under the bottom column at rest: the home-indicator inset plus the gap. */
export function columnPaddingBottom(insetBottom: number): number {
  return Math.max(0, insetBottom) + COMPOSER_GAP;
}

/**
 * Room left for a panel stacked on the composer (the question sheet) while the keyboard is open:
 * the window minus the keyboard, the status bar and the chrome that sits with it (composer bar,
 * goal chips). `fraction` is the share of the window it normally gets; the panel never grows past it.
 */
export function maxAboveKeyboard(winH: number, fraction: number, lift: number, insetTop: number, reserved: number): number {
  const normal = winH * fraction;
  if (lift <= 0) return normal;
  return Math.max(0, Math.min(normal, winH - lift - insetTop - reserved));
}
