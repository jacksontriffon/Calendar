import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { text, white, type ChartUnit } from '@calendar/core';

import { AppText } from '@/components/AppText';

const UNITS: [ChartUnit, string][] = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']];

// Fixed-width equal segments: sized to the widest label ("Months" at 11px), not stretched by the header row.
const SEG = 44;
const GAP = 2;

/** Days / Weeks / Months, a three-way segmented control with a pill that slides under the choice. */
export function GoalUnitToggle({ unit, onChange }: { unit: ChartUnit; onChange: (u: ChartUnit) => void }) {
  const reduce = useReducedMotion();
  const idx = UNITS.findIndex((u) => u[0] === unit);
  const x = useSharedValue(idx);
  useEffect(() => {
    x.set(reduce ? idx : withTiming(idx, { duration: 340, easing: Easing.bezier(0.3, 0.9, 0.25, 1) }));
  }, [x, idx, reduce]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (SEG + GAP) }] }));
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      <Animated.View style={[styles.pill, pill]} />
      {UNITS.map(([u, label]) => (
        <Pressable
          key={u}
          onPress={() => { if (u !== unit) onChange(u); }}
          accessibilityRole="tab"
          accessibilityState={{ selected: u === unit }}
          style={styles.seg}
          testID={'goal-unit-' + u}
        >
          <AppText style={[styles.label, { color: u === unit ? '#f3efe8' : text(0.42) }]}>{label}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignSelf: 'center', padding: 2, gap: GAP, backgroundColor: white(0.055), borderRadius: 8 },
  pill: { position: 'absolute', top: 2, bottom: 2, left: 2, width: SEG, borderRadius: 6, backgroundColor: white(0.11) },
  seg: { width: SEG, paddingVertical: 4, borderRadius: 6, alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '600' },
});
