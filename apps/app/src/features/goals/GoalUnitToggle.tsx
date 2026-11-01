import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { text, white, type ChartUnit } from '@calendar/core';

import { AppText } from '@/components/AppText';

const UNITS: [ChartUnit, string][] = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']];

/** Days / Weeks / Months, a three-way segmented control with a pill that slides under the choice. */
export function GoalUnitToggle({ unit, onChange }: { unit: ChartUnit; onChange: (u: ChartUnit) => void }) {
  const [w, setW] = useState(0);
  const reduce = useReducedMotion();
  const idx = UNITS.findIndex((u) => u[0] === unit);
  const seg = w ? (w - 4 - 4) / 3 : 0; // padding 2 each side, gap 2 between
  const x = useSharedValue(idx);
  useEffect(() => {
    x.set(reduce || !w ? idx : withTiming(idx, { duration: 340, easing: Easing.bezier(0.3, 0.9, 0.25, 1) }));
  }, [x, idx, reduce, w]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (seg + 2) }] }));
  return (
    <View style={styles.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {seg ? <Animated.View style={[styles.pill, { width: seg }, pill]} /> : null}
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
  wrap: { flexDirection: 'row', padding: 2, gap: 2, backgroundColor: white(0.055), borderRadius: 8 },
  pill: { position: 'absolute', top: 2, bottom: 2, left: 2, borderRadius: 6, backgroundColor: white(0.11) },
  seg: { flex: 1, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 6, alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '600' },
});
