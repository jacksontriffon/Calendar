import { useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT, dur, paint, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { useCalendarData } from '@/store';
import { useNow } from '../calendar/useNow';
import { buildRecap, clampIdx, nWins, slideText, storyFontSize, storySlides, type WinItem } from './model';

let requested = 0;
const subs = new Set<() => void>();
/** Open the weekly recap (called from the goals sheet). */
export const openRecap = (): void => {
  requested++;
  subs.forEach((s) => s());
};
const useRequest = (): number =>
  useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => requested, () => requested);

/** The weekly recap: wins grouped by goal, and the full-screen story. */
export function StoryHost() {
  const req = useRequest();
  const [seen, setSeen] = useState(req);
  const [view, setView] = useState<'goal' | 'story'>('goal');
  const [wk, setWk] = useState(0);
  const [idx, setIdx] = useState(0);
  const data = useCalendarData();
  const now = useNow();
  const insets = useSafeAreaInsets();
  const open = req > seen;
  if (!open) return null;

  const r = buildRecap(data, now.today, wk);
  const close = () => { setSeen(req); setView('goal'); setWk(0); setIdx(0); };
  const hue = (h: number | null) => (h == null ? text(0.35) : paint(h).edge);

  if (view === 'story') {
    const slides = storySlides(r);
    const i = clampIdx(idx, slides.length);
    const t = slideText(r, slides[i], wk);
    const w = slides[i].k === 'win' ? (slides[i] as { w: WinItem }).w : null;
    return (
      <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(220)} style={[styles.story, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 22 }]} testID="story">
        <View style={styles.bars}>
          {slides.map((_, k) => <View key={k} style={[styles.bar, { backgroundColor: k <= i ? '#f3efe8' : white(0.16) }]} />)}
        </View>
        <Pressable onPress={close} accessibilityLabel="Close" style={styles.x}><Icon name="close" size={14} color={text(0.7)} /></Pressable>
        <View style={{ flex: 1 }}>
          <View style={styles.slide}>
            <AppText style={[styles.kicker, { color: w ? hue(w.hue) : text(0.5) }]}>{t.kicker}</AppText>
            <AppText style={[styles.big, { fontSize: storyFontSize(t.big.length), lineHeight: Math.round(storyFontSize(t.big.length) * 1.12) }]}>{t.big}</AppText>
            {t.meta ? <AppText style={styles.meta}>{t.meta}</AppText> : null}
            {slides[i].k === 'end' ? r.groups.map((g) => (
              <View key={g.name} style={styles.endRow}>
                <View style={[styles.dot, { backgroundColor: hue(g.hue) }]} />
                <AppText style={styles.endName}>{g.name}</AppText>
                <AppText style={styles.endVal}>{g.wins.length ? nWins(g.wins.length) : ''}{g.hours > 0 ? ' · ' + dur(g.hours) : ''}</AppText>
              </View>
            )) : null}
          </View>
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <Pressable style={{ flex: 1 }} onPress={() => setIdx(clampIdx(i - 1, slides.length))} accessibilityLabel="Previous" />
              <Pressable style={{ flex: 2 }} onPress={() => (i >= slides.length - 1 ? close() : setIdx(i + 1))} accessibilityLabel="Next" />
            </View>
          </View>
        </View>
        {t.hint ? <AppText style={styles.hint}>{t.hint}</AppText> : null}
      </Animated.View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]} testID="recap">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,9,9,0.55)' }]} onPress={close} />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 22 }]}>
          <View style={styles.sheetHead}>
            <Pressable onPress={() => { setWk(wk - 1); setIdx(0); }} accessibilityLabel="Previous week" style={styles.arrow}><Icon name="chevronLeft" size={18} color={text(0.6)} /></Pressable>
            <View style={{ flex: 1 }}>
              <AppText style={styles.wkLabel}>{r.weekLabel}</AppText>
              <AppText style={styles.wkRange}>{r.range}{r.totals ? ' · ' + r.totals : ''}</AppText>
            </View>
            <Pressable onPress={() => { if (wk < 0) { setWk(wk + 1); setIdx(0); } }} accessibilityLabel="Next week" style={[styles.arrow, { opacity: wk < 0 ? 1 : 0.25 }]}><Icon name="chevronRight" size={18} color={text(0.6)} /></Pressable>
            {r.list.length ? (
              <Pressable onPress={() => { setIdx(0); setView('story'); }} style={styles.storyBtn}><AppText style={{ fontSize: 12, fontWeight: '600', color: ACCENT }}>Story</AppText></Pressable>
            ) : null}
          </View>
          <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
            {r.list.length === 0 ? (
              <AppText style={styles.empty}>
                {wk === 0 ? 'No wins yet this week. The evening check-in asks what came out of each goal session.' : 'No wins were logged that week.'}
              </AppText>
            ) : r.groups.map((g) => (
              <View key={g.name} style={{ marginBottom: 12 }}>
                <View style={styles.gHead}>
                  <View style={[styles.dot, { backgroundColor: hue(g.hue) }]} />
                  <AppText style={styles.gName}>{g.name}</AppText>
                  <AppText style={styles.gMeta}>{g.wins.length ? nWins(g.wins.length) : 'No wins yet'}{g.hours > 0 ? ' · ' + dur(g.hours) + (g.pace ? ' of ' + dur(g.pace) : '') : ''}</AppText>
                </View>
                {g.wins.map((w) => (
                  <View key={w.e.id} style={styles.win}>
                    <View style={[w.core ? styles.diamond : styles.round, { backgroundColor: hue(w.hue) }]} />
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.winTxt, w.core && { fontWeight: '600', color: '#f6f2ec' }]}>{w.text}</AppText>
                      <AppText style={styles.winMeta}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][w.di]} {'·'} {dur(w.h)}</AppText>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  story: { ...(StyleSheet.absoluteFill as object), zIndex: 96, backgroundColor: '#0f0e0d', paddingHorizontal: 20 },
  bars: { flexDirection: 'row', gap: 4, paddingRight: 44 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  x: { position: 'absolute', right: 14, top: 40, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  slide: { flex: 1, justifyContent: 'center', gap: 14, paddingHorizontal: 4 },
  kicker: { fontSize: 11.5, lineHeight: 15, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '600' },
  big: { fontWeight: '500', letterSpacing: -0.8, color: '#f6f2ec' },
  meta: { fontSize: 14, color: text(0.5) },
  hint: { textAlign: 'center', fontSize: 12, color: text(0.34) },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  endName: { flex: 1, fontSize: 14 },
  endVal: { fontSize: 12.5, color: text(0.5) },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#221f1d', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderTopColor: white(0.09), padding: 18, maxHeight: '90%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 12 },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  wkLabel: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  wkRange: { fontSize: 11.5, color: text(0.45) },
  storyBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: white(0.06) },
  empty: { fontSize: 13, lineHeight: 19, color: text(0.5) },
  gHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  gName: { fontSize: 14, fontWeight: '600' },
  gMeta: { flex: 1, textAlign: 'right', fontSize: 11.5, color: text(0.42) },
  win: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: white(0.06) },
  diamond: { width: 6, height: 6, marginTop: 6, borderRadius: 1, transform: [{ rotate: '45deg' }] },
  round: { width: 6, height: 6, marginTop: 6, borderRadius: 3 },
  winTxt: { fontSize: 13.5, lineHeight: 18, color: text(0.8) },
  winMeta: { fontSize: 11.5, color: text(0.38) },
});
