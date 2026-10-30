import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInRight, FadeInLeft, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { ACCENT, BEHIND_INK, SURFACE, key, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { Icon } from '@/components/Icon';
import { GUTTER, dowLabel, type Mode } from './model';

interface HeaderProps {
  title: string;
  sub: string;
  behind: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  onGoals: () => void;
  onSettings: () => void;
  /** display name for the avatar initials */
  userName?: string | null;
  topInset: number;
  children?: ReactNode;
}

const MODES: Array<[Mode, string]> = [['day3', '3 days'], ['week', 'Week'], ['month', 'Month']];

/** Title + goal summary (opens goals), the 3 days / Week / Month control and the avatar that opens Settings. */
export function CalendarHeader(p: HeaderProps) {
  return (
    <View style={[styles.header, { paddingTop: p.topInset + 14 }]}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <AppText style={styles.title} numberOfLines={1} accessibilityRole="header">{p.title}</AppText>
          <Pressable onPress={p.onGoals} accessibilityRole="button" accessibilityLabel={'Goals: ' + p.sub}>
            <AppText numberOfLines={1} style={[styles.sub, p.behind ? { color: BEHIND_INK } : null]}>{p.sub}</AppText>
          </Pressable>
        </View>
        <View style={styles.right}>
          <View style={styles.seg} accessibilityRole="tablist">
            {MODES.map(([k, label]) => (
              <Pressable
                key={k}
                onPress={() => p.onMode(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: p.mode === k }}
                style={[styles.segBtn, p.mode === k && styles.segOn]}
              >
                <AppText style={[styles.segTxt, p.mode === k && { color: text(1) }]}>{label}</AppText>
              </Pressable>
            ))}
          </View>
          <HeaderAvatar name={p.userName} onPress={p.onSettings} />
        </View>
      </View>
      {p.children}
    </View>
  );
}

interface DaysProps {
  days: Date[];
  colW: number;
  week: boolean;
  todayKey: string;
  navSeq: number;
  dir: 1 | -1;
  /** page slide, shared with the grid */
  tx: SharedValue<number>;
  swipeX: SharedValue<number>;
  onPrev: () => void;
  onNext: () => void;
  onDay?: (d: Date) => void;
}

/** The day-label row with the prev / next arrows over its edges. */
export const DayHeader = memo(function DayHeader(p: DaysProps) {
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: (p.swipeX.value + p.tx.value) * 0.45 }] }));
  const Entering = p.dir > 0 ? FadeInRight : FadeInLeft;
  return (
    <View style={styles.daysRow}>
      <Pressable
        onPress={p.onPrev}
        accessibilityRole="button"
        accessibilityLabel="Previous"
        style={({ pressed }) => [styles.arrow, { left: -9 }, pressed && styles.arrowOn]}
      >
        <Icon name="chevronLeft" size={20} color={text(0.6)} strokeWidth={1.7} />
      </Pressable>
      <Pressable
        onPress={p.onNext}
        accessibilityRole="button"
        accessibilityLabel="Next"
        style={({ pressed }) => [styles.arrow, { right: -9 }, pressed && styles.arrowOn]}
      >
        <Icon name="chevronRight" size={20} color={text(0.6)} strokeWidth={1.7} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Animated.View style={[{ flexDirection: 'row' }, track]}>
          <View style={{ width: GUTTER }} />
          {p.days.map((d, i) => {
            const dk = key(d);
            const isToday = dk === p.todayKey;
            const past = dk < p.todayKey;
            return (
              <Animated.View
                key={p.navSeq + ':' + dk}
                entering={Entering.duration(420).delay((p.dir > 0 ? i : p.days.length - 1 - i) * 32)}
                style={{ width: p.colW, alignItems: 'center', gap: 4, paddingBottom: 11 }}
              >
                <AppText
                  style={[styles.dow, { color: isToday ? ACCENT : text(0.34) }]}
                  accessibilityLabel={d.toDateString()}
                >
                  {dowLabel(d, p.week)}
                </AppText>
                <Pressable onPress={() => p.onDay?.(d)} disabled={!p.onDay} accessibilityRole="button">
                  <View style={[styles.num, isToday && { backgroundColor: ACCENT }]}>
                    <AppText style={[styles.numTxt, { color: isToday ? SURFACE.onAccent : past ? text(0.4) : text(0.8) }]}>
                      {d.getDate()}
                    </AppText>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 14, backgroundColor: '#1b1a18', borderBottomWidth: 1, borderBottomColor: white(0.07),
  },
  top: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  titles: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 21, lineHeight: 25, fontWeight: '600', letterSpacing: -0.5 },
  sub: { fontSize: 11.5, lineHeight: 15, color: text(0.45) },
  right: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  seg: { flexDirection: 'row', padding: 2, gap: 2, backgroundColor: white(0.055), borderRadius: 9 },
  segBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 7 },
  segOn: { backgroundColor: white(0.11) },
  segTxt: { fontSize: 11.5, fontWeight: '600', letterSpacing: -0.1, color: text(0.42) },
  daysRow: { flexDirection: 'row', marginTop: 18 },
  arrow: {
    position: 'absolute', top: '50%', marginTop: -24, width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', zIndex: 5,
  },
  arrowOn: { backgroundColor: white(0.08), transform: [{ scale: 0.88 }] },
  dow: { fontSize: 10.5, letterSpacing: 0.7, textTransform: 'uppercase' },
  num: { width: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontSize: 14, fontWeight: '600', letterSpacing: -0.3 },
});
