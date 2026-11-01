import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import {
  ACCENT, DANGER, PICKER, RING, adjustModeFor, goalRate, goalStats, paceOf, paint, removeGoal, ringDash, snapHue, text, white,
  type NowCtx, type ProtoGoal,
} from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { KeyboardScrollView } from '@/components/KeyboardScrollView';
import { Sheet, useSheetClose } from '@/components/Sheet';
import { getStore, useCalendarData, usePrefs } from '@/store';
import { useNow } from '../calendar/useNow';
import { composer } from '../composer/instance';
import { commitUndoable } from '../history/commit';
import { useTimer } from '../timer/store';
import { applyGoalDraft, draftOf, draftPatch, goalLines, parseDeadline, splitDeadline, type GoalDraft } from './model';

/** Goal detail (route /goal/[id]): pace ring, stats, editing, deadline and remove. */
export function GoalDetail({ id }: { id: string }) {
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return (
    <Sheet onClosed={goBack} testID="goal-sheet">
      <Body id={id} />
    </Sheet>
  );
}

function Body({ id }: { id: string }) {
  const close = useSheetClose();
  const data = useCalendarData();
  const now = useNow();
  const timer = useTimer();
  const aiOn = usePrefs().ai.on;
  const g = data.goals.find((x) => x.id === id);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const draftRef = useRef<GoalDraft | null>(null);
  const settled = useRef(false);
  if (g && !draft) setDraft(draftOf(g));
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const flush = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    const live = getStore().getState().data;
    const goal = live.goals.find((x) => x.id === id);
    const d = draftRef.current;
    if (!goal || !d) return;
    const next = applyGoalDraft(live, goal, d);
    if (next !== live) commitUndoable(next, 'Edited · ' + (d.title.trim() || goal.title), 'edit');
  }, [id]);
  useEffect(() => () => flush(), [flush]);

  const [dateEdit, setDateEdit] = useState<{ d: string; m: string; y: string } | null>(null);
  const ctx: NowCtx = useMemo(
    () => ({ today: now.today, nowMin: now.nowMin, nowMs: now.nowMs, timer }),
    [now.today, now.nowMin, now.nowMs, timer],
  );

  if (!g || !draft) {
    return <AppText style={{ color: text(0.6), paddingVertical: 24 }}>This goal no longer exists.</AppText>;
  }
  const view = (draftPatch(g, draft) && Object.keys(draftPatch(g, draft)).length ? { ...g, ...draftPatch(g, draft) } : g) as ProtoGoal;
  const P = paint(view.hue);
  const s = goalStats(view, data.events, ctx);
  const pace = paceOf(view, data.events, ctx);
  const L = goalLines(view, s, now.today);
  const set = (p: Partial<GoalDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const cur = snapHue(draft.hue);
  const dash = ringDash(s.pct);
  const exp = view.hours ? Math.min(1, s.expected / view.hours) : 0;

  /* Reduce scope when behind, Add stretch goal otherwise (none without hours or outside the span) */
  const adjMode = adjustModeFor(s.delta, goalRate(view, now.today).target, s.active);
  const adjust = () => {
    if (!adjMode) return;
    if (!aiOn) {
      composer.startGoalAdjust(id, adjMode); // explains that Claude is off, and keeps the sheet open
      return;
    }
    flush();
    close();
    setTimeout(() => composer.startGoalAdjust(id, adjMode), 280);
  };

  const commitDate = (f: { d: string; m: string; y: string }) => {
    const k = parseDeadline(f.d, f.m, f.y, now.today);
    if (k) set({ deadline: k });
    setDateEdit(null);
  };

  return (
    <KeyboardScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 700 }}>
      <View style={styles.head}>
        <View style={[styles.swatch, { backgroundColor: P.edge }]} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppInput
            value={draft.title}
            onChangeText={(v) => set({ title: v })}
            placeholder="Goal"
            style={styles.title}
            accessibilityLabel="Goal title"
          />
          <AppInput
            value={draft.outcome}
            onChangeText={(v) => set({ outcome: v })}
            placeholder="What does done look like?"
            style={styles.outcome}
            accessibilityLabel="Outcome"
          />
        </View>
        <Pressable onPress={() => { settled.current = true; const live = getStore().getState().data; commitUndoable(removeGoal(live, id), 'Removed goal · ' + g.title, 'delete'); close(); }}
          accessibilityRole="button" accessibilityLabel="Remove goal" style={styles.remove}>
          <AppText style={{ fontSize: 12.5, color: DANGER }}>Remove</AppText>
        </Pressable>
      </View>

      <View style={styles.ringRow}>
        <View style={styles.bigRing}>
          <Svg width={96} height={96} viewBox={`0 0 ${RING.viewBox} ${RING.viewBox}`}>
            <Circle cx={RING.cx} cy={RING.cy} r={RING.r} stroke={RING.track} strokeWidth={1.6} fill="none" />
            <Circle
              cx={RING.cx} cy={RING.cy} r={RING.r} stroke={P.edge} strokeWidth={1.6} fill="none" strokeLinecap="round"
              strokeDasharray={dash.dasharray} strokeDashoffset={dash.dashoffset}
              transform={`rotate(${RING.rotation} ${RING.cx} ${RING.cy})`}
            />
          </Svg>
          <View style={styles.ringCenter}>
            <AppText style={styles.pct}>{view.hours ? Math.round(s.pct * 100) + '%' : '—'}</AppText>
          </View>
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <AppText style={[styles.paceWord, pace.color ? { color: pace.color } : null]}>{pace.word}</AppText>
          <AppText style={styles.line}>{L.left}</AppText>
          <AppText style={styles.line}>{L.plan}</AppText>
          <AppText style={styles.line}>{L.daysLeft}</AppText>
        </View>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${s.pct * 100}%`, backgroundColor: P.edge, minWidth: s.pct > 0 ? 8 : 0 }]} />
        {view.hours && s.active ? <View style={[styles.mark, { width: `${exp * 100}%` }]} /> : null}
      </View>
      <AppText style={styles.expected}>{L.done} done {'·'} {L.donePct}{L.expected ? ' · ' + L.expected : ''}</AppText>

      <View style={styles.fields}>
        <View style={styles.field}>
          <AppText style={styles.flabel}>Target hours</AppText>
          <AppInput
            value={draft.hours}
            onChangeText={(v) => set({ hours: v.replace(/[^\d.]/g, '') })}
            keyboardType="decimal-pad"
            style={styles.fvalue}
            accessibilityLabel="Target hours"
          />
        </View>
        <View style={styles.field}>
          <AppText style={styles.flabel}>Deadline</AppText>
          {dateEdit ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {(['d', 'm', 'y'] as const).map((k, i) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <AppInput
                    autoFocus={i === 0}
                    value={dateEdit[k]}
                    onChangeText={(v) => setDateEdit({ ...dateEdit, [k]: v.replace(/\D/g, '').slice(0, k === 'y' ? 4 : 2) })}
                    onSubmitEditing={() => commitDate(dateEdit)}
                    onBlur={() => { if (k === 'y') commitDate(dateEdit); }}
                    keyboardType="number-pad"
                    style={[styles.fvalue, { width: k === 'y' ? 44 : 26, textAlign: 'center' }]}
                    accessibilityLabel={'Deadline ' + (k === 'd' ? 'day' : k === 'm' ? 'month' : 'year')}
                  />
                  {k !== 'y' ? <AppText style={{ color: text(0.3) }}>/</AppText> : null}
                </View>
              ))}
            </View>
          ) : (
            <Pressable onPress={() => setDateEdit(splitDeadline(draft.deadline))} accessibilityRole="button" accessibilityLabel="Change deadline">
              <AppText style={styles.fvalue}>{L.due}</AppText>
            </Pressable>
          )}
        </View>
      </View>

      <AppText style={styles.hueLbl}>Colour</AppText>
      <View style={styles.swatches}>
        {PICKER.map((h, i) => (
          <Pressable
            key={h}
            onPress={() => set({ hue: h })}
            accessibilityLabel={'Colour ' + (i + 1)}
            style={[styles.dot, { backgroundColor: paint(h).edge }, cur === h && styles.dotOn]}
          />
        ))}
      </View>
      {adjMode ? (
        <Pressable
          onPress={adjust}
          accessibilityRole="button"
          testID="goal-adjust"
          style={({ pressed }) => [styles.adjust, pressed && { backgroundColor: white(0.05), transform: [{ scale: 0.99 }] }]}
        >
          <AppText style={styles.adjustTxt}>{adjMode === 'reduce' ? 'Reduce scope' : 'Add stretch goal'}</AppText>
        </Pressable>
      ) : null}
    </KeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 4 },
  swatch: { width: 10, height: 38, borderRadius: 5, marginTop: 2 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2, color: '#f6f2ec' },
  outcome: { fontSize: 13, lineHeight: 18, color: text(0.55) },
  remove: {
    paddingVertical: 8, paddingHorizontal: 11, borderRadius: 9, backgroundColor: 'rgba(232,116,95,0.11)',
    borderWidth: 1, borderColor: 'rgba(232,116,95,0.24)',
  },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 20 },
  bigRing: { width: 96, height: 96 },
  ringCenter: { ...StyleSheet.absoluteFill as object, alignItems: 'center', justifyContent: 'center' },
  pct: { fontSize: 19, fontWeight: '600', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  paceWord: { fontSize: 17, fontWeight: '650' as never, letterSpacing: -0.3 },
  line: { fontSize: 12.5, color: text(0.55) },
  track: { height: 8, marginTop: 18, borderRadius: 4, backgroundColor: white(0.06), overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  mark: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: white(0.1) },
  expected: { fontSize: 12, color: text(0.45), marginTop: 7, fontVariant: ['tabular-nums'] },
  fields: { flexDirection: 'row', gap: 10, marginTop: 18 },
  field: { flex: 1, padding: 11, borderRadius: 12, backgroundColor: white(0.045), gap: 4 },
  flabel: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34) },
  fvalue: { fontSize: 15, fontWeight: '600', color: '#f6f2ec', fontVariant: ['tabular-nums'] },
  hueLbl: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34), marginTop: 18 },
  swatches: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 6 },
  dot: { flex: 1, maxWidth: 28, aspectRatio: 1, borderRadius: 14 },
  dotOn: { borderWidth: 2, borderColor: ACCENT },
  adjust: {
    minHeight: 42, marginTop: 14, marginBottom: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
    borderWidth: 1, borderColor: white(0.09),
  },
  adjustTxt: { fontSize: 13, fontWeight: '600', color: text(0.62) },
});
