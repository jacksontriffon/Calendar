import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { goalsToday, paceOf, paint, text, type CalendarData } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Ring } from '@/components/Ring';
import type { Now } from '../calendar/useNow';

interface Props {
  data: CalendarData;
  now: Now;
  /** timer context so a running timer counts towards today */
  timerCtx?: { tm?: import('@calendar/core').TimerState | null; tmNow?: number };
  onPress: () => void;
}

/** Today's goal chips above the composer: ring, "45m left today", name and pace (the prototype's goalChips). */
function GoalChipsImpl({ data, now, timerCtx, onPress }: Props) {
  const rows = useMemo(() => {
    const ctx = { today: now.today, nowMin: now.nowMin, nowMs: now.nowMs, timer: timerCtx ?? null };
    return goalsToday(data.goals, data.events, ctx).slice(0, 4).map((g) => {
      const goal = data.goals.find((x) => x.id === g.id)!;
      return { g, pace: paceOf(goal, data.events, ctx) };
    });
  }, [data.goals, data.events, now.today, now.nowMin, now.nowMs, timerCtx]);

  if (!rows.length) return null;
  return (
    <View style={styles.col} testID="goal-chips">
      {rows.map(({ g, pace }) => {
        const P = paint(g.hue);
        return (
          <Pressable
            key={g.id}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={g.title + ', ' + g.label}
            style={({ pressed }) => [styles.chip, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          >
            <Ring fraction={g.ring} color={P.edge} size={16} />
            <View style={styles.left}>
              <AppText style={styles.leftNum}>{g.left}</AppText>
              <AppText style={styles.leftTail}>{g.doneToday ? 'for today' : 'left today'}</AppText>
            </View>
            <AppText numberOfLines={1} style={styles.name}>{g.title}</AppText>
            <AppText style={[styles.pace, pace.color ? { color: pace.color } : null]}>{pace.num}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export const GoalChips = memo(GoalChipsImpl);

const styles = StyleSheet.create({
  col: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 3, paddingLeft: 10, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3, maxWidth: '100%' },
  left: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  leftNum: { fontSize: 14, fontWeight: '700', letterSpacing: -0.3, color: '#f6f2ec', fontVariant: ['tabular-nums'] },
  leftTail: { fontSize: 11.5, color: text(0.45) },
  name: { flexShrink: 1, minWidth: 48, fontSize: 13, lineHeight: 16, fontWeight: '600', color: text(0.8) },
  pace: { fontSize: 11.5, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
