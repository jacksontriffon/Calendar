import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { hm, paint, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Sheet, useSheetClose } from '@/components/Sheet';
import { showToast } from '@/components/toast';
import { getStore } from '@/store';
import { hueOfColor, toProtoEvent } from '@/sync/deviceMap';
import { copyToMyCalendar } from '../../event-sheet/EventSheet';
import { hideDeviceEvent, unhideDeviceEvent, useDeviceEvent } from './index';

/** A phone-calendar event opened from the calendar view (`/event/dev_…`): read-only, with Copy to my calendar and a quiet Remove. */
export function DeviceEventSheet({ id }: { id: string }) {
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return (
    <Sheet onClosed={goBack} testID="device-event-sheet">
      <Body id={id} />
    </Sheet>
  );
}

const dayLabel = (day: string, allDay: boolean, days: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const fmt = (x: Date) => x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (!allDay || days <= 1) return fmt(dt);
  return fmt(dt) + ' – ' + fmt(new Date(y, m - 1, d + days - 1));
};

function Body({ id }: { id: string }) {
  const close = useSheetClose();
  const ev = useDeviceEvent(id);
  if (!ev) {
    return (
      <View style={{ paddingVertical: 24 }}>
        <AppText style={{ color: text(0.6) }}>This event is no longer on your phone.</AppText>
      </View>
    );
  }
  const P = paint(hueOfColor(ev.color));
  const copy = () => {
    // A private copy in the user's own calendar, in their first category.
    const cats = Object.keys(getStore().getState().data.cats);
    copyToMyCalendar({ ...toProtoEvent(ev), cat: cats[0] ?? null });
    close();
  };
  const remove = () => {
    const hidden = hideDeviceEvent(ev.id);
    close();
    if (!hidden) return;
    showToast({
      label: 'Removed · ' + hidden.title,
      action: { label: 'Undo', run: () => unhideDeviceEvent(hidden.hiddenKey) },
    });
  };
  return (
    <View testID="device-event-body">
      <View style={styles.head}>
        <View style={[styles.swatch, { backgroundColor: ev.color }]} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText style={styles.title}>{ev.title}</AppText>
          <AppText style={styles.meta}>
            {ev.allDay ? 'All day' : hm(ev.start) + ' – ' + hm(ev.end)} {'·'} {dayLabel(ev.day, ev.allDay, ev.days)}
          </AppText>
          {ev.location ? <AppText style={styles.meta}>{ev.location}</AppText> : null}
          <View style={styles.source}>
            <Icon name="phone" size={12} color={text(0.45)} />
            <AppText style={styles.sourceTxt}>
              On this phone {'·'} {ev.calendarName}{!ev.isMine ? ' · read-only' : ''}
            </AppText>
          </View>
        </View>
      </View>
      <Pressable onPress={copy} accessibilityRole="button" style={[styles.copyBtn, { backgroundColor: P.fill, borderColor: P.line }]}>
        <Icon name="copy" size={14} color={P.ink} />
        <AppText style={{ fontSize: 14, fontWeight: '600', color: P.ink }}>Copy to my calendar</AppText>
      </Pressable>
      <Pressable onPress={remove} accessibilityRole="button" style={{ alignSelf: 'center', padding: 14 }}>
        <AppText style={{ fontSize: 12.5, color: text(0.45) }}>Remove</AppText>
      </Pressable>
      <AppText style={styles.note}>Phone events stay on this phone. Remove hides it here only; Undo or Hidden events brings it back.</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 4 },
  swatch: { width: 10, height: 38, borderRadius: 5, marginTop: 2 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2, color: '#f6f2ec' },
  meta: { fontSize: 12.5, lineHeight: 17, color: text(0.5), fontVariant: ['tabular-nums'] },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  sourceTxt: { fontSize: 12, color: text(0.42) },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 13, paddingHorizontal: 16,
    borderRadius: 13, borderWidth: 1,
  },
  note: { fontSize: 11.5, lineHeight: 16, color: white(0.34), textAlign: 'center', paddingHorizontal: 12 },
});
