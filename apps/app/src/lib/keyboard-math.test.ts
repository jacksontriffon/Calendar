import { COMPOSER_GAP, columnPaddingBottom, keyboardLift, keyboardShift, maxAboveKeyboard } from './keyboard-math';

const SCREEN = 852;

describe('keyboardLift', () => {
  it('iOS: a docked keyboard lifts by its full height (the home-indicator strip is inside it)', () => {
    expect(keyboardLift({ platform: 'ios', screenY: SCREEN - 336, height: 336, screenHeight: SCREEN, insetBottom: 34 })).toBe(336);
  });

  it('iOS: the hide event (frame below the screen) lifts nothing', () => {
    expect(keyboardLift({ platform: 'ios', screenY: SCREEN, height: 336, screenHeight: SCREEN, insetBottom: 34 })).toBe(0);
  });

  it('iOS: a frame part-way off screen (mid-animation) only counts what overlaps', () => {
    expect(keyboardLift({ platform: 'ios', screenY: SCREEN - 100, height: 336, screenHeight: SCREEN, insetBottom: 34 })).toBe(100);
  });

  it('iOS: a floating or undocked iPad keyboard lifts nothing', () => {
    expect(keyboardLift({ platform: 'ios', screenY: 300, height: 260, screenHeight: 1180, insetBottom: 20 })).toBe(0);
  });

  it('Android: adds the navigation-bar strip that the reported height leaves out', () => {
    // RN reports ime.bottom - systemBars.bottom; the keyboard top is that plus the nav bar above the screen bottom
    expect(keyboardLift({ platform: 'android', screenY: 0, height: 300, screenHeight: 800, insetBottom: 48 })).toBe(348);
    expect(keyboardLift({ platform: 'android', screenY: 0, height: 300, screenHeight: 800, insetBottom: 0 })).toBe(300);
  });

  it('is 0 for a hidden keyboard, a negative inset, and on web', () => {
    expect(keyboardLift({ platform: 'android', screenY: 800, height: 0, screenHeight: 800, insetBottom: 48 })).toBe(0);
    expect(keyboardLift({ platform: 'ios', screenY: SCREEN, height: 0, screenHeight: SCREEN, insetBottom: 34 })).toBe(0);
    expect(keyboardLift({ platform: 'android', screenY: 0, height: 300, screenHeight: 800, insetBottom: -5 })).toBe(300);
    expect(keyboardLift({ platform: 'web', screenY: 0, height: 300, screenHeight: 800, insetBottom: 0 })).toBe(0);
  });
});

describe('keyboardShift', () => {
  it('does not move the column with the keyboard closed', () => {
    expect(keyboardShift(0, 34)).toBe(0);
  });

  it('drops the home-indicator inset once the keyboard is up', () => {
    const inset = 34;
    const lift = 336;
    const shift = keyboardShift(lift, inset);
    expect(shift).toBe(lift - inset);
    // the column keeps its inset + gap of padding; after the shift the gap above the keyboard is just the gap
    expect(columnPaddingBottom(inset) + shift - lift).toBe(COMPOSER_GAP);
  });

  it('leaves the same gap with no inset (Android gesture navigation, older iPhones)', () => {
    expect(columnPaddingBottom(0) + keyboardShift(300, 0) - 300).toBe(COMPOSER_GAP);
  });

  it('never sinks below rest while the keyboard is still animating in', () => {
    expect(keyboardShift(10, 34)).toBe(0);
    expect(keyboardShift(34, 34)).toBe(0);
    expect(keyboardShift(35, 34)).toBe(1);
  });

  it('never leaves the column behind the keyboard at any point of the animation', () => {
    const inset = 34;
    for (let lift = 0; lift <= 336; lift += 7) {
      const bottomOfContent = columnPaddingBottom(inset) + keyboardShift(lift, inset);
      expect(bottomOfContent).toBeGreaterThanOrEqual(lift);
    }
  });
});

describe('columnPaddingBottom', () => {
  it('is the inset plus the gap', () => {
    expect(columnPaddingBottom(34)).toBe(34 + COMPOSER_GAP);
    expect(columnPaddingBottom(0)).toBe(COMPOSER_GAP);
    expect(columnPaddingBottom(-3)).toBe(COMPOSER_GAP);
  });
});

describe('maxAboveKeyboard', () => {
  it('is the normal share of the window with the keyboard closed', () => {
    expect(maxAboveKeyboard(852, 0.52, 0, 59, 200)).toBeCloseTo(443.04);
  });

  it('shrinks to fit between the status bar and the keyboard', () => {
    // 852 - 336 (keyboard) - 59 (status bar) - 200 (composer, chips)
    expect(maxAboveKeyboard(852, 0.52, 336, 59, 200)).toBe(257);
  });

  it('never grows past the normal share, and never goes negative', () => {
    expect(maxAboveKeyboard(852, 0.52, 100, 59, 100)).toBeCloseTo(443.04);
    expect(maxAboveKeyboard(400, 0.52, 380, 59, 200)).toBe(0);
  });
});
