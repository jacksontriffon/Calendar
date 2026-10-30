import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DOW, ACCENT, SURFACE, hueFor, key, paint, text, white, type CatMap, type ProtoEvent } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { usePaintResolver } from '../calendars/overlay';
import { monthGrid } from './model';

interface Props {
  focus: Date;
  events: ProtoEvent[];
  cats: CatMap;
  todayKey: string;
  bottomPad: number;
  /** tap a day: jump to it in the 3-day view */
  onDay: (d: Date) => void;
}

const MAX = 3;

/**
 * Month grid: six weeks, up to three event bars per day and "+n". Blocks here
 * never carry the public glyph (EV 04); someone else's events are outlined.
 */
function MonthViewImpl({ focus, events, cats, todayKey, bottomPad, onDay }: Props) {
  const paintOf = usePaintResolver();
  const cells = useMemo(() => monthGrid(focus), [focus]);
  const byDay = useMemo(() => {
    const m = new Map<string, ProtoEvent[]>();
    events.forEach((e) => {
      const n = e.allDay ? Math.max(1, e.days || 1) : 1;
      const d0 = new Date(e.day.replace(/-/g, '/'));
      for (let i = 0; i < n; i++) {
        const k = key(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i));
        (m.get(k) ?? m.set(k, []).get(k)!).push(e);
      }
    });
    m.forEach((l) => l.sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.start - b.start));
    return m;
  }, [events]);

  const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <View style={[styles.root, { paddingBottom: bottomPad - 90 }]} testID="month-view">
      <View style={styles.dowRow}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <AppText key={d} style={styles.dow}>{DOW[d][0]}</AppText>
        ))}
      </View>
      {weeks.map((wk, wi) => (
        <View key={wi} style={styles.week}>
          {wk.map((d) => {
            const dk = key(d);
            const inMonth = d.getMonth() === focus.getMonth();
            const isToday = dk === todayKey;
            const list = byDay.get(dk) ?? [];
            return (
              <Pressable
                key={dk}
                onPress={() => onDay(d)}
                accessibilityRole="button"
                accessibilityLabel={d.toDateString() + ', ' + list.length + ' events'}
                style={[styles.cell, isToday && { backgroundColor: 'rgba(255,255,255,0.03)' }]}
              >
                <View style={[styles.num, isToday && { backgroundColor: ACCENT }]}>
                  <AppText style={[styles.numTxt, { color: isToday ? SURFACE.onAccent : text(inMonth ? 0.8 : 0.28) }]}>
                    {d.getDate()}
                  </AppText>
                </View>
                {list.slice(0, MAX).map((e) => {
                  const P = paintOf(e) ?? paint(hueFor(cats, e.cat ?? ''));
                  const mine = e.isMine !== false;
                  return (
                    <View
                      key={e.id + dk}
                      style={[
                        styles.bar,
                        { backgroundColor: P.fill, borderLeftColor: P.edge, opacity: inMonth ? 1 : 0.45 },
                        !mine && { borderWidth: 1, borderColor: white(0.3), borderLeftWidth: 1 },
                      ]}
                    >
                      <AppText numberOfLines={1} style={[styles.barTxt, { color: P.ink }]}>{e.title}</AppText>
                    </View>
                  );
                })}
                {list.length > MAX ? <AppText style={styles.more}>+{list.length - MAX}</AppText> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export const MonthView = memo(MonthViewImpl);

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 8, paddingTop: 6 },
  dowRow: { flexDirection: 'row', paddingBottom: 4 },
  dow: { flex: 1, textAlign: 'center', fontSize: 10.5, letterSpacing: 0.7, color: text(0.34), textTransform: 'uppercase' },
  week: { flex: 1, flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.055)' },
  cell: { flex: 1, paddingHorizontal: 1.5, paddingTop: 3, gap: 2, overflow: 'hidden', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.04)' },
  num: { alignSelf: 'center', width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  numTxt: { fontSize: 12, fontWeight: '600' },
  bar: { height: 13, borderLeftWidth: 2, borderRadius: 3, paddingHorizontal: 3, justifyContent: 'center' },
  barTxt: { fontSize: 8.5, lineHeight: 11, fontWeight: '600' },
  more: { fontSize: 9, textAlign: 'center', color: text(0.45) },
});
