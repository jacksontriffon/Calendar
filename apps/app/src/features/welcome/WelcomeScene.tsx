/**
 * The Welcome scene (OA 1.1): tagline, the 7am-7pm day card, and the bottom
 * slot that holds the note composer, then the sign-in buttons. Everything is
 * a function of one shared value `t` (ms, 0 -> 9700); see timeline.ts.
 */
import { SURFACE, TEXT, mixOklab, text, white } from '@calendar/core';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { fontFamily } from '@/lib/fonts';

import {
  CHAR_STARTS,
  HOUR_LABELS,
  NOTE,
  T,
  WELCOME_EVENTS,
  buttonAt,
  buttonStart,
  composerAt,
  dayCardAt,
  dotAt,
  eventAt,
  eventBox,
  idleCaretAt,
  isStacked,
  placeholderAt,
  sendAccentAt,
  sendScaleAt,
  taglineAt,
  thinkingBorderAt,
  thinkingPillAt,
  typedCount,
  typedTextAt,
  type WelcomeEvent,
} from './timeline';

const ACCENT = '#cf7b58';
const serif = (w: number) => fontFamily('serif', w);

/** Fonts the scene always uses: the default (serif) face, as in the spec frames. */
const s = StyleSheet.create({
  tagline: {
    paddingTop: 18,
    paddingHorizontal: 22,
    textAlign: 'center',
    fontFamily: serif(600),
    fontSize: 25,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: '#f6f2ec',
  },
});

export function Tagline({ t }: { t: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const a = taglineAt(t.value);
    return { opacity: a.opacity, transform: [{ translateY: a.translateY }] };
  });
  return (
    <Animated.View style={style}>
      <Text accessibilityRole="header" style={s.tagline}>
        Schedule your day in seconds
      </Text>
    </Animated.View>
  );
}

/* ---------- day card ---------- */

export function DayCard({ t }: { t: SharedValue<number> }) {
  const [h, setH] = useState(0);
  const style = useAnimatedStyle(() => {
    const a = dayCardAt(t.value);
    return { opacity: a.opacity, transform: [{ translateY: a.translateY }] };
  });
  const onLayout = (e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height);

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Your 7am to 7pm day, scheduled: gym, school run, standup, deep work, lunch with Sam, Q4 plan, a 1:1 with Maya, the dentist, picking up the kids and family dinner"
      style={[styles.card, style]}
    >
      <View style={styles.cardInner} onLayout={onLayout}>
        {HOUR_LABELS.map((label, i) => (
          <Text key={label} style={[styles.hourLabel, { top: `${(i / 12) * 100}%` }]}>
            {label}
          </Text>
        ))}
        <View style={styles.grid}>
          {Array.from({ length: 12 }, (_, i) => (
            <View key={i} style={[styles.gridLine, { top: `${(i / 12) * 100}%` }]} />
          ))}
        </View>
        {h > 0 ? WELCOME_EVENTS.map((e) => <EventBlock key={e.title} event={e} t={t} innerHeight={h} />) : null}
      </View>
    </Animated.View>
  );
}

function EventBlock({ event, t, innerHeight }: { event: WelcomeEvent; t: SharedValue<number>; innerHeight: number }) {
  const { topPct, heightPct } = eventBox(event);
  const stacked = isStacked(event);
  const c = event.color;
  const style = useAnimatedStyle(() => {
    const a = eventAt(t.value, event.at);
    return { opacity: a.opacity, transform: [{ translateY: a.translateY }, { scale: a.scale }] };
  });
  return (
    <Animated.View
      style={[
        styles.event,
        {
          top: (topPct / 100) * innerHeight + 1,
          height: (heightPct / 100) * innerHeight - 2,
          borderLeftColor: c,
          backgroundColor: mixOklab(c, 28, SURFACE.bg),
          flexDirection: stacked ? 'column' : 'row',
          gap: stacked ? 0 : 8,
          alignItems: stacked ? 'flex-start' : 'center',
          justifyContent: stacked ? 'center' : 'space-between',
        },
        style,
      ]}
    >
      <Text numberOfLines={1} style={[styles.eventTitle, { color: mixOklab(c, 32, TEXT), fontSize: stacked ? 12 : 11.5, lineHeight: stacked ? 13 : 12 }]}>
        {event.title}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.eventTime, { color: mixOklab(mixOklab(c, 55, TEXT), 62, SURFACE.bg), fontSize: stacked ? 10.5 : 10 }]}
      >
        {event.time}
      </Text>
    </Animated.View>
  );
}

/* ---------- composer ---------- */

export function Composer({ t }: { t: SharedValue<number> }) {
  const [n, setN] = useState(0);
  useAnimatedReaction(
    () => typedCount(t.value),
    (count, prev) => {
      if (count !== prev) scheduleOnRN(setN, count);
    },
  );

  const pill = useAnimatedStyle(() => {
    const a = composerAt(t.value);
    return { opacity: a.opacity, transform: [{ scale: a.scale }] };
  });
  const border = useAnimatedStyle(() => ({ opacity: thinkingBorderAt(t.value) }));
  const placeholder = useAnimatedStyle(() => ({ opacity: placeholderAt(t.value) }));
  const idleCaret = useAnimatedStyle(() => ({ opacity: idleCaretAt(t.value) }));
  const typedStyle = useAnimatedStyle(() => ({ opacity: typedTextAt(t.value) }));
  const sendScale = useAnimatedStyle(() => ({ transform: [{ scale: sendScaleAt(t.value) }] }));
  const sendAccent = useAnimatedStyle(() => ({ opacity: sendAccentAt(t.value) }));

  const typed = NOTE.slice(0, n);
  const typing = n > 0 && n < CHAR_STARTS.length;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.composer, pill]}
    >
      <Animated.View style={[styles.thinkingBorder, border]} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={styles.inputArea}>
          <Animated.Text style={[styles.placeholder, placeholder]}>Summarise your day…</Animated.Text>
          <Animated.View style={[styles.idleCaret, idleCaret]} />
          <Animated.View style={typedStyle}>
            <Text style={styles.typed}>
              {typed}
              {typing ? <Text style={{ color: ACCENT }}>|</Text> : null}
            </Text>
          </Animated.View>
        </View>
        <View style={styles.composerRow}>
          <View style={styles.modelPill}>
            <Text style={styles.modelText}>Haiku 4.5</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Animated.View style={[styles.send, sendScale]}>
            <View style={[StyleSheet.absoluteFill, styles.sendGrey]}>
              <Text style={[styles.sendArrow, { color: text(0.3) }]}>↑</Text>
            </View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.sendAccent, sendAccent]}>
              <Text style={[styles.sendArrow, { color: '#17120f' }]}>↑</Text>
            </Animated.View>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

/** "Scheduling your day…" with three bouncing dots, centred over the empty card area. */
export function ThinkingPill({ t }: { t: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: thinkingPillAt(t.value) }));
  return (
    <Animated.View pointerEvents="none" style={[styles.thinkingWrap, style]}>
      <View style={styles.thinkingPill}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <Dot key={i} t={t} index={i} />
          ))}
        </View>
        <Text style={styles.thinkingText}>Scheduling your day…</Text>
      </View>
    </Animated.View>
  );
}

function Dot({ t, index }: { t: SharedValue<number>; index: number }) {
  const style = useAnimatedStyle(() => {
    const d = dotAt(t.value, index);
    return { opacity: d.opacity, transform: [{ translateY: d.translateY }] };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

/* ---------- sign-in buttons ---------- */

/** One sign-in button arriving at its slot in the sequence (0 = first in the platform's order). */
export function ArrivingButton({ t, index, children }: { t: SharedValue<number>; index: number; children: ReactNode }) {
  const start = buttonStart(index);
  const style = useAnimatedStyle(() => {
    const a = buttonAt(t.value, start);
    return { opacity: a.opacity, transform: [{ translateY: a.translateY }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

export const BUTTONS_LIVE_MS = T.buttonsStart;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 260,
    borderRadius: 16,
    backgroundColor: '#1b1a18',
    borderWidth: 1,
    borderColor: white(0.07),
    overflow: 'hidden',
  },
  cardInner: { position: 'absolute', left: 0, right: 0, top: 12, bottom: 12 },
  hourLabel: {
    position: 'absolute',
    left: 0,
    width: 40,
    marginTop: -7,
    textAlign: 'right',
    fontFamily: serif(400),
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: text(0.26),
  },
  grid: { position: 'absolute', left: 44, right: 10, top: 0, bottom: 0, borderBottomWidth: 1, borderColor: SURFACE.grid },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: SURFACE.grid },
  event: {
    position: 'absolute',
    left: 46,
    right: 10,
    overflow: 'hidden',
    paddingLeft: 6,
    paddingRight: 7,
    borderLeftWidth: 2,
    borderRadius: 6,
  },
  eventTitle: { fontFamily: serif(600), letterSpacing: -0.1 },
  eventTime: { fontFamily: serif(400), lineHeight: 12, fontVariant: ['tabular-nums'] },
  composer: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 14,
    height: 144,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 10,
    paddingRight: 4,
    backgroundColor: '#232120',
    borderWidth: 1,
    borderColor: white(0.1),
    borderRadius: 20,
    boxShadow: '0 10px 34px rgba(0,0,0,0.5)',
  },
  thinkingBorder: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(207,123,88,0.45)',
  },
  inputArea: { height: 90, paddingTop: 7, paddingBottom: 3, paddingLeft: 4, paddingRight: 2 },
  placeholder: {
    position: 'absolute',
    left: 4,
    top: 7,
    fontFamily: serif(400),
    fontSize: 15,
    lineHeight: 20,
    color: text(0.34),
  },
  idleCaret: { position: 'absolute', left: 3, top: 9, width: 1.5, height: 16, borderRadius: 1, backgroundColor: ACCENT },
  typed: { fontFamily: serif(400), fontSize: 15, lineHeight: 20, letterSpacing: -0.1, color: TEXT },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: white(0.055),
    borderWidth: 1,
    borderColor: white(0.07),
  },
  modelText: { fontFamily: serif(500), fontSize: 12.5, letterSpacing: -0.1, color: text(0.72) },
  send: { width: 40, height: 40, marginBottom: 2 },
  sendGrey: { borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.08) },
  sendAccent: { borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT },
  sendArrow: { fontFamily: serif(600), fontSize: 15, lineHeight: 18 },
  thinkingWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  thinkingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: white(0.05),
    borderWidth: 1,
    borderColor: white(0.08),
  },
  thinkingText: { fontFamily: serif(400), fontSize: 12.5, color: text(0.55) },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: ACCENT },
});
