import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, {
  Easing, scrollTo, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useScrollOffset,
  useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import {
  ACCENT, SURFACE, fmt, hueFor, isPending, key, paint, stepFor, text, white, workedMins, timerInfo, livePauses, minsIn,
  type CatMap, type ProtoEvent, type TimerState,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { useStoreState } from '@/store';
import { getLastSeen } from '../checkin/state';
import { EventBlock, type BlockTimer } from './EventBlock';
import { GridContext, type GridCtx } from './ctx';
import {
  anchoredScroll, pinchStep, stepZoom, swipeDir, swipeOffset, zoomLabel, type DragMode,
} from './gesture-math';
import {
  GRID_PAD_LEFT, GUTTER, HOURS, dayLayout, hourHeightFor, hourLabel, minBlockH, sunStops, visibleHours, type Seg,
} from './model';

const AnimatedScrollView = Animated.ScrollView;
const ZOOM_EASE = Easing.inOut(Easing.cubic);

interface Props {
  days: Date[];
  week: boolean;
  events: ProtoEvent[];
  cats: CatMap;
  zoom: number;
  sun: { sunrise: number; sunset: number };
  nowMs: number;
  nowMin: number;
  todayKey: string;
  colW: number;
  bottomPad: number;
  timer: { tm: TimerState | null; tmNow: number };
  /** page slide + swipe offset, owned by the screen (the header follows them) */
  tx: SharedValue<number>;
  navOp: SharedValue<number>;
  swipeX: SharedValue<number>;
  onOpen: (id: string) => void;
  onToggleDone: (id: string) => void;
  /** a drag/resize finished: the new times and column */
  onCommitDrag: (id: string, mode: DragMode, start: number, end: number, dayIdx: number) => void;
  onZoom: (z: number) => void;
  onSwipeNav: (dir: 1 | -1) => void;
}

interface Ghost { id: string; mode: DragMode; seg: Seg; x: number; w: number; hue: number }

function CalendarGridImpl(p: Props) {
  const { days, week, events, cats, zoom, nowMs, nowMin, todayKey, colW, bottomPad, timer } = p;
  const font = useStoreState((s) => s.prefs.font);
  const [viewportH, setViewportH] = useState(0);
  const hhTarget = hourHeightFor({ zoom, week, viewportH });
  const dense = hhTarget < 34;
  const nCols = days.length;
  const step = stepFor(zoom);

  /* ----- shared values (UI thread) ----- */
  const hh = useSharedValue(hhTarget);
  const zoomSV = useSharedValue(zoom);
  const anchoring = useSharedValue(false);
  const anchorHour = useSharedValue(0);
  const anchorY = useSharedValue(0);
  const dragOn = useSharedValue(false);
  const dragId = useSharedValue('');
  const dragStart = useSharedValue(0);
  const dragEnd = useSharedValue(0);
  const dragDay = useSharedValue(0);
  const dragMoved = useSharedValue(false);
  const pinchBase = useSharedValue(1);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scrollRef);

  /* zoom: animate the hour height to its new target (the pinch's anchor keeps the focus hour in place) */
  const firstHh = useRef(true);
  useEffect(() => {
    zoomSV.set(zoom);
    if (!viewportH) return;
    if (firstHh.current) {
      firstHh.current = false;
      hh.set(hhTarget);
      return;
    }
    hh.set(withTiming(hhTarget, { duration: 260, easing: ZOOM_EASE }, () => {
      anchoring.set(false);
    }));
  }, [hhTarget, zoom, viewportH, hh, zoomSV, anchoring]);

  useAnimatedReaction(
    () => hh.value,
    (cur) => {
      if (anchoring.value) scrollTo(scrollRef, 0, anchoredScroll(anchorHour.value, anchorY.value, cur), false);
    },
  );

  /* start the day at "now minus 90 minutes", once the viewport is known */
  const scrolled = useRef(false);
  useEffect(() => {
    if (!viewportH || scrolled.current) return;
    scrolled.current = true;
    const y = (Math.max(nowMin - 90, 0) / 60) * hhTarget;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: false }));
  }, [viewportH, nowMin, hhTarget, scrollRef]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setViewportH(Math.round(e.nativeEvent.layout.height)), []);

  /* ----- layout per day (memoised) ----- */
  const layouts = useMemo(
    () => days.map((d) => {
      const dk = key(d);
      const pk = key(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
      return { dk, laid: dayLayout(events, dk, pk) };
    }),
    [days, events],
  );

  /* ----- drag ghost ----- */
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);
  const layoutsRef = useRef(layouts);
  const lastOpen = useRef(0);
  const cbRef = useRef(p);
  useEffect(() => {
    layoutsRef.current = layouts;
    cbRef.current = p;
  });

  const haptic = useCallback((kind: 'start' | 'snap') => {
    try {
      if (kind === 'start') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else void Haptics.selectionAsync();
    } catch {
      /* haptics are best effort */
    }
  }, []);

  const ctx = useMemo<GridCtx>(() => ({
    hh, dragOn, dragId, dragStart, dragEnd, dragDay, dragMoved,
    onOpen: (id) => {
      const t = Date.now();
      if (t - lastOpen.current < 450) return;
      lastOpen.current = t;
      cbRef.current.onOpen(id);
    },
    onToggleDone: (id) => cbRef.current.onToggleDone(id),
    onDragStart: (id, mode) => {
      for (const l of layoutsRef.current) {
        const it = l.laid.find((x) => x.ev.id === id && x.ev.part !== 'second');
        if (it) {
          setGhost({ id, mode, seg: it.ev, x: it.x, w: it.w, hue: hueFor(cbRef.current.cats, it.ev.ev.cat ?? '') });
          setLive({ start: it.ev.fullStart, end: it.ev.fullEnd });
          break;
        }
      }
      haptic('start');
    },
    onDragLive: (start, end) => {
      setLive({ start, end });
      haptic('snap');
    },
    onDragEnd: (id, mode, start, end, dayIdx, moved) => {
      setGhost(null);
      setLive(null);
      if (!moved) {
        ctx.onOpen(id);
        return;
      }
      cbRef.current.onCommitDrag(id, mode, start, end, dayIdx);
    },
    onDragCancel: () => {
      setGhost(null);
      setLive(null);
    },
   
  }), [hh, dragOn, dragId, dragStart, dragEnd, dragDay, dragMoved, haptic]);

  /* ----- gestures: horizontal swipe + pinch zoom, alongside the native vertical scroll ----- */
  const swipe = usePanGesture({
    minPointers: 1,
    maxPointers: 1,
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      if (dragOn.value) return;
      p.swipeX.set(swipeOffset(e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      const d = dragOn.value || e.canceled ? 0 : swipeDir(e.translationX);
      if (d !== 0) scheduleOnRN(p.onSwipeNav, d);
      else p.swipeX.set(withTiming(0, { duration: 260 }));
    },
  });

  const zoomHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const applyZoom = useCallback((z: number) => {
    p.onZoom(z);
    setHint(zoomLabel(z));
    if (zoomHintTimer.current) clearTimeout(zoomHintTimer.current);
    zoomHintTimer.current = setTimeout(() => setHint(null), 950);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.onZoom]);
  useEffect(() => () => { if (zoomHintTimer.current) clearTimeout(zoomHintTimer.current); }, []);

  const pinch = usePinchGesture({
    onActivate: () => {
      'worklet';
      pinchBase.set(1);
    },
    onUpdate: (e) => {
      'worklet';
      const s = pinchStep(e.scale / pinchBase.value);
      if (s === 0) return;
      pinchBase.set(e.scale);
      const z = stepZoom(zoomSV.value, s);
      if (z === zoomSV.value) return;
      zoomSV.set(z);
      anchorHour.set((scrollY.value + e.focalY) / hh.value);
      anchorY.set(e.focalY);
      anchoring.set(true);
      scheduleOnRN(applyZoom, z);
    },
  });
  const gestures = useSimultaneousGestures(swipe, pinch);

  /* ----- animated styles ----- */
  const slide = useAnimatedStyle(() => ({
    opacity: p.navOp.value,
    transform: [{ translateX: p.tx.value + p.swipeX.value }],
  }));
  const bodyH = useAnimatedStyle(() => ({ height: HOURS * hh.value }));
  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: !dragOn.value }));

  const stops = useMemo(() => sunStops(p.sun.sunrise, p.sun.sunset), [p.sun.sunrise, p.sun.sunset]);
  const hours = visibleHours(hhTarget);
  const todayIdx = days.findIndex((d) => key(d) === todayKey);

  const tmCtx = useMemo(() => ({ tm: timer.tm, tmNow: timer.tmNow, nowMs }), [timer.tm, timer.tmNow, nowMs]);

  const blockTimer = (ev: ProtoEvent): BlockTimer | null => {
    const tm = timer.tm;
    if (!tm || tm.id !== ev.id) return null;
    const info = timerInfo(tm, timer.tmNow);
    const worked = workedMins(ev, minsIn(ev.day, timer.tmNow), tmCtx);
    const h = Math.floor(worked / 60);
    const m = Math.round(worked % 60);
    return {
      txt: info.txt, over: info.over, paused: tm.paused,
      worked: h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm',
      pauses: tm.paused && tm.pStart != null ? livePauses(ev, tmCtx).concat([[tm.pStart, ev.end]]) : livePauses(ev, tmCtx),
    };
  };

  const lastSeen = getLastSeen();

  return (
    <GridContext.Provider value={ctx}>
      <View style={styles.scroll}>
      <GestureDetector gesture={gestures}>
        <AnimatedScrollView
          ref={scrollRef}
          animatedProps={scrollProps}
          onLayout={onLayout}
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          testID="calendar-scroll"
        >
          <Animated.View style={[styles.body, { paddingLeft: GRID_PAD_LEFT, minWidth: '100%' }, bodyH, slide]}>
            <View style={{ width: GUTTER }}>
              {hours.map((h) => <HourLabel key={h} h={h} hh={hh} font={font} />)}
            </View>
            <View style={{ width: colW * nCols }} testID="calendar-columns">
              {stops ? (
                <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
                  <Defs>
                    <LinearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
                      {stops.map((s, i) => <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />)}
                    </LinearGradient>
                  </Defs>
                  <Rect x="0" y="0" width="100%" height="100%" fill="url(#sun)" />
                </Svg>
              ) : null}
              {hours.map((h) => <HourLine key={h} h={h} hh={hh} />)}
              {days.map((d, i) => (
                <View
                  key={key(d)}
                  pointerEvents="none"
                  style={[
                    styles.colEdge,
                    { left: i * colW, width: colW, backgroundColor: key(d) === todayKey ? 'rgba(255,255,255,0.018)' : 'transparent' },
                  ]}
                />
              ))}
              {layouts.map((l, di) => l.laid.map((it) => {
                const ev = it.ev.ev;
                return (
                  <EventBlock
                    key={l.dk + ':' + it.ev.id + ':' + it.ev.part}
                    item={it}
                    dayIdx={di}
                    nCols={nCols}
                    colW={colW}
                    week={week}
                    dense={dense}
                    hhTarget={hhTarget}
                    hue={hueFor(cats, ev.cat ?? '')}
                    nowMs={nowMs}
                    nowMin={nowMin}
                    dk={l.dk}
                    todayKey={todayKey}
                    pending={isPending(ev, nowMs, lastSeen)}
                    step={step}
                    timer={blockTimer(ev)}
                    initials={undefined}
                  />
                );
              }))}
              {todayIdx >= 0 ? <NowLine hh={hh} nowMin={nowMin} left={todayIdx * colW - 3} width={colW + 3} /> : null}
              {ghost ? (
                <DragGhost ghost={ghost} live={live} colW={colW} week={week} dense={dense} hh={hh} ctx={ctx} />
              ) : null}
            </View>
          </Animated.View>
        </AnimatedScrollView>
      </GestureDetector>
      {hint ? (
        <View pointerEvents="none" style={styles.hintWrap}>
          <View style={styles.hint}><AppText style={styles.hintTxt}>{hint}</AppText></View>
        </View>
      ) : null}
      </View>
    </GridContext.Provider>
  );
}

export const CalendarGrid = memo(CalendarGridImpl);

function HourLabel({ h, hh, font }: { h: number; hh: SharedValue<number>; font: string }) {
  const style = useAnimatedStyle(() => ({ top: Math.max(h * hh.value - 6, 0) }));
  const major = h === 0 || h === 12 || h === 24;
  return (
    <Animated.View pointerEvents="none" style={[styles.hourLabel, style]}>
      <AppText
        style={{
          fontSize: font === 'mono' ? 9 : 10.5, letterSpacing: font === 'mono' ? -0.2 : 0.2,
          color: major ? text(0.42) : text(0.26), fontVariant: ['tabular-nums'],
        }}
      >
        {hourLabel(h)}
      </AppText>
    </Animated.View>
  );
}

function HourLine({ h, hh }: { h: number; hh: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ top: h * hh.value }));
  return <Animated.View pointerEvents="none" style={[styles.hourLine, style]} />;
}

function NowLine({ hh, nowMin, left, width }: { hh: SharedValue<number>; nowMin: number; left: number; width: number }) {
  const style = useAnimatedStyle(() => ({ top: (nowMin / 60) * hh.value }));
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 2800, easing: Easing.out(Easing.quad) }), -1, false));
  }, [pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 2.4 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.now, { left, width }, style]} testID="now-line">
      <Animated.View style={[styles.nowDot, ring]} />
      <View style={styles.nowDot} />
    </Animated.View>
  );
}

interface GhostProps {
  ghost: Ghost;
  live: { start: number; end: number } | null;
  colW: number;
  week: boolean;
  dense: boolean;
  hh: SharedValue<number>;
  ctx: GridCtx;
}

/** The block being dragged or resized, lifted above the grid and following the finger on the UI thread. */
function DragGhost({ ghost, live, colW, week, dense, hh, ctx }: GhostProps) {
  const P = paint(ghost.hue);
  const minH = minBlockH(week, dense);
  const laneX = ghost.x;
  const laneW = ghost.w;
  const lifted = ghost.mode === 'move';
  const style = useAnimatedStyle(() => ({
    top: (ctx.dragStart.value / 60) * hh.value,
    height: Math.max(((ctx.dragEnd.value - ctx.dragStart.value) / 60) * hh.value, minH),
    left: ctx.dragDay.value * colW + 2 + laneX * (colW - 4),
    transform: [{ scale: lifted && ctx.dragMoved.value ? 1.035 : 1 }],
  }));
  const ev = ghost.seg.ev;
  const w = (colW - 4) * laneW - 1.5;
  return (
    <Animated.View
      pointerEvents="none"
      testID="drag-ghost"
      style={[
        styles.ghost,
        { width: w, backgroundColor: P.fill, borderColor: P.edge, borderLeftColor: P.edge },
        style,
      ]}
    >
      <AppText numberOfLines={1} style={{ fontSize: week || dense ? 10.5 : 12, fontWeight: '600', color: P.ink }}>{ev.title}</AppText>
      {live ? (
        <View style={[styles.bubble, { backgroundColor: SURFACE.sheet, borderColor: white(0.12) }]}>
          <AppText style={styles.bubbleTxt}>{fmt(live.start)}{'–'}{fmt(live.end)}</AppText>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  body: { flexDirection: 'row' },
  hourLabel: { position: 'absolute', right: 7 },
  hourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: SURFACE.grid },
  colEdge: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.055)' },
  now: { position: 'absolute', height: 1.5, backgroundColor: ACCENT, zIndex: 20 },
  nowDot: { position: 'absolute', left: -2, top: -3, width: 7, height: 7, borderRadius: 3.5, backgroundColor: ACCENT },
  ghost: {
    position: 'absolute', zIndex: 30, borderWidth: 1, borderLeftWidth: 2, borderRadius: 6, paddingTop: 4, paddingLeft: 6, paddingRight: 5,
    shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 15, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  bubble: {
    position: 'absolute', top: -26, left: 0, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
  },
  bubbleTxt: { fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hintWrap: { position: 'absolute', top: '50%', left: 0, right: 0, alignItems: 'center', zIndex: 68 },
  hint: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(20,19,18,0.86)',
    borderWidth: 1, borderColor: white(0.09),
  },
  hintTxt: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, color: text(0.82), fontVariant: ['tabular-nums'] },
});
