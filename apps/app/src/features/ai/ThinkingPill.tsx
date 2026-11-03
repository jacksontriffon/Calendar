import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, FadeIn, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { ACCENT, text } from '@calendar/core';

import { AppText } from '@/components/AppText';

/** One of the three bouncing dots (the prototype's `dot` keyframes: 1.1 s, 0.16 s apart). */
function Dot({ delay }: { delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(delay, withRepeat(withSequence(
      withTiming(1, { duration: 440, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 660, easing: Easing.inOut(Easing.quad) }),
    ), -1)));
    return () => cancelAnimation(p);
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * p.value, transform: [{ translateY: -2 * p.value }] }));
  return <Animated.View style={[styles.dot, style]} />;
}

/**
 * "Tetris-ing your day…" with three bouncing dots, centred above the goal chips while a note is
 * being scheduled (also used while a check-in reads the week).
 */
export function ThinkingPill({ phrase, testID = 'thinking-pill' }: { phrase: string; testID?: string }) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View entering={FadeIn.duration(300)} style={styles.pill} testID={testID} accessibilityLiveRegion="polite">
        <View style={styles.dots}>
          <Dot delay={0} />
          <Dot delay={160} />
          <Dot delay={320} />
        </View>
        <AppText style={styles.txt}>{phrase}</AppText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 9 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: '#242220', borderWidth: 1, borderColor: '#322f2c',
  },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: ACCENT },
  txt: { fontSize: 12.5, color: text(0.55) },
});
