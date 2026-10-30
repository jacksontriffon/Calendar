import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
  fmt, fmtDur, fmtShort, hueFor, minsIn, paint, text, timerInfo, white, workedMins, clamp,
  type ProtoEvent, type TimerState,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Ring } from '@/components/Ring';
import { useCalendarData } from '@/store';
import {
  closeTimer, finishTimer, pauseTimer, resumeTimer, useTimer,
} from './store';

const WARN = '#e8745f';

interface View_ {
  ev: ProtoEvent;
  tm: TimerState;
  txt: string;
  over: boolean;
  prog: number;
  hue: number;
}

function useTimerView(): View_ | null {
  const { tm, tmNow } = useTimer();
  const data = useCalendarData();
  if (!tm) return null;
  const ev = data.events.find((e) => e.id === tm.id);
  if (!ev) return null;
  const info = timerInfo(tm, tmNow);
  const prog = info.over ? 1 : clamp(1 - info.rem / Math.max(1, tm.total), 0, 1);
  return { ev, tm, txt: info.txt, over: info.over, prog, hue: hueFor(data.cats, ev.cat ?? '') };
}

/** The full-screen timer (the prototype's black overlay): countdown ring, pause / resume, Done. */
export function TimerOverlay() {
  const insets = useSafeAreaInsets();
  const v = useTimerView();
  const { tmNow } = useTimer();
  if (!v || !v.tm.open) return null;
  const { ev, tm } = v;
  const P = paint(v.hue);
  const col = v.over ? WARN : P.edge;
  const C = 2 * Math.PI * 132;
  const worked = fmtDur(workedMins(ev, minsIn(ev.day, tmNow), { tm, tmNow }));
  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      exiting={FadeOut.duration(200)}
      style={[styles.overlay, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 22 }]}
      testID="timer-overlay"
    >
      <Pressable onPress={closeTimer} accessibilityRole="button" accessibilityLabel="Minimise timer" style={styles.min}>
        <Icon name="chevronDown" size={16} color="#f3efe8" strokeWidth={1.7} />
      </Pressable>
      <View style={styles.titles}>
        <AppText style={styles.title}>{ev.title}</AppText>
        <View style={styles.metaRow}>
          <View style={[styles.dot, { backgroundColor: P.edge }]} />
          <AppText style={styles.meta}>{(ev.cat ? ev.cat + ' · ' : '') + fmtShort(ev.start) + '–' + fmt(ev.end)}</AppText>
        </View>
        <AppText style={styles.worked}>Tracked time: {worked}</AppText>
      </View>
      <View style={styles.center}>
        <Pressable
          onPress={() => (tm.paused ? resumeTimer() : pauseTimer())}
          accessibilityRole="button"
          accessibilityLabel={tm.paused ? 'Resume timer' : 'Pause timer'}
          style={styles.dial}
        >
          <Svg width="100%" height="100%" viewBox="0 0 288 288" style={StyleSheet.absoluteFill}>
            <Circle cx={144} cy={144} r={132} stroke={white(0.08)} strokeWidth={5} fill="none" />
            <Circle
              cx={144} cy={144} r={132} stroke={col} strokeWidth={5} fill="none" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - v.prog)} opacity={tm.paused ? 0.45 : 1}
              transform="rotate(-90 144 144)"
            />
          </Svg>
          <View style={styles.dialCenter}>
            <AppText style={[styles.time, { color: v.over ? WARN : '#f6f2ec', opacity: tm.paused ? 0.5 : 1 }]}>{v.txt}</AppText>
            <AppText style={styles.state}>{tm.paused ? 'Paused' : v.over ? 'Over time' : 'Tap to pause'}</AppText>
          </View>
        </Pressable>
      </View>
      <Pressable onPress={() => finishTimer()} accessibilityRole="button" style={styles.done}>
        <AppText style={{ fontSize: 15, fontWeight: '600' }}>Done</AppText>
      </Pressable>
    </Animated.View>
  );
}

/** The small pill shown above the composer while a timer runs minimised. */
export function TimerPill({ onPress }: { onPress: () => void }) {
  const v = useTimerView();
  if (!v) return null;
  const { tm } = v;
  const P = paint(v.hue);
  const col = v.over ? WARN : P.edge;
  return (
    <View style={{ paddingBottom: 10 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open timer"
        style={[styles.pill, tm.paused ? styles.pillPaused : v.over ? styles.pillOver : null]}
        testID="timer-pill"
      >
        <View style={{ width: 16, height: 16 }}>
          <Ring fraction={v.prog} color={tm.paused ? text(0.3) : col} size={16} strokeWidth={2} track={white(0.12)} />
          {tm.paused ? (
            <View style={styles.pauseIcon}><Icon name="pause" size={7} color={text(0.6)} /></View>
          ) : null}
        </View>
        <AppText style={[styles.pillTime, { color: tm.paused ? text(0.45) : v.over ? WARN : '#f6f2ec' }]}>{v.txt}</AppText>
        <AppText numberOfLines={1} style={[styles.pillName, { color: tm.paused ? text(0.35) : text(0.6) }]}>{v.ev.title}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...(StyleSheet.absoluteFill as object), zIndex: 95, backgroundColor: '#000', paddingHorizontal: 20 },
  min: { width: 38, height: 38, borderRadius: 19, backgroundColor: white(0.07), alignItems: 'center', justifyContent: 'center' },
  titles: { alignItems: 'center', gap: 8, marginTop: 22, paddingHorizontal: 12 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '600', letterSpacing: -0.3, color: '#f6f2ec', textAlign: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  meta: { fontSize: 13, color: text(0.5) },
  worked: { fontSize: 13, color: text(0.4), fontVariant: ['tabular-nums'] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dial: { width: '78%', maxWidth: 288, aspectRatio: 1 },
  dialCenter: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center', gap: 12 },
  time: { fontSize: 64, lineHeight: 70, fontWeight: '300', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  state: { fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: text(0.45) },
  done: { padding: 15, borderRadius: 14, alignItems: 'center', backgroundColor: white(0.08), borderWidth: 1, borderColor: white(0.12) },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', paddingVertical: 7, paddingLeft: 9, paddingRight: 13, borderRadius: 999,
    backgroundColor: 'rgba(34,31,29,0.92)', borderWidth: 1, borderColor: white(0.1),
  },
  pillPaused: { backgroundColor: 'rgba(34,31,29,0.6)', borderStyle: 'dashed', borderColor: white(0.14) },
  pillOver: { borderColor: 'rgba(232,116,95,0.4)' },
  pillTime: { fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pillName: { fontSize: 12.5, maxWidth: 120 },
  pauseIcon: { position: 'absolute', left: 4.5, top: 4.5 },
});
