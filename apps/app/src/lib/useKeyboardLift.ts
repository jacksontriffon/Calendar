import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import {
  Easing, useAnimatedStyle, useSharedValue, withTiming, type AnimatedStyle, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { keyboardLift, keyboardShift, type KeyboardFrame } from './keyboard-math';

/** iOS keyboard curve (UIView animation curve 7) as a bezier. */
const IOS_CURVE = Easing.bezier(0.17, 0.59, 0.4, 0.77);
/** Android only reports the keyboard once it is already open (no duration): a short settle. */
const ANDROID_MS = 180;
const IOS_MS = 250;

export interface KeyboardLift {
  /** animated distance from the window bottom up to the keyboard top (0 when hidden) */
  lift: SharedValue<number>;
  /** the same distance as plain state, updated once per keyboard event, for layout that must change (max heights) */
  height: number;
}

/**
 * Tracks the soft keyboard: iOS from `keyboardWillChangeFrame` (so the lift runs in step with the
 * keyboard, using its own duration), Android from `keyboardDidShow` / `keyboardDidHide` (the only
 * events it has, so the lift follows the keyboard instead of leading it). Does nothing on web.
 * See `keyboard-math.ts` for what the numbers mean.
 */
export function useKeyboardLift(): KeyboardLift {
  const insetBottom = useSafeAreaInsets().bottom;
  const lift = useSharedValue(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const apply = (frame: KeyboardFrame | null | undefined, ms: number) => {
      const next = frame
        ? keyboardLift({ platform: Platform.OS, ...frame, screenHeight: Dimensions.get('screen').height, insetBottom })
        : 0;
      setHeight(next);
      if (ms > 0) lift.set(withTiming(next, { duration: ms, easing: Platform.OS === 'ios' ? IOS_CURVE : Easing.out(Easing.quad) }));
      else lift.set(next);
    };

    /* already open when this mounts (a deep link focused the input first, a remount) */
    const open = Keyboard.metrics();
    if (open) apply(open, 0);

    const subs = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillChangeFrame', (e) => apply(e.endCoordinates, e.duration > 0 ? e.duration : IOS_MS)),
          Keyboard.addListener('keyboardWillHide', (e) => apply(null, e.duration > 0 ? e.duration : IOS_MS)),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', (e) => apply(e.endCoordinates, ANDROID_MS)),
          Keyboard.addListener('keyboardDidHide', () => apply(null, ANDROID_MS)),
        ];
    return () => subs.forEach((s) => s.remove());
  }, [insetBottom, lift]);

  return { lift, height };
}

/**
 * Style that raises a bottom-anchored view with the keyboard (see `keyboardShift`): the view's own
 * bottom padding stays as it is and only a transform moves, so nothing re-lays out while the
 * keyboard animates and measured heights (composer, toasts, check-in) stay valid.
 */
export function useKeyboardRise(lift: SharedValue<number>): AnimatedStyle<{ transform: { translateY: number }[] }> {
  const insetBottom = useSafeAreaInsets().bottom;
  return useAnimatedStyle(() => ({ transform: [{ translateY: -keyboardShift(lift.value, insetBottom) }] }));
}
