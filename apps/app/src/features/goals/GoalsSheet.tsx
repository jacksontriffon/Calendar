import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  goalDue, goalStats, hrs, paceOf, paint, sortGoals, text, white, dur, goalRate, ACCENT,
  type NowCtx,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Ring } from '@/components/Ring';
import { Sheet, useSheetClose } from '@/components/Sheet';
import { getStore, useCalendarData } from '@/store';
import { commitQuiet } from '../history/commit';
import { openRecap } from '../story/StoryHost';
import { useTimer } from '../timer/store';
import { useNow } from '../calendar/useNow';
import { newGoalIn } from './model';

interface Props {
  onClosed: () => void;
  onOpenGoal: (id: string) => void;
}

/** The goals list sheet: one row per goal with ring, outcome, due date and pace. Tap opens goal detail. */
export function GoalsSheet({ onClosed, onOpenGoal }: Props) {
  return (
    <Sheet onClosed={onClosed} testID="goals-sheet">
      <GoalsList onOpenGoal={onOpenGoal} />
    </Sheet>
  );
}

function GoalsList({ onOpenGoal }: { onOpenGoal: (id: string) => void }) {
  const close = useSheetClose();
  const data = useCalendarData();
  const now = useNow();
  const timer = useTimer();
  const ctx: NowCtx = useMemo(
    () => ({ today: now.today, nowMin: now.nowMin, nowMs: now.nowMs, timer }),
    [now.today, now.nowMin, now.nowMs, timer],
  );
  const goals = useMemo(() => sortGoals(data.goals), [data.goals]);

  const add = () => {
    const r = newGoalIn(getStore().getState().data, Date.now(), now.today);
    commitQuiet(r.data, 'Goal added', 'edit');
    close();
    setTimeout(() => onOpenGoal(r.id), 260);
  };

  return (
    <View>
      <View style={styles.head}>
        <AppText style={styles.title} accessibilityRole="header">Goals</AppText>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { close(); setTimeout(openRecap, 260); }} accessibilityRole="button" style={[styles.add, { marginRight: 6 }]}>
          <AppText style={[styles.addTxt, { color: text(0.6) }]}>Wins</AppText>
        </Pressable>
        <Pressable onPress={add} accessibilityRole="button" style={styles.add}>
          <AppText style={styles.addTxt}>+ New goal</AppText>
        </Pressable>
      </View>
      {goals.length === 0 ? (
        <AppText style={styles.empty}>
          No goals yet. A goal is a result by a date, like {'“'}Run a sub-4 hour marathon by 6 Dec{'”'}. The app spreads the hours evenly and shows your pace.
        </AppText>
      ) : (
        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
          <View style={styles.grid}>
            {goals.map((g) => {
              const P = paint(g.hue);
              const s = goalStats(g, data.events, ctx);
              const pace = paceOf(g, data.events, ctx);
              const R = goalRate(g, now.today);
              return (
                <Pressable
                  key={g.id}
                  onPress={() => onOpenGoal(g.id)}
                  accessibilityRole="button"
                  accessibilityLabel={g.title}
                  style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.98 }] }]}
                  testID="goal-row"
                >
                  <View style={styles.cardTop}>
                    <Ring fraction={s.pct} color={P.edge} size={22} />
                    <AppText style={styles.name} numberOfLines={1}>{g.title}</AppText>
                    <AppText style={[styles.pace, pace.color ? { color: pace.color } : null]}>{pace.word}</AppText>
                  </View>
                  <AppText style={styles.outcome} numberOfLines={1}>{g.outcome || 'No specific outcome yet'}</AppText>
                  <AppText style={styles.meta}>
                    {g.deadline ? 'by ' + goalDue(g, now.today) + ' · ' : ''}{dur(R.perWeek)} a week {'·'} {hrs(s.done)} of {hrs(R.target)}h
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  add: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: white(0.06) },
  addTxt: { fontSize: 12, fontWeight: '600', color: ACCENT },
  empty: { fontSize: 13, lineHeight: 19, color: text(0.5), paddingBottom: 12 },
  grid: { gap: 8 },
  card: { padding: 12, borderRadius: 12, backgroundColor: white(0.045), gap: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  name: { flex: 1, fontSize: 14.5, fontWeight: '650' as never, letterSpacing: -0.2 },
  pace: { fontSize: 12, fontWeight: '600' },
  outcome: { fontSize: 12.5, color: text(0.6), marginLeft: 31 },
  meta: { fontSize: 11.5, color: text(0.4), marginLeft: 31, fontVariant: ['tabular-nums'] },
});
