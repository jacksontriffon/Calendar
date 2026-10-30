import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  SURFACE, evEndMs, fmtShort, mixOklab, paint, text, type LaidOut, type Pause,
} from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useGridCtx } from './ctx';
import { dragOutcome, type DragMode } from './gesture-math';
import { blockMetrics, metaText, type Seg } from './model';

export interface BlockTimer {
  txt: string;
  over: boolean;
  paused: boolean;
  /** "1h 5m" tracked time shown in the meta line */
  worked: string;
  /** pauses to draw as faint bars, in minutes past the event's day start */
  pauses: Pause[];
}

export interface BlockProps {
  item: LaidOut<Seg>;
  dayIdx: number;
  nCols: number;
  colW: number;
  week: boolean;
  dense: boolean;
  /** pixels per hour the zoom is animating to (drives the size thresholds) */
  hhTarget: number;
  hue: number;
  nowMs: number;
  nowMin: number;
  dk: string;
  todayKey: string;
  /** ended since the user last looked and still unconfirmed */
  pending: boolean;
  /** drag snap step in minutes (core stepFor(zoom)) */
  step: number;
  timer: BlockTimer | null;
  /** creator initials for someone else's event */
  initials?: string;
}

const SLOP = 3;

function EventBlockImpl(p: BlockProps) {
  const ctx = useGridCtx();
  const { item, dayIdx, nCols, colW, week, dense, hhTarget, hue, nowMs, nowMin, dk, todayKey, pending, step, timer } = p;
  const seg = item.ev;
  const ev = seg.ev;
  const id = seg.id;
  const P = paint(hue);
  const mine = ev.isMine !== false;
  const laneW = (colW - 4) * item.w;
  const left = dayIdx * colW + 2 + item.x * (colW - 4);
  const width = laneW - 1.5;
  const minH = week ? 15 : dense ? 13 : 22;
  const hT = Math.max(((seg.end - seg.start) / 60) * hhTarget, minH);
  const elapsed = evEndMs(ev) <= nowMs;
  const scheduledAhead = !ev.at || ev.at < evEndMs(ev);
  const needsConfirm = elapsed && !ev.done && scheduledAhead && mine && ev.source !== 'device';
  const m = blockMetrics({
    h: hT, w: laneW, week, dense, part: seg.part, needsConfirm,
    hasWin: !!ev.win, isPublic: ev.visibility === 'public',
  });
  const isFuture = dk > todayKey || (dk === todayKey && seg.fullStart > nowMin);
  const winText = seg.part !== 'second' && ev.win ? String(ev.win.text || '').trim() : '';
  const tmHere = !!timer && seg.part !== 'second' && laneW >= 46;
  const winMark = !!winText && laneW >= 26 && !tmHere;
  const showWinTxt = !!winText && !week && !dense && hT >= 64 && laneW >= 60;
  const winLines = showWinTxt ? Math.max(1, Math.min(3, Math.floor((hT - 44) / 12))) : 0;
  const fill = needsConfirm ? 'transparent' : isFuture ? mixOklab(P.fill, 55, SURFACE.bg) : P.fill;
  const radius = seg.part === 'first' ? [6, 6, 2, 2] : seg.part === 'second' ? [2, 2, 6, 6] : [6, 6, 6, 6];
  const small = week || dense;
  const showOnOther = ev.source === 'google' || ev.source === 'device';
  const mover = mine && ev.source !== 'device';

  const startMin = seg.start;
  const endMin = seg.end;

  const boxStyle = useAnimatedStyle(() => {
    const dragging = ctx.dragOn.value && ctx.dragId.value === id;
    return {
      top: (startMin / 60) * ctx.hh.value,
      height: Math.max(((endMin - startMin) / 60) * ctx.hh.value, minH),
      opacity: dragging ? 0.28 : 1,
    };
  });
  const topHandleStyle = useAnimatedStyle(() => ({ top: (startMin / 60) * ctx.hh.value - 6 }));
  const botHandleStyle = useAnimatedStyle(() => ({
    top: (endMin / 60) * ctx.hh.value - Math.min(22, Math.max(12, hT * 0.42)) + 6,
  }));
  const checkStyle = useAnimatedStyle(() => ({ top: (startMin / 60) * ctx.hh.value + 1 }));

  const open = useCallback(() => ctx.onOpen(id), [ctx, id]);
  const toggle = useCallback(() => ctx.onToggleDone(id), [ctx, id]);

  const tap = useTapGesture({
    maxDuration: 500,
    onActivate: () => {
      'worklet';
      scheduleOnRN(open);
    },
  });

  const makePan = (mode: DragMode) => ({
    activateAfterLongPress: 160,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      ctx.dragId.value = id;
      ctx.dragStart.value = seg.fullStart;
      ctx.dragEnd.value = seg.fullEnd;
      ctx.dragDay.value = dayIdx;
      ctx.dragMoved.value = false;
      ctx.dragOn.value = true;
      scheduleOnRN(ctx.onDragStart, id, mode);
    },
    onUpdate: (e: { translationX: number; translationY: number }) => {
      'worklet';
      if (!ctx.dragOn.value) return;
      const r = dragOutcome(
        mode, { start: seg.fullStart, end: seg.fullEnd, dayIdx }, e.translationY, e.translationX, ctx.hh.value, colW, nCols, step,
      );
      if (Math.abs(e.translationX) > SLOP || Math.abs(e.translationY) > SLOP) ctx.dragMoved.value = true;
      if (r.start !== ctx.dragStart.value || r.end !== ctx.dragEnd.value || r.dayIdx !== ctx.dragDay.value) {
        ctx.dragStart.value = r.start;
        ctx.dragEnd.value = r.end;
        ctx.dragDay.value = r.dayIdx;
        scheduleOnRN(ctx.onDragLive, r.start, r.end, r.dayIdx);
      }
    },
    onDeactivate: (e: { canceled: boolean; translationX: number; translationY: number }) => {
      'worklet';
      if (!ctx.dragOn.value) return;
      const moved = ctx.dragMoved.value;
      ctx.dragOn.value = false;
      if (e.canceled) {
        scheduleOnRN(ctx.onDragCancel);
        return;
      }
      scheduleOnRN(ctx.onDragEnd, id, mode, ctx.dragStart.value, ctx.dragEnd.value, ctx.dragDay.value, moved);
    },
  });

  const movePan = usePanGesture(makePan('move'));
  const topPan = usePanGesture(makePan('top'));
  const botPan = usePanGesture(makePan('bottom'));
  const bodyGesture = useSimultaneousGestures(tap, movePan);
  const checkTap = useTapGesture({
    onActivate: () => {
      'worklet';
      scheduleOnRN(toggle);
    },
  });

  const titleRight = m.showCheck ? 16 : tmHere && timer ? timer.txt.length * 6 + 6 : winMark ? 9 : 0;

  return (
    <>
      <GestureDetector gesture={mover ? bodyGesture : tap}>
        <Animated.View
          accessibilityRole="button"
          accessibilityLabel={ev.title + ', ' + metaText(seg.fullStart, seg.fullEnd, fmtShort)}
          style={[
            styles.block,
            {
              left,
              width,
              backgroundColor: fill,
              borderColor: !mine ? text(0.42) : isFuture || needsConfirm ? P.line : 'transparent',
              borderStyle: isFuture && mine ? 'dashed' : 'solid',
              borderWidth: 1,
              borderLeftWidth: mine ? 2 : 1,
              borderLeftColor: mine ? P.edge : text(0.42),
              borderTopLeftRadius: radius[0], borderTopRightRadius: radius[1],
              borderBottomRightRadius: radius[2], borderBottomLeftRadius: radius[3],
              paddingTop: small ? 2 : 4, paddingLeft: small ? 4 : 6, paddingRight: small ? 3 : 5,
            },
            boxStyle,
          ]}
        >
          {timer?.pauses.map((pz, i) => {
            const pOff = seg.part === 'second' ? 1440 : 0;
            const x = Math.max(pz[0] - pOff, seg.start);
            const y = Math.min(pz[1] - pOff, seg.end);
            if (y <= x) return null;
            return (
              <View
                key={i}
                pointerEvents="none"
                style={[styles.pause, {
                  top: ((x - seg.start) / 60) * hhTarget, height: Math.max(1, ((y - x) / 60) * hhTarget),
                  backgroundColor: mixOklab(P.edge, 10, SURFACE.bg),
                }]}
              />
            );
          })}
          <AppText
            numberOfLines={m.titleLines}
            style={{
              fontSize: m.titleSize, lineHeight: m.titleLine, fontWeight: '600', color: P.ink, letterSpacing: -0.1,
              paddingRight: titleRight,
            }}
          >
            {ev.title}
          </AppText>
          {m.showMeta ? (
            <AppText numberOfLines={1} style={{ fontSize: 10.5, lineHeight: 13, color: P.mid, marginTop: 1 }}>
              {metaText(seg.fullStart, seg.fullEnd, fmtShort, timer?.worked)}
            </AppText>
          ) : null}
          {showWinTxt ? (
            <AppText
              numberOfLines={winLines}
              style={{ marginTop: 3, fontSize: 10.5, lineHeight: 12, fontStyle: 'italic', color: P.ink, opacity: 0.78 }}
            >
              {winText}
            </AppText>
          ) : null}
          {winMark ? (
            <View
              pointerEvents="none"
              style={[styles.winMark, { top: small ? 4 : 6, backgroundColor: P.edge }]}
            />
          ) : null}
          {tmHere && timer ? (
            <Text
              pointerEvents="none"
              style={[styles.timerTxt, {
                top: small ? 2 : 4, fontSize: small ? 9.5 : 10.5, lineHeight: small ? 11 : 13.5,
                color: timer.over ? '#e8745f' : P.mid, opacity: timer.paused ? 0.5 : 0.85,
              }]}
            >
              {timer.txt}
            </Text>
          ) : null}
          {m.showGrip ? <View pointerEvents="none" style={[styles.grip, { backgroundColor: P.line }]} /> : null}
          {showOnOther ? <View pointerEvents="none" style={[styles.calDot, { backgroundColor: text(0.55) }]} /> : null}
          {m.showPublicGlyph ? (
            <View pointerEvents="none" style={styles.glyph} testID="public-glyph">
              <Icon name="globe" size={10} color={P.ink} strokeWidth={2} />
            </View>
          ) : null}
          {!mine && p.initials ? (
            <View pointerEvents="none" style={styles.initials} testID="owner-initials">
              <Text style={styles.initialsTxt}>{p.initials}</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
      {mover && m.canTop ? (
        <GestureDetector gesture={topPan}>
          <Animated.View
            style={[styles.handle, { left, width, height: Math.min(22, Math.max(12, hT * 0.42)) }, topHandleStyle]}
          />
        </GestureDetector>
      ) : null}
      {mover && m.canBottom ? (
        <GestureDetector gesture={botPan}>
          <Animated.View
            style={[styles.handle, { left, width, height: Math.min(22, Math.max(12, hT * 0.42)) }, botHandleStyle]}
          />
        </GestureDetector>
      ) : null}
      {m.showCheck ? (
        <GestureDetector gesture={checkTap}>
          <Animated.View
            accessibilityRole="button"
            accessibilityLabel={'Confirm ' + ev.title + ' happened'}
            style={[styles.check, { left: left + width - 18, opacity: pending ? 0.95 : 0.6 }, checkStyle]}
          >
            <Icon name="check" size={10} color={P.edge} strokeWidth={2.4} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </>
  );
}

/** One event on the grid: colours from its category, the EV 04 marks, tap / long-press-drag / resize handles. */
export const EventBlock = memo(EventBlockImpl);

const styles = StyleSheet.create({
  block: { position: 'absolute', overflow: 'hidden', zIndex: 5 },
  pause: { position: 'absolute', left: 0, right: 0, zIndex: -1 },
  handle: { position: 'absolute', zIndex: 8 },
  check: { position: 'absolute', width: 17, height: 17, alignItems: 'center', justifyContent: 'center', borderRadius: 5, zIndex: 9 },
  grip: { position: 'absolute', bottom: 3, left: '50%', marginLeft: -7, width: 14, height: 2, borderRadius: 2, opacity: 0.5 },
  winMark: { position: 'absolute', right: 5, width: 5, height: 5, borderRadius: 1, transform: [{ rotate: '45deg' }] },
  timerTxt: { position: 'absolute', right: 5, letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
  glyph: { position: 'absolute', right: 4, bottom: 3, opacity: 0.8 },
  calDot: { position: 'absolute', left: 5, bottom: 4, width: 5, height: 5, borderRadius: 2.5 },
  initials: {
    position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(243,239,232,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  initialsTxt: { fontSize: 7.5, fontWeight: '700', color: SURFACE.bg },
});
