import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT, text, white } from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { getStore, usePrefs } from '@/store';
import { ThinkingPill } from '../ai/ThinkingPill';
import { readPhrase } from '../ai/phrases';
import { modelLabel, useUsageState } from '../ai/usage';
import { devSeedEnabled } from '../calendar/devSeed';
import { aiCheckInQuestions, composer } from '../composer/instance';
import { useComposerHeight } from '../composer/layout';
import { commitUndoable } from '../history/commit';
import {
  answer, back, buildQuestions, finish, shouldOpen, startFlow, stepLabel, type Clock, type Flow,
} from './model';
import {
  getLastCheckIn, getLastSeen, getLastWinDay, stampCheckIn, stampWinDay,
} from './state';

/* a tiny request channel so Settings can start a check-in */
const subs = new Set<() => void>();
export const runCheckInNow = (): void => {
  subs.forEach((s) => s());
};

const clockNow = (): Clock => {
  const n = new Date();
  return { today: new Date(n.getFullYear(), n.getMonth(), n.getDate()), nowMin: n.getHours() * 60 + n.getMinutes(), nowMs: n.getTime() };
};

/**
 * The open-space check-in: after five hours away, or once each evening while
 * goal sessions wait for a win, a short card above the composer asks a few
 * questions, with wins capture. With Claude on, `ai-schedule` (mode `checkin`)
 * writes them, merged with the code-driven ones; offline, on error or at the
 * limit the local signals do. Answers apply through `commit`; free-text ones
 * go to the composer as a note.
 */
export function CheckInHost({ busy }: { busy?: boolean }) {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const { model } = useUsageState();
  const composerH = useComposerHeight();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const [readSeq, setReadSeq] = useState(0);
  const busyRef = useRef(false);

  /* Claude's questions when it is on (null on any failure: the local ones take over), then the flow */
  const open = useCallback(async () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    try {
      const lastSeen = getLastSeen();
      let ai: Awaited<ReturnType<typeof aiCheckInQuestions>> = null;
      if (getStore().getState().prefs.ai.on) {
        setReadSeq((n) => n + 1);
        setLoading(true);
        ai = await aiCheckInQuestions(lastSeen);
        setLoading(false);
      }
      const qs = buildQuestions(getStore().getState().data, clockNow(), lastSeen, ai);
      if (!qs.length) {
        showToast({ label: 'Nothing to check in on right now' });
        return false;
      }
      setTyped('');
      setFromAi(!!ai);
      setFlow(startFlow(qs));
      return true;
    } finally {
      setLoading(false);
      busyRef.current = false;
    }
  }, []);

  /* manual run from Settings */
  useEffect(() => {
    const l = () => { void open(); };
    subs.add(l);
    return () => { subs.delete(l); };
  }, [open]);

  /* automatic: on mount and every two minutes */
  useEffect(() => {
    if (devSeedEnabled()) return; // keep the seeded dev calendar free of surprise cards
    const tick = (eodOnly: boolean) => {
      if (busy || flow || busyRef.current) return;
      const clock = clockNow();
      const ok = shouldOpen({
        enabled: prefs.ai.checkin, eodOnly, data: getStore().getState().data, clock,
        lastCheckIn: getLastCheckIn(), lastWinDay: getLastWinDay(),
      });
      if (!ok) return;
      void open().then((ok) => { if (!ok) stampCheckIn(); });
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
    if (res.changed && res.label) commitUndoable(res.data, res.label, 'edit');
    /* free-text "log" answers become events: a note to Claude, or the offline parser */
    if (res.followUp) composer.submitCheckInAnswers(res.followUp, res.plain);
    close(r.flow);
  }, [flow, close]);

  const above = insets.bottom + 14 + composerH + 8;
  if (loading) {
    return (
      <View pointerEvents="none" style={[styles.wrap, { bottom: above }]}>
        <ThinkingPill phrase={readPhrase(readSeq)} testID="checkin-loading" />
      </View>
    );
  }
  if (!flow) return null;
  const q = flow.qs[flow.idx];
  const tag = q.field === 'win' ? 'Wins' : fromAi ? modelLabel(model) + ' \u00b7 check-in' : 'Check-in';
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: above }]}>
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
