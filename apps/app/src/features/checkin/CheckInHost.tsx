import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT, text, white } from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { getStore, usePrefs } from '@/store';
import { devSeedEnabled } from '../calendar/devSeed';
import { commitUndoable } from '../history/commit';
import {
  answer, back, buildQuestions, finish, shouldOpen, startFlow, stepLabel, type Clock, type Flow,
} from './model';
import {
  getLastCheckIn, getLastSeen, getLastWinDay, stampCheckIn, stampWinDay,
} from './state';

/* a tiny request channel so Settings can start a check-in */
let manual = 0;
const subs = new Set<() => void>();
export const runCheckInNow = (): void => {
  manual++;
  subs.forEach((s) => s());
};
const useManual = (): number =>
  useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => manual, () => manual);

const clockNow = (): Clock => {
  const n = new Date();
  return { today: new Date(n.getFullYear(), n.getMonth(), n.getDate()), nowMin: n.getHours() * 60 + n.getMinutes(), nowMs: n.getTime() };
};

/**
 * The open-space check-in (without AI): after five hours away, or once each
 * evening while goal sessions wait for a win, a short card above the composer
 * asks the local questions, with wins capture. Answers apply through `commit`.
 */
export function CheckInHost({ busy }: { busy?: boolean }) {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [typed, setTyped] = useState('');
  const req = useManual();

  const open = useCallback(() => {
    const clock = clockNow();
    const qs = buildQuestions(getStore().getState().data, clock, getLastSeen());
    if (!qs.length) {
      showToast({ label: 'Nothing to check in on right now' });
      return false;
    }
    setTyped('');
    setFlow(startFlow(qs));
    return true;
  }, []);

  /* manual run from Settings */
  useEffect(() => {
    if (req > 0) open();
  }, [req, open]);

  /* automatic: on mount and every two minutes */
  useEffect(() => {
    if (devSeedEnabled()) return; // keep the seeded dev calendar free of surprise cards
    const tick = (eodOnly: boolean) => {
      if (busy || flow) return;
      const clock = clockNow();
      const ok = shouldOpen({
        enabled: prefs.ai.checkin, eodOnly, data: getStore().getState().data, clock,
        lastCheckIn: getLastCheckIn(), lastWinDay: getLastWinDay(),
      });
      if (!ok) return;
      if (!open()) stampCheckIn();
    };
    const t0 = setTimeout(() => tick(false), 1200);
    const t = setInterval(() => tick(true), 120000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [busy, flow, prefs.ai.checkin, open]);

  const close = useCallback((f: Flow | null) => {
    stampCheckIn();
    if (f && f.qs.some((q) => q.field === 'win')) stampWinDay(clockNow().today);
    setFlow(null);
  }, []);

  const submit = useCallback((a: string) => {
    if (!flow) return;
    const r = answer(flow, a);
    setTyped('');
    if (!r.done) { setFlow(r.flow); return; }
    const store = getStore();
    const res = finish(store.getState().data, r.flow, clockNow(), store.newId);
    // TODO(phase 4): res.followUp (free-text "log" answers) goes to ai-schedule / the offline parser to become events.
    if (res.changed && res.label) commitUndoable(res.data, res.label, 'edit');
    close(r.flow);
  }, [flow, close]);

  if (!flow) return null;
  const q = flow.qs[flow.idx];
  const tag = q.field === 'win' ? 'Wins' : 'Check-in';
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 14 + 56 }]}>
      <Animated.View entering={FadeInDown.duration(340)} exiting={FadeOutDown.duration(200)} style={styles.card} testID="checkin-card">
        <View style={styles.top}>
          <AppText style={styles.tag}>{tag}</AppText>
          <View style={{ flex: 1 }} />
          {stepLabel(flow) ? <AppText style={styles.step}>{stepLabel(flow)}</AppText> : null}
          {flow.idx > 0 ? (
            <Pressable onPress={() => setFlow(back(flow))} style={styles.mini}><AppText style={styles.miniTxt}>Back</AppText></Pressable>
          ) : null}
          <Pressable onPress={() => submit('')} style={styles.mini}><AppText style={styles.miniTxt}>Skip</AppText></Pressable>
          <Pressable onPress={() => close(flow)} accessibilityLabel="Close the check-in" style={styles.x}>
            <Icon name="close" size={11} color={text(0.55)} strokeWidth={1.8} />
          </Pressable>
        </View>
        <AppText style={styles.q}>{q.q}</AppText>
        <View style={{ gap: 3 }}>
          {q.chips.map((c, i) => (
            <Pressable key={c} onPress={() => submit(c)} accessibilityRole="button" style={styles.opt}>
              <View style={styles.radio} />
              <AppText style={styles.optTxt}>{c}</AppText>
              <AppText style={styles.num}>{i + 1}</AppText>
            </Pressable>
          ))}
        </View>
        <View style={styles.inputRow}>
          <AppInput
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={() => typed.trim() && submit(typed)}
            placeholder={q.field === 'win' ? 'What came out of it?' : 'Or type your own answer…'}
            style={{ flex: 1, fontSize: 14, paddingVertical: 8 }}
            returnKeyType="send"
            accessibilityLabel="Your answer"
          />
          {typed.trim() ? (
            <Pressable onPress={() => submit(typed)} style={styles.send} accessibilityLabel="Send answer">
              <Icon name="check" size={14} color="#17120f" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 66 },
  card: {
    backgroundColor: '#201e1c', borderWidth: 1, borderColor: white(0.09), borderRadius: 16, padding: 10, paddingTop: 11,
    shadowColor: '#000', shadowOpacity: 0.42, shadowRadius: 17, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingBottom: 9 },
  tag: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: ACCENT, fontWeight: '600' },
  step: { fontSize: 11, color: text(0.34), fontVariant: ['tabular-nums'] },
  mini: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8, backgroundColor: white(0.06) },
  miniTxt: { fontSize: 11.5, color: text(0.55) },
  x: { width: 26, height: 26, borderRadius: 13, backgroundColor: white(0.06), alignItems: 'center', justifyContent: 'center' },
  q: { fontSize: 14.5, lineHeight: 19, paddingHorizontal: 2, paddingBottom: 10 },
  opt: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 11,
    backgroundColor: white(0.03), borderWidth: 1, borderColor: white(0.05),
  },
  radio: { width: 15, height: 15, borderRadius: 8, borderWidth: 1.5, borderColor: text(0.3) },
  optTxt: { flex: 1, fontSize: 13.5, fontWeight: '600' },
  num: { fontSize: 10.5, color: text(0.3) },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 10, borderRadius: 11, backgroundColor: white(0.03) },
  send: { width: 26, height: 26, borderRadius: 13, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
});
