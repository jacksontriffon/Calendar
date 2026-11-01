import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Pattern, Polyline, Rect } from 'react-native-svg';
import {
  CHART_H, SURFACE, barPx, deadlineDot, estimateTextWidth, gapPx, hrs, paceLine, paint, placeEndLabels, text, white,
  type ChartModel, type ChartSeries, type EndDotInput,
} from '@calendar/core';

import { AppText } from '@/components/AppText';

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const LABEL_BG = SURFACE.sheet;

interface Props {
  model: ChartModel;
  /** inner width of the sheet, which the columns divide up (`model.visible` columns fit on screen) */
  width: number;
  /** changes to replay the animations (unit change, drilling in or out) */
  replayKey: string;
}

/**
 * The goals graph: cumulative bars per goal and bucket, a dotted ideal-pace line, hour gridlines and a
 * labelled dot at each deadline, in a horizontal scroll strip that opens on the current bucket.
 * Decorative to a screen reader: one label summarises each goal, the goal cards carry the detail.
 */
export function GoalChart({ model, width, replayKey }: Props) {
  const reduce = useReducedMotion();
  const scroll = useRef<ScrollViewInstance>(null);
  const n = model.buckets.length;
  const colW = width > 0 ? width / model.visible : 0;
  const innerW = Math.max(width, colW * n);

  useEffect(() => {
    if (colW > 0) scroll.current?.scrollTo({ x: Math.max(0, Math.min(model.scrollTo * colW, innerW - width)), animated: false });
  }, [colW, innerW, width, model.scrollTo, model.unit, replayKey]);

  const y = (v: number) => CHART_H - (v / model.yMax) * CHART_H;
  const labels = useMemo(() => {
    const dots = model.series.flatMap((s): EndDotInput[] => {
      const d = deadlineDot(s, model.buckets);
      return d ? [{ goalId: s.goalId, px: d.x * colW, py: y(d.value), title: s.title, prog: s.prog, pace: s.pace.num }] : [];
    });
    return new Map(placeEndLabels(dots, estimateTextWidth, CHART_H).map((p) => [p.goalId, p]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, colW]);

  const summary = model.series
    .map((s) => `${s.title}: ${hrs(s.done)} of ${hrs(s.target)} hours, ${s.pace.word}`)
    .join('. ');
  /* only the screenful that is scrolled to on open animates, so a 400-column range doesn't start 400 animations */
  const a0 = model.scrollTo, a1 = model.scrollTo + model.visible + 1;

  if (width <= 0) return null;
  return (
    <View accessible accessibilityLabel={summary} importantForAccessibility="yes" testID="goal-chart">
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={{ width: innerW }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View key={replayKey} style={{ width: innerW }}>
          <View style={{ height: CHART_H, width: innerW }}>
            {model.grid.map((g) => (
              <View key={g.label} style={[styles.gridLine, { bottom: Math.round((g.value / model.yMax) * CHART_H) }]}>
                <AppText style={styles.gridLbl}>{g.label}</AppText>
              </View>
            ))}
            {model.buckets.map((b, bi) => (
              <View key={bi} style={[styles.col, { left: bi * colW, width: colW }, b.isNow && styles.colNow]}>
                {model.series.map((s, si) => {
                  const c = s.cells[bi];
                  const vis = c.on && !c.future;
                  const fillH = vis ? barPx(c.doneCum, model.yMax) : 0;
                  const gapH = vis ? gapPx(c.behind, model.yMax) : 0;
                  if (!fillH && !gapH) return <View key={s.goalId} style={styles.barSlot} />;
                  return (
                    <GrowBar
                      key={s.goalId}
                      delay={reduce || bi < a0 || bi > a1 ? -1 : 160 + (bi - a0) * 35 + si * 50}
                      fillH={fillH}
                      gapH={gapH}
                      color={paint(s.hue).edge}
                    />
                  );
                })}
              </View>
            ))}
            {model.series.map((s) => {
              const pts = paceLine(s, model.buckets);
              if (pts.length < 2) return null;
              return <PaceLine key={s.goalId} s={s} pts={pts.map((p) => [p.x * colW, y(p.value)])} width={innerW} animate={!reduce} />;
            })}
            {model.series.map((s, di) => {
              const d = deadlineDot(s, model.buckets);
              const lb = labels.get(s.goalId);
              if (!d || !lb) return null;
              return (
                <EndMark key={s.goalId} s={s} x={d.x * colW} y={y(d.value)} left={lb.left} top={lb.top} w={lb.width} delay={reduce ? -1 : 600 + di * 70} />
              );
            })}
          </View>
          <View style={styles.axis}>
            {model.buckets.map((b, bi) => (
              <AppText
                key={bi}
                numberOfLines={1}
                style={[styles.axisLbl, { width: colW }, b.isNow && styles.axisNow]}
              >
                {b.label}
              </AppText>
            ))}
          </View>
        </View>
      </ScrollView>
      <AppText style={styles.cap}>Bars: hours marked done so far · Dotted: ideal pace</AppText>
    </View>
  );
}

/** One goal's bar in a column: grows from the baseline; a hatched "behind" segment sits on top. */
function GrowBar({ fillH, gapH, color, delay }: { fillH: number; gapH: number; color: string; delay: number }) {
  const p = useSharedValue(delay < 0 ? 1 : 0);
  useEffect(() => {
    if (delay >= 0) p.set(withDelay(delay, withTiming(1, { duration: 650, easing: EASE })));
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: p.value }] }));
  return (
    <Animated.View style={[styles.bar, { height: fillH + gapH, transformOrigin: 'bottom' }, style]}>
      {gapH ? (
        <View style={{ height: gapH, borderTopLeftRadius: 4, borderTopRightRadius: 4, overflow: 'hidden', backgroundColor: white(0.1) }}>
          <Svg width="100%" height={gapH}>
            <Defs>
              <Pattern id="hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                <Rect width="5" height="10" fill="rgba(255,255,255,0.16)" />
              </Pattern>
            </Defs>
            <Rect width="100%" height={gapH} fill="url(#hatch)" />
          </Svg>
        </View>
      ) : null}
      <View style={{ height: fillH, backgroundColor: color, borderTopLeftRadius: gapH ? 0 : 4, borderTopRightRadius: gapH ? 0 : 4 }} />
    </Animated.View>
  );
}

/** The dotted ideal-pace polyline, wiped in left to right. */
function PaceLine({ s, pts, width, animate }: { s: ChartSeries; pts: number[][]; width: number; animate: boolean }) {
  const p = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (animate) p.set(withDelay(300, withTiming(1, { duration: 900, easing: Easing.bezier(0.4, 0.1, 0.2, 1) })));
  }, [p, animate]);
  const clip = useAnimatedStyle(() => ({ width: p.value * width }));
  return (
    <Animated.View pointerEvents="none" style={[styles.lineClip, clip]}>
      <Svg width={width} height={CHART_H} style={{ overflow: 'visible' }}>
        <Polyline
          points={pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}
          fill="none"
          stroke={paint(s.hue).edge}
          strokeOpacity={0.38}
          strokeWidth={2}
          strokeDasharray="0.1 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}

/** The deadline dot (pops in) and its label chip (fades up): title, "24/70h · 34%" and the pace number. */
function EndMark({ s, x, y, left, top, w, delay }: { s: ChartSeries; x: number; y: number; left: number; top: number; w: number; delay: number }) {
  const pop = useSharedValue(delay < 0 ? 1 : 0);
  const fade = useSharedValue(delay < 0 ? 1 : 0);
  useEffect(() => {
    if (delay < 0) return;
    pop.set(withDelay(delay, withSequence(withTiming(1.25, { duration: 300, easing: EASE }), withTiming(1, { duration: 200, easing: EASE }))));
    fade.set(withDelay(delay + 100, withTiming(1, { duration: 450 })));
  }, [pop, fade, delay]);
  const dot = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 1.7), transform: [{ scale: pop.value }] }));
  const lbl = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: (1 - fade.value) * 4 }] }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.dot, { left: x - 6.5, top: y - 6.5, backgroundColor: paint(s.hue).edge }, dot]} />
      <Animated.View pointerEvents="none" style={[styles.lbl, { left, top, width: w }, lbl]}>
        <AppText numberOfLines={1} style={styles.lblName}>{s.title}</AppText>
        <View style={styles.lblRow}>
          <AppText style={styles.lblProg}>{s.prog}</AppText>
          <AppText style={[styles.lblPace, s.pace.color ? { color: s.pace.color } : null]}>{s.pace.num}</AppText>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -2, paddingTop: 10 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: white(0.06) },
  gridLbl: {
    position: 'absolute', left: 2, top: -6, fontSize: 9, lineHeight: 12, paddingHorizontal: 4, borderRadius: 4,
    backgroundColor: LABEL_BG, color: text(0.3), fontVariant: ['tabular-nums'],
  },
  col: {
    position: 'absolute', top: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3,
    paddingHorizontal: 4, borderTopLeftRadius: 6, borderTopRightRadius: 6,
  },
  colNow: { backgroundColor: white(0.045) },
  barSlot: { flex: 1, minWidth: 6, maxWidth: 24 },
  bar: { flex: 1, minWidth: 6, maxWidth: 24, justifyContent: 'flex-end' },
  lineClip: { position: 'absolute', left: 0, top: 0, height: CHART_H, overflow: 'hidden' },
  dot: {
    position: 'absolute', width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: LABEL_BG,
  },
  lbl: { position: 'absolute', gap: 0 },
  lblName: {
    alignSelf: 'flex-start', maxWidth: '100%', fontSize: 10.5, lineHeight: 13, fontWeight: '700', color: '#f3efe8',
    backgroundColor: LABEL_BG, paddingHorizontal: 4, marginLeft: -4, borderRadius: 4, overflow: 'hidden',
  },
  lblRow: {
    alignSelf: 'flex-start', flexDirection: 'row', gap: 5, backgroundColor: LABEL_BG, paddingHorizontal: 4, marginLeft: -4, borderRadius: 4,
  },
  lblProg: { fontSize: 10, lineHeight: 12, color: text(0.55), fontVariant: ['tabular-nums'] },
  lblPace: { fontSize: 10, lineHeight: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  axis: { flexDirection: 'row', paddingTop: 6, borderTopWidth: 1, borderTopColor: white(0.08) },
  axisLbl: { textAlign: 'center', fontSize: 10, letterSpacing: 0.2, color: text(0.34), overflow: 'hidden' },
  axisNow: { color: text(0.85), fontWeight: '600' },
  cap: { fontSize: 10.5, lineHeight: 14, color: text(0.34), paddingTop: 7, paddingBottom: 6, paddingHorizontal: 2 },
});
