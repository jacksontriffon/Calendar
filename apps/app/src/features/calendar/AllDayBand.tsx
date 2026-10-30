import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { paint, white, hueFor, type CatMap, type ProtoEvent } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { GUTTER, type AllDayItem } from './model';

interface Props {
  items: AllDayItem[];
  rows: number;
  colW: number;
  week: boolean;
  cats: CatMap;
  onOpen: (ev: ProtoEvent) => void;
}

const GAP = 3;

/** All-day / all-week bars across the day columns, packed into rows. */
function AllDayBandImpl({ items, rows, colW, week, cats, onOpen }: Props) {
  if (!items.length) return null;
  const h = week ? 14 : 16;
  return (
    <View style={styles.band}>
      <View style={{ height: Math.max(rows, 1) * (h + GAP) - GAP, marginLeft: 0 }}>
        {items.map((it) => {
          const P = paint(hueFor(cats, it.ev.cat ?? ''));
          const mine = it.ev.isMine !== false;
          return (
            <Pressable
              key={it.ev.id}
              onPress={() => onOpen(it.ev)}
              accessibilityRole="button"
              accessibilityLabel={it.ev.title + ', all day'}
              style={[
                styles.bar,
                {
                  top: it.row * (h + GAP), height: h,
                  left: GUTTER + it.i0 * colW + 2, width: (it.i1 - it.i0 + 1) * colW - 5,
                  backgroundColor: P.fill,
                  borderLeftWidth: it.openLeft ? 0 : 2, borderLeftColor: P.edge,
                  borderTopLeftRadius: it.openLeft ? 0 : 4, borderBottomLeftRadius: it.openLeft ? 0 : 4,
                  borderTopRightRadius: it.openRight ? 0 : 4, borderBottomRightRadius: it.openRight ? 0 : 4,
                  paddingHorizontal: week ? 3 : 6,
                },
                !mine && { borderWidth: 1, borderColor: white(0.3) },
              ]}
            >
              <AppText numberOfLines={1} style={{ fontSize: week ? 9 : 10, lineHeight: h, fontWeight: '600', color: P.ink }}>
                {it.ev.title}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const AllDayBand = memo(AllDayBandImpl);

const styles = StyleSheet.create({
  band: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.055)', paddingTop: 5, paddingBottom: 7 },
  bar: { position: 'absolute', justifyContent: 'center', overflow: 'hidden' },
});
