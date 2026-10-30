import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DOWL, dnum, hm, text, white, type ProtoEvent } from '@calendar/core';
import type { GoogleCalendar, HiddenItem } from '@calendar/db';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { useCalendarData } from '@/store';
import { Spinner } from '../visibility/glyphs';
import { getCalendarsStore, useCalendarsSelector, useGoogleAccounts, useHiddenItems } from './data';
import { FALLBACK_CALENDAR_COLOR } from './colors';
import { calendarColor } from './view';
import { Card, ColorBar, Divider, Label, Screen } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface HiddenRow {
  item: HiddenItem;
  title: string;
  when: string;
  from: string;
  color: string;
}

/** What to show for each hidden item: the event if the app still has it, else a plain label. Pure, for tests. */
export function hiddenRows(
  items: readonly HiddenItem[],
  events: readonly ProtoEvent[],
  meta: Record<string, { calendarId: string | null; googleEventId: string | null; organizerEmail: string | null }>,
  calendars: readonly GoogleCalendar[],
): HiddenRow[] {
  const byGoogleId = new Map<string, ProtoEvent>();
  events.forEach((e) => {
    const g = meta[e.id]?.googleEventId;
    if (g) byGoogleId.set(g, e);
  });
  const seen = new Set<string>();
  return items
    .filter((h) => (seen.has(h.source + h.external_key) ? false : (seen.add(h.source + h.external_key), true)))
    .slice()
    .sort((a, b) => b.hidden_at.localeCompare(a.hidden_at))
    .map((item) => {
      const ev = item.source === 'google' ? byGoogleId.get(item.external_key) : undefined;
      if (!ev) {
        return { item, title: item.source === 'device' ? 'Phone event' : 'Event from Google', when: 'Hidden ' + item.hidden_at.slice(0, 10), from: '', color: FALLBACK_CALENDAR_COLOR };
      }
      const m = meta[ev.id];
      const cal = m?.calendarId ? calendars.find((c) => c.id === m.calendarId) : undefined;
      const d = dnum(ev.day);
      const when = ev.allDay
        ? DOWL[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' · All day'
        : DOWL[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' · ' + hm(ev.start) + '–' + hm(ev.end);
      const from = [m?.organizerEmail, cal?.name].filter(Boolean).join(' · ');
      return { item, title: ev.title, when, from, color: cal ? calendarColor(cal) : FALLBACK_CALENDAR_COLOR };
    });
}

/** Hidden events (CA 1.7, 1.8): what you removed from your view, each with Unhide. */
export function HiddenEventsScreen() {
  const items = useHiddenItems();
  const data = useCalendarData();
  const meta = useCalendarsSelector((s) => s.meta);
  const load = useCalendarsSelector((s) => s.load);
  const { calendars } = useGoogleAccounts();
  const rows = useMemo(() => hiddenRows(items, data.events, meta, calendars), [items, data.events, meta, calendars]);

  const unhide = (item: HiddenItem) => {
    getCalendarsStore().unhide(item).then(
      () => showToast({ label: 'Back in your calendar' }),
      () => showToast({ label: 'Couldn’t unhide. Try again in a moment.' }),
    );
  };

  return (
    <Screen title="Hidden events" subtitle="From other people, removed from your view">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {load === 'idle' || (load === 'loading' && !rows.length) ? (
          <View style={{ padding: 30, alignItems: 'center' }}><Spinner size={16} /></View>
        ) : rows.length === 0 ? (
          <View style={styles.empty} testID="hidden-empty">
            <View style={styles.emptyIcon}><Icon name="eye" size={22} color={text(0.7)} strokeWidth={1.6} /></View>
            <AppText style={styles.emptyTitle}>Nothing hidden</AppText>
            <AppText style={styles.emptyBody}>Nothing has been hidden yet, or every hidden event was unhidden.</AppText>
          </View>
        ) : (
          <>
            <AppText style={styles.intro}>
              Events from other people that you removed from your view. They stay on the calendar they came from, and nobody else is told.
            </AppText>
            <Label right={<AppText style={styles.count}>{rows.length}</AppText>}>Removed from your view</Label>
            <Card>
              {rows.map((r, i) => (
                <View key={r.item.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.row} testID="hidden-row">
                    <ColorBar color={r.color} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText style={styles.title} numberOfLines={1}>{r.title}</AppText>
                      <AppText style={styles.sub} numberOfLines={1}>{r.when}</AppText>
                      {r.from ? <AppText style={[styles.sub, { color: text(0.38) }]} numberOfLines={1}>{r.from}</AppText> : null}
                    </View>
                    <Pressable onPress={() => unhide(r.item)} accessibilityRole="button" accessibilityLabel={'Unhide ' + r.title} style={styles.unhide}>
                      <AppText style={{ fontSize: 13 }}>Unhide</AppText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
            <AppText style={styles.intro}>Unhide puts an event back in every view. Hiding only changes what you see.</AppText>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12.5, lineHeight: 18, color: text(0.5), marginHorizontal: 16, marginTop: 16 },
  count: { fontSize: 11.5, color: text(0.4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  title: { fontSize: 15, fontWeight: '500', letterSpacing: -0.2 },
  sub: { fontSize: 12, lineHeight: 16, color: text(0.5), marginTop: 1 },
  unhide: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9, backgroundColor: white(0.08), borderWidth: 1, borderColor: white(0.14) },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: white(0.06), alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 16 },
  emptyBody: { fontSize: 13, lineHeight: 19, color: text(0.5), textAlign: 'center', marginTop: 6 },
});
