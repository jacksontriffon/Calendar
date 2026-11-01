import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import {
  goalChartModel, paint, paceOf, removeGoal, sortGoals, text, white, type ChartUnit, type NowCtx, type ProtoGoal,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { KeyboardScrollView } from '@/components/KeyboardScrollView';
import { Sheet, useSheetClose } from '@/components/Sheet';
import { getStore, useCalendarData, usePrefs } from '@/store';
import { useNow } from '../calendar/useNow';
import { composer } from '../composer/instance';
import { commitQuiet, commitUndoable } from '../history/commit';
import { useTimer } from '../timer/store';
import { GoalChart } from './GoalChart';
import { GoalDetailPane } from './GoalDetailPane';
import { GoalUnitToggle } from './GoalUnitToggle';
import { PacePill } from './PacePill';
import { applyGoalDraft, draftOf, draftPatch, newGoalIn, type GoalDraft } from './model';

interface Props {
  onClosed: () => void;
  /** open drilled into this goal (the `aicalendar://goal/{id}` link and widget taps) */
  initialGoalId?: string | null;
  testID?: string;
}

/**
 * The goals sheet, as in the prototype: a Days / Weeks / Months toggle, the cumulative progress graph, and a grid of
 * goal cards ending in a dashed "New goal" tile. Tapping a card drills into the same sheet: the graph filters to that
 * goal and the card grid is replaced by its detail.
 */
export function GoalsSheet({ onClosed, initialGoalId, testID = 'goals-sheet' }: Props) {
  return (
    <Sheet onClosed={onClosed} testID={testID}>
      <Body initialGoalId={initialGoalId ?? null} />
    </Sheet>
  );
}

function Body({ initialGoalId }: { initialGoalId: string | null }) {
  const close = useSheetClose();
  const data = useCalendarData();
  const now = useNow();
  const timer = useTimer();
  const aiOn = usePrefs().ai.on;
  const reduce = useReducedMotion();
  const { height: winH } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [unit, setUnit] = useState<ChartUnit>('week');
  /* opened from a link: start drilled into that goal (an unknown id just shows the list) */
  const [boot] = useState(() => {
    const g = initialGoalId ? getStore().getState().data.goals.find((x) => x.id === initialGoalId) : undefined;
    return g ? { id: g.id, d: draftOf(g) } : null;
  });
  const [focusId, setFocusId] = useState<string | null>(boot?.id ?? null);
  /** bumps on each drill in/out so the graph replays its animations */
  const [seq, setSeq] = useState(0);

  /* the edit draft for the focused goal: kept in a ref too so closing the sheet can flush it */
  const [draft, setDraftState] = useState<GoalDraft | null>(boot?.d ?? null);
  const draftRef = useRef<{ id: string; d: GoalDraft } | null>(boot);

  const ctx: NowCtx = useMemo(
    () => ({ today: now.today, nowMin: now.nowMin, nowMs: now.nowMs, timer }),
    [now.today, now.nowMin, now.nowMs, timer],
  );
  const goals = useMemo(() => sortGoals(data.goals), [data.goals]);

  /** Save the draft as one undoable History entry (nothing when nothing changed). */
  const flush = useCallback(() => {
    const cur = draftRef.current;
    draftRef.current = null;
    if (!cur) return;
    const live = getStore().getState().data;
    const goal = live.goals.find((x) => x.id === cur.id);
    if (!goal) return;
    const next = applyGoalDraft(live, goal, cur.d);
    if (next !== live) commitUndoable(next, 'Edited · ' + (cur.d.title.trim() || goal.title), 'edit');
  }, []);
  useEffect(() => () => flush(), [flush]);

  const focus = useCallback((g: ProtoGoal) => {
    const d = draftOf(g);
    draftRef.current = { id: g.id, d };
    setDraftState(d);
    setFocusId(g.id);
    setSeq((n) => n + 1);
  }, []);

  const back = useCallback(() => {
    flush();
    setDraftState(null);
    setFocusId(null);
    setSeq((n) => n + 1);
  }, [flush]);

  const setDraft = (p: Partial<GoalDraft>) => {
    const cur = draftRef.current;
    if (!cur) return;
    const d = { ...cur.d, ...p };
    draftRef.current = { id: cur.id, d };
    setDraftState(d);
  };

  const add = () => {
    const r = newGoalIn(getStore().getState().data, Date.now(), now.today);
    commitQuiet(r.data, 'Goal added', 'edit');
    const g = r.data.goals.find((x) => x.id === r.id);
    if (g) focus(g);
  };

  const stored = focusId ? data.goals.find((g) => g.id === focusId) ?? null : null;
  const view = useMemo(
    () => (stored && draft ? ({ ...stored, ...draftPatch(stored, draft) } as ProtoGoal) : null),
    [stored, draft],
  );
  const shown = useMemo(() => (view ? [view] : goals), [view, goals]);
  const model = useMemo(() => goalChartModel(shown, data.events, ctx, unit), [shown, data.events, ctx, unit]);

  const adjust = (mode: 'reduce' | 'stretch') => {
    if (!focusId) return;
    if (!aiOn) {
      composer.startGoalAdjust(focusId, mode); // explains that Claude is off, and keeps the sheet open
      return;
    }
    const id = focusId;
    flush();
    close();
    setTimeout(() => composer.startGoalAdjust(id, mode), 280);
  };

  const remove = () => {
    if (!stored) return;
    draftRef.current = null; // deleting discards the unsaved edits
    commitUndoable(removeGoal(getStore().getState().data, stored.id), 'Removed goal · ' + stored.title, 'delete');
    setDraftState(null);
    setFocusId(null);
    setSeq((n) => n + 1);
  };

  const has = goals.length > 0;
  const enter = (delay: number) => (reduce ? undefined : FadeInDown.duration(500).delay(delay));

  return (
    <KeyboardScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ maxHeight: Math.round(winH * 0.9) - 64 }}
    >
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={styles.head}>
          {view ? (
            <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="All goals" style={styles.back} testID="goal-back">
              <Icon name="chevronLeft" size={13} color={text(0.62)} strokeWidth={1.7} />
              <AppText style={styles.backTxt}>Goals</AppText>
            </Pressable>
          ) : (
            <AppText style={styles.title} accessibilityRole="header">Goals</AppText>
          )}
          <View style={{ flex: 1 }} />
          {has ? <GoalUnitToggle unit={unit} onChange={setUnit} /> : null}
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close goals" style={styles.closeBtn}>
            <Icon name="close" size={12} color={text(0.62)} strokeWidth={1.6} />
          </Pressable>
        </View>

        {has ? (
          <GoalChart model={model} width={width} replayKey={unit + '|' + seq} />
        ) : (
          <Animated.View entering={enter(100)}>
            <AppText style={styles.empty}>
              No goals yet. Tell Claude what you want to achieve and by when, and it will work out the hours with you.
            </AppText>
          </Animated.View>
        )}

        {view && draft ? (
          <Animated.View key={view.id} entering={enter(40)}>
            <GoalDetailPane view={view} draft={draft} ctx={ctx} onDraft={setDraft} onDelete={remove} onAdjust={adjust} />
          </Animated.View>
        ) : has ? (
          <Animated.View entering={enter(300)}>
            <GoalGrid goals={goals} width={width} ctx={ctx} onOpen={focus} onAdd={add} />
          </Animated.View>
        ) : (
          <Pressable onPress={add} accessibilityRole="button" style={styles.addEmpty} testID="goal-add">
            <AppText style={styles.addEmptyTxt}>+ New goal</AppText>
          </Pressable>
        )}
      </View>
    </KeyboardScrollView>
  );
}

const GAP = 8;

/** Three goal cards a row (name, two lines of outcome, pace pill) and the dashed "New goal" tile that wraps with them. */
function GoalGrid({ goals, width, ctx, onOpen, onAdd }: {
  goals: ProtoGoal[]; width: number; ctx: NowCtx; onOpen: (g: ProtoGoal) => void; onAdd: () => void;
}) {
  const data = useCalendarData();
  const cell = Math.floor((width - GAP * 2) / 3);
  return (
    <ScrollView style={styles.gridScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
      <View style={styles.grid}>
        {goals.map((g) => {
          const pace = paceOf(g, data.events, ctx);
          return (
            <Pressable
              key={g.id}
              onPress={() => onOpen(g)}
              accessibilityRole="button"
              accessibilityLabel={g.title}
              style={({ pressed }) => [styles.card, { width: cell }, pressed && { transform: [{ scale: 0.98 }] }]}
              testID="goal-row"
            >
              <AppText style={styles.name} numberOfLines={1}>{g.title}</AppText>
              <AppText style={styles.outcome} numberOfLines={2}>{g.outcome || 'No specific outcome yet'}</AppText>
              <View style={{ flex: 1 }} />
              <PacePill pace={pace} />
              <View style={[styles.edge, { backgroundColor: paint(g.hue).edge }]} />
            </Pressable>
          );
        })}
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="New goal"
          style={({ pressed }) => [styles.newTile, { width: cell }, pressed && { transform: [{ scale: 0.98 }] }]}
          testID="goal-add"
        >
          <AppText style={styles.plus}>+</AppText>
          <AppText style={styles.newTxt}>New goal</AppText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, paddingBottom: 12 },
  title: { fontSize: 16, fontWeight: '650' as never, letterSpacing: -0.3, color: '#f3efe8' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingLeft: 2, paddingRight: 7, marginLeft: -3, borderRadius: 7 },
  backTxt: { fontSize: 13.5, fontWeight: '600', letterSpacing: -0.1, color: text(0.62) },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.07) },
  empty: { fontSize: 13, lineHeight: 18, color: text(0.6), paddingHorizontal: 2, paddingBottom: 10 },
  addEmpty: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: white(0.06) },
  addEmptyTxt: { fontSize: 12.5, fontWeight: '600', color: text(0.7) },
  gridScroll: { maxHeight: 330, paddingTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: {
    minHeight: 104, paddingVertical: 10, paddingHorizontal: 9, gap: 3, borderRadius: 12, backgroundColor: white(0.045), overflow: 'hidden',
  },
  name: { fontSize: 13, fontWeight: '600', letterSpacing: -0.2, color: '#f6f2ec' },
  outcome: { fontSize: 11.5, lineHeight: 15, color: text(0.55) },
  edge: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, opacity: 0.4 },
  newTile: {
    minHeight: 104, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 12, borderWidth: 2,
    borderStyle: 'dashed', borderColor: white(0.2),
  },
  plus: { fontSize: 20, lineHeight: 22, color: text(0.5) },
  newTxt: { fontSize: 12, fontWeight: '550' as never, color: text(0.5) },
});
