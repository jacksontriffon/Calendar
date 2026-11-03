import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DOWL, dnum, hm, text, white, type ProtoEvent } from '@calendar/core';
import type { GoogleCalendar, HiddenItem } from '@calendar/db';

import type { HideScope } from '@/lib/hideScope';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { useCalendarData } from '@/store';
import { unhideDeviceEvent, useHiddenDeviceItems, type DeviceHiddenItem } from './device';
import { Spinner } from '../visibility/glyphs';
import { googleSeriesId, parseGoogleHideKey } from './hidden';
import { getCalendarsStore, useCalendarsSelector, useGoogleAccounts, useHiddenItems } from './data';
import { FALLBACK_CALENDAR_COLOR } from './colors';
import { calendarColor } from './view';
import { Card, ColorBar, Divider, Label, Screen } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayLabel = (day: string): string => {
  const d = dnum(day);
  return DOWL[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
};

/** The "when" line of a hidden row: the occurrence, or how much of a repeating event is hidden. */
export function hiddenWhen(scope: HideScope, day: string, time: string, from?: string): string {
  if (scope === 'all') return 'All events';
  if (scope === 'following') return 'From ' + dayLabel(from ?? day) + ' on';
  return dayLabel(day) + ' · ' + time;
}

export interface HiddenRow {
  /** a `hidden_items` row, or a phone event the bridge hid (`device`) */
  item: HiddenItem;
  /** the phone's `hidden_items` key, when `item` stands for a phone event */
  deviceKey?: string;
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
  const bySeries = new Map<string, ProtoEvent>(); // earliest loaded instance of each repeating series
  events.forEach((e) => {
    const g = meta[e.id]?.googleEventId;
    if (!g) return;
    byGoogleId.set(g, e);
    const series = googleSeriesId(g);
    const first = series ? bySeries.get(series) : undefined;
    if (series && (!first || e.day < first.day)) bySeries.set(series, e);
  });
  const seen = new Set<string>();
  return items
    .filter((h) => h.source === 'google')
    .filter((h) => (seen.has(h.source + h.external_key) ? false : (seen.add(h.source + h.external_key), true)))
    .slice()
    .sort((a, b) => b.hidden_at.localeCompare(a.hidden_at))
    .map((item) => {
      const key = parseGoogleHideKey(item.external_key);
      const ev = key.scope === 'this' ? byGoogleId.get(key.id) : bySeries.get(key.id);
      if (!ev) {
        const when = key.scope === 'all' ? 'All events' : key.scope === 'following' && key.from ? 'From ' + dayLabel(key.from) + ' on' : 'Hidden ' + item.hidden_at.slice(0, 10);
        return { item, title: 'Event from Google', when, from: '', color: FALLBACK_CALENDAR_COLOR };
      }
      const m = meta[ev.id];
      const cal = m?.calendarId ? calendars.find((c) => c.id === m.calendarId) : undefined;
      const when = hiddenWhen(key.scope, ev.day, ev.allDay ? 'All day' : hm(ev.start) + '–' + hm(ev.end), key.from);
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
  const phone = useHiddenDeviceItems();
  const rows = useMemo(() => {
    const google = hiddenRows(items, data.events, meta, calendars);
    const device: HiddenRow[] = phone.map(({ key, scope, event: e }: DeviceHiddenItem) => ({
      item: { id: 'device:' + key, user_id: '', source: 'device', external_key: key, hidden_at: '' },
      deviceKey: key,
      title: e.title,
      when: hiddenWhen(scope, e.day, e.allDay ? 'All day' : hm(e.start) + '\u2013' + hm(e.end), scope === 'following' ? e.day : undefined),
      from: e.calendarName + (e.account ? ' \u00b7 ' + e.account : ''),
      color: e.color,
    }));
    return [...google, ...device];
  }, [items, data.events, meta, calendars, phone]);

  const unhide = (item: HiddenItem, deviceKey?: string) => {
    if (deviceKey) {
      unhideDeviceEvent(deviceKey);
      showToast({ label: 'Back in your calendar' });
      return;
    }
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
                    <Pressable onPress={() => unhide(r.item, r.deviceKey)} accessibilityRole="button" accessibilityLabel={'Unhide ' + r.title} style={styles.unhide}>
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
