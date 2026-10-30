import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  ACCENT, dnum, editEvent, key, toggleDone, white,
  type ProtoEvent,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { ToastHost } from '@/components/Toast';
import { getStore, useCalendarData, usePrefs, useSyncStatus } from '@/store';
import { stampSeen } from '../checkin/state';
import { CheckInHost } from '../checkin/CheckInHost';
import { GoalChips } from '../goals/GoalChips';
import { GoalsSheet } from '../goals/GoalsSheet';
import { commitQuiet, commitUndoable } from '../history/commit';
import { StoryHost } from '../story/StoryHost';
import { TimerOverlay, TimerPill } from '../timer/TimerUI';
import { openTimer, tickTimerNow, useTimer } from '../timer/store';
import { AllDayBand } from './AllDayBand';
import { CalendarGrid } from './CalendarGrid';
import { CalendarHeader, DayHeader } from './CalendarHeader';
import { ComposerSlot } from './ComposerSlot';
import { MonthView } from './MonthView';
import { dragLabel, type DragMode } from './gesture-math';
import {
  awayFromToday, goalSummary, monthTitle, packAllDay, startOfDay, stepFocus, titleFor, viewDays, type Mode,
} from './model';
import { maybeSeedDev } from './devSeed';
import { useNow } from './useNow';

const NAV_EASE = Easing.bezier(0.22, 0.9, 0.16, 1);

/** The calendar: header, day columns, grid, goal chips and the composer slot. */
export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const data = useCalendarData();
  const prefs = usePrefs();
  const now = useNow();
  const timer = useTimer();

  const [mode, setMode] = useState<Mode>(prefs.view);
  const [focus, setFocus] = useState<Date>(() => startOfDay(new Date()));
  const [navSeq, setNavSeq] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [bottomH, setBottomH] = useState(110);
  const sync = useSyncStatus();
  const params = useLocalSearchParams<{ day?: string; compose?: string }>();

  const tx = useSharedValue(0);
  const navOp = useSharedValue(1);
  const swipeX = useSharedValue(0);

  useEffect(() => { maybeSeedDev(); }, []);

  /* keep "last seen" fresh, as the prototype's two-minute stamp does */
  useEffect(() => {
    stampSeen();
    const t = setInterval(() => stampSeen(), 120000);
    return () => { clearInterval(t); stampSeen(); };
  }, []);

  /* the running timer ticks twice a second */
  useEffect(() => {
    if (!timer.tm) return;
    const t = setInterval(() => tickTimerNow(), 500);
    return () => clearInterval(t);
  }, [timer.tm]);

  const appW = Math.min(winW, 480);
  const week = mode === 'week';
  const nCols = week ? 7 : 3;
  const colW = Math.max(32, (appW - 66) / nCols);
  const days = useMemo(() => (mode === 'month' ? [] : viewDays(mode, focus)), [mode, focus]);

  const animate = useCallback((d: 1 | -1) => {
    setDir(d);
    setNavSeq((n) => n + 1);
    tx.set(d * 56);
    navOp.set(0);
    tx.set(withTiming(0, { duration: 380, easing: NAV_EASE }));
    navOp.set(withTiming(1, { duration: 240 }));
    swipeX.set(withTiming(0, { duration: 160 }));
  }, [tx, navOp, swipeX]);

  const go = useCallback((d: 1 | -1) => {
    setFocus((f) => stepFocus(mode, f, d));
    animate(d);
  }, [mode, animate]);

  const toToday = useCallback(() => {
    const t = startOfDay(new Date());
    animate(focus > t ? -1 : 1);
    setFocus(t);
  }, [focus, animate]);

  const pickMode = useCallback((m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setFocus(startOfDay(new Date()));
    animate(1);
    if (m !== 'month') getStore().setPrefs({ view: m });
  }, [mode, animate]);

  const openEvent = useCallback((id: string) => {
    router.push({ pathname: '/event/[id]', params: { id } });
  }, []);

  const doneToggle = useCallback((id: string) => {
    const d = getStore().getState().data;
    const ev = d.events.find((e) => e.id === id);
    if (!ev) return;
    commitQuiet(toggleDone(d, id), (ev.done ? 'Unchecked · ' : 'Done · ') + ev.title, 'edit');
  }, []);

  const commitDrag = useCallback((id: string, mode2: DragMode, start: number, end: number, dayIdx: number) => {
    const d = getStore().getState().data;
    const ev = d.events.find((e) => e.id === id);
    if (!ev) return;
    const day = days[dayIdx] ? key(days[dayIdx]) : ev.day;
    if (ev.start === start && ev.end === end && ev.day === day) return;
    commitUndoable(editEvent(d, id, { start, end, day }), dragLabel(mode2, ev.title), 'drag');
  }, [days]);

  const setZoom = useCallback((z: number) => getStore().setPrefs({ zoom: z }), []);

  const nowCtx = useMemo(() => ({ today: now.today, nowMin: now.nowMin, nowMs: now.nowMs }), [now.today, now.nowMin, now.nowMs]);
  const summary = useMemo(() => goalSummary(data.goals, data.events, nowCtx), [data.goals, data.events, nowCtx]);

  const title = mode === 'month' ? monthTitle(focus, now.today) : titleFor(days, now.today);
  const { items: allDayItems, rows: allDayRows } = useMemo(() => packAllDay(data.events, days), [data.events, days]);
  const away = awayFromToday(mode, focus, now.today);

  const jumpToDay = useCallback((d: Date) => {
    setMode('day3');
    setFocus(startOfDay(d));
    animate(1);
    getStore().setPrefs({ view: 'day3' });
  }, [animate]);

  /* deep link aicalendar://day/2026-10-30 -> /?day=...: jump to that date (adjusted during render, no effect) */
  const [seenDay, setSeenDay] = useState<string | undefined>(undefined);
  if (params.day !== seenDay) {
    setSeenDay(params.day);
    if (params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day)) {
      setMode((m) => (m === 'month' ? 'day3' : m));
      setFocus(startOfDay(dnum(params.day)));
    }
  }

  const openAllDay = useCallback((ev: ProtoEvent) => openEvent(ev.id), [openEvent]);

  const bottomPad = insets.bottom + 190;
  const hasTimerPill = !!timer.tm && !timer.tm.open;

  return (
    <View style={styles.page}>
      <View style={styles.app}>
        <CalendarHeader
          title={title}
          sub={summary.text}
          behind={summary.behind > 0}
          mode={mode}
          onMode={pickMode}
          onGoals={() => setGoalsOpen(true)}
          onSettings={() => router.push('/settings')}
          topInset={insets.top}
        >
          {mode === 'month' ? (
            <View style={styles.monthNav}>
              <Pressable onPress={() => go(-1)} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.mArrow}>
                <Icon name="chevronLeft" size={20} color="rgba(243,239,232,0.6)" strokeWidth={1.7} />
              </Pressable>
              <Pressable onPress={() => go(1)} accessibilityRole="button" accessibilityLabel="Next month" style={styles.mArrow}>
                <Icon name="chevronRight" size={20} color="rgba(243,239,232,0.6)" strokeWidth={1.7} />
              </Pressable>
            </View>
          ) : (
            <>
              <DayHeader
                days={days}
                colW={colW}
                week={week}
                todayKey={now.todayKey}
                navSeq={navSeq}
                dir={dir}
                tx={tx}
                swipeX={swipeX}
                onPrev={() => go(-1)}
                onNext={() => go(1)}
              />
              <AllDayBand items={allDayItems} rows={allDayRows} colW={colW} week={week} cats={data.cats} onOpen={openAllDay} />
            </>
          )}
        </CalendarHeader>

        {mode === 'month' ? (
          <View style={{ flex: 1 }}>
            <MonthView
              focus={focus}
              events={data.events}
              cats={data.cats}
              todayKey={now.todayKey}
              bottomPad={bottomPad}
              onDay={jumpToDay}
            />
          </View>
        ) : (
          <CalendarGrid
            days={days}
            week={week}
            events={data.events}
            cats={data.cats}
            zoom={prefs.zoom}
            sun={{ sunrise: prefs.sun.sunrise, sunset: prefs.sun.sunset }}
            nowMs={now.nowMs}
            nowMin={now.nowMin}
            todayKey={now.todayKey}
            colW={colW}
            bottomPad={bottomPad}
            timer={timer}
            tx={tx}
            navOp={navOp}
            swipeX={swipeX}
            onOpen={openEvent}
            onToggleDone={doneToggle}
            onCommitDrag={commitDrag}
            onZoom={setZoom}
            onSwipeNav={go}
          />
        )}

        <View
          style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}
          pointerEvents="box-none"
          onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}
        >
          <BottomFade />
          {sync === 'offline' ? (
            <View style={styles.returnWrap} pointerEvents="none">
              <View style={styles.offlinePill} testID="offline-pill">
                <Icon name="cloud" size={13} color={white(0.6)} />
                <AppText style={styles.offlineTxt}>Offline {'\u00b7'} changes sync when you\u2019re back</AppText>
              </View>
            </View>
          ) : null}
          {away ? (
            <View style={styles.returnWrap} pointerEvents="box-none">
              <Pressable onPress={toToday} accessibilityRole="button" style={({ pressed }) => [styles.returnPill, pressed && { transform: [{ scale: 0.95 }] }]}>
                <AppText style={styles.returnTxt}>Return to today</AppText>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.chipsRow} pointerEvents="box-none">
            {goalsOpen ? <View style={{ flex: 1 }} /> : (
              <GoalChips data={data} now={now} timerCtx={timer} onPress={() => setGoalsOpen(true)} />
            )}
            {hasTimerPill ? <TimerPill onPress={openTimer} /> : null}
          </View>
          <ComposerSlot focusToken={params.compose} />
        </View>

        <ToastHost bottom={bottomH + 4} />
        <TimerOverlay />
        {goalsOpen ? (
          <GoalsSheet
            onClosed={() => setGoalsOpen(false)}
            onOpenGoal={(id) => {
              setGoalsOpen(false);
              router.push({ pathname: '/goal/[id]', params: { id } });
            }}
          />
        ) : null}
        <CheckInHost busy={goalsOpen} />
        <StoryHost />
      </View>
    </View>
  );
}

/** The dark fade behind the goal chips and composer, so grid content dims as it scrolls under them. */
function BottomFade() {
  return (
    <View pointerEvents="none" style={styles.fade}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#100f0e" stopOpacity="0" />
            <Stop offset="0.1" stopColor="#100f0e" stopOpacity="0.14" />
            <Stop offset="0.24" stopColor="#100f0e" stopOpacity="0.4" />
            <Stop offset="0.44" stopColor="#100f0e" stopOpacity="0.78" />
            <Stop offset="0.62" stopColor="#100f0e" stopOpacity="0.92" />
            <Stop offset="1" stopColor="#100f0e" stopOpacity="0.94" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100f0e', alignItems: 'center' },
  app: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: '#171615', overflow: 'hidden' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 45, paddingTop: 9, paddingHorizontal: 12 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, top: -104 },
  returnWrap: { alignItems: 'center', paddingBottom: 9 },
  returnPill: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: white(0.06),
    borderWidth: 1, borderColor: white(0.09),
  },
  offlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999,
    backgroundColor: white(0.06), borderWidth: 1, borderColor: white(0.09),
  },
  offlineTxt: { fontSize: 12, color: white(0.6) },
  returnTxt: { fontSize: 12.5, fontWeight: '600', letterSpacing: -0.1, color: ACCENT },
  chipsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -9, marginTop: 4, height: 36 },
  mArrow: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
});
