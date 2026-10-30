import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, Keyframe, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ACCENT, goalRate, hrs, niceDate, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { useCalendarData } from '@/store';
import { modelLabel, useUsageState } from '../ai/usage';
import { useNow } from '../calendar/useNow';
import type { AskState } from './model';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

interface Props {
  ask: AskState;
  onPick: (label: string) => void;
  onBack: () => void;
  onSkip: () => void;
  onHover: (i: number) => void;
  /** web: arrows, Enter, 1-9 and Escape while no field has focus; returns whether it was handled */
  onKey: (key: string) => boolean;
}

/**
 * The clarifying-question sheet above the composer: one question at a time as radio rows (with
 * their number for the keyboard), Back, Skip, and a goal strip when the questions come from a goal
 * adjustment. Typing an answer in the composer works too (the composer routes it here).
 */
export function AskSheet({ ask, onPick, onBack, onSkip, onHover, onKey }: Props) {
  const { height: winH } = useWindowDimensions();
  const data = useCalendarData();
  const now = useNow();
  const { model } = useUsageState();
  const q = ask.qs[ask.idx];
  const goal = ask.goalId ? data.goals.find((g) => g.id === ask.goalId) : null;

  /* askIn (0.34 s) / askOut (0.2 s) */
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(ask.closing ? 0 : 1, { duration: ask.closing ? 200 : 340, easing: ask.closing ? Easing.in(Easing.quad) : EASE }));
  }, [ask.closing, p]);
  const sheet = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * (ask.closing ? 6 : 14) }, { scale: 0.975 + 0.025 * p.value }],
  }));

  /* web keyboard: arrows move, Enter picks, 1-9 pick, Escape dismisses; typing in a field is left alone */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing && e.key !== 'Escape') return;
      if (onKey(e.key)) e.preventDefault();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onKey]);

  if (!q) return null;
  const picking = !!ask.pick;
  const paneIn = new Keyframe({
    0: { opacity: 0, transform: [{ translateX: ask.dir < 0 ? -26 : 26 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: EASE },
  }).duration(340);

  return (
    <View style={styles.wrap} pointerEvents={ask.closing ? 'none' : 'auto'}>
      <Animated.View style={[styles.sheet, sheet]} testID="ask-sheet">
        <View style={styles.top}>
          <AppText style={styles.tag}>{modelLabel(model)} asks</AppText>
          <View style={{ flex: 1 }} />
          {ask.qs.length > 1 ? <AppText style={styles.step}>{ask.idx + 1} of {ask.qs.length}</AppText> : null}
          {ask.idx > 0 ? (
            <Pressable onPress={onBack} accessibilityRole="button" style={styles.mini} testID="ask-back">
              <AppText style={styles.miniTxt}>Back</AppText>
            </Pressable>
          ) : null}
          <Pressable onPress={onSkip} accessibilityRole="button" style={styles.mini} testID="ask-skip">
            <AppText style={styles.miniTxt}>Skip</AppText>
          </Pressable>
        </View>

        {goal ? (
          <View style={styles.goal}>
            <AppText style={styles.goalTitle}>{goal.title}</AppText>
            <AppText style={styles.goalTxt}>{goalRate(goal, now.today).target ? hrs(goalRate(goal, now.today).target) + 'h total' : 'No target hours'}</AppText>
            <AppText style={styles.goalDot}>{'·'}</AppText>
            <AppText style={styles.goalTxt}>{goal.deadline ? 'due ' + niceDate(goal.deadline) : 'No deadline'}</AppText>
          </View>
        ) : null}

        <ScrollView style={{ maxHeight: winH * 0.52 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Animated.View key={ask.idx} entering={paneIn}>
            <AppText style={styles.q} testID="ask-question">{q.q}</AppText>
            <View style={{ gap: 3 }}>
              {q.options.map((o, i) => {
                const chosen = ask.ans[ask.idx] === o.label;
                const hi = ask.hi === i;
                return (
                  <Animated.View
                    key={o.label}
                    entering={new Keyframe({
                      0: { opacity: 0, transform: [{ translateY: 7 }, { scale: 0.99 }] },
                      100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: EASE },
                    }).duration(380).delay(50 + i * 45)}
                  >
                    <Pressable
                      onPress={() => onPick(o.label)}
                      onHoverIn={() => onHover(i)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chosen }}
                      testID={'ask-opt-' + (i + 1)}
                      style={[
                        styles.opt,
                        { backgroundColor: hi || chosen ? white(0.075) : white(0.03), opacity: picking && !chosen ? 0.42 : 1 },
                        { borderColor: chosen ? 'rgba(207,123,88,0.55)' : hi ? white(0.14) : white(0.05) },
                      ]}
                    >
                      <View style={[styles.radio, { borderColor: chosen || hi ? ACCENT : text(0.3) }]}>
                        {chosen ? <View style={styles.dot} /> : null}
                      </View>
                      <View style={styles.optBody}>
                        <AppText style={styles.optLabel}>{o.label}</AppText>
                        {o.note ? <AppText style={styles.optNote}>{o.note}</AppText> : null}
                      </View>
                      <AppText style={styles.num}>{i + 1}</AppText>
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 8 },
  sheet: {
    backgroundColor: '#201e1c', borderWidth: 1, borderColor: white(0.09), borderRadius: 16, paddingTop: 11, paddingHorizontal: 10, paddingBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.42, shadowRadius: 17, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingBottom: 9 },
  tag: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: ACCENT, fontWeight: '600' },
  step: { fontSize: 11, color: text(0.34), fontVariant: ['tabular-nums'] },
  mini: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8, backgroundColor: white(0.06) },
  miniTxt: { fontSize: 11.5, color: text(0.55) },
  goal: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2, marginBottom: 10, paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: 10, backgroundColor: white(0.04),
  },
  goalTitle: { fontSize: 12, lineHeight: 16, color: '#f3efe8', fontWeight: '600' },
  goalTxt: { fontSize: 12, lineHeight: 16, color: text(0.6) },
  goalDot: { fontSize: 12, lineHeight: 16, color: text(0.3) },
  q: { fontSize: 14.5, lineHeight: 19, paddingHorizontal: 2, paddingBottom: 10 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1 },
  radio: { width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ACCENT },
  optBody: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 7, rowGap: 1 },
  optLabel: { fontSize: 13.5, lineHeight: 18, fontWeight: '500', flexShrink: 1 },
  optNote: { fontSize: 11.5, lineHeight: 15, color: text(0.4), flexShrink: 1 },
  num: { fontSize: 10.5, color: text(0.3), fontVariant: ['tabular-nums'], minWidth: 9, textAlign: 'right' },
});
