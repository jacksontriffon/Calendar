import { ScrollView, StyleSheet, View , Pressable } from 'react-native';
import { SURFACE, text, white } from '@calendar/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { showToast } from '@/components/toast';
import { Spinner } from '../visibility/glyphs';
import { getCalendarsStore, useGoogleAccounts } from './data';
import { calendarColor, canWrite } from './view';
import { Card, ColorBar, Divider, Screen, Toggle, goBack } from './ui';

/**
 * Choose calendars (CA 2.7, 3.x): per Google calendar, Show in app (import) and Can publish to. Read-only
 * calendars can be shown but never published to. Done goes back: to Calendars, or to the visibility picker
 * (EV 2.12) when the flow started there (`?from=picker`).
 */
export function ChooseCalendarsScreen({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const { views, load } = useGoogleAccounts();
  const v = views.find((x) => x.account.id === id);
  const flag = (calId: string, patch: { show_in_app?: boolean; can_publish?: boolean }) => {
    getCalendarsStore().setCalendarFlag(calId, patch).catch(() => showToast({ label: 'Couldn’t save that change.' }));
  };

  const footer = (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
      <Pressable onPress={goBack} accessibilityRole="button" style={styles.done} testID="choose-done">
        <AppText style={styles.doneTxt}>Done</AppText>
      </Pressable>
    </View>
  );

  return (
    <Screen title="Choose calendars" subtitle={v?.account.email} footer={footer}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <AppText style={styles.intro}>
          Show in app puts a calendar{'’'}s events in your views. Can publish to lets you add your own events to it, only when you make one Public.
        </AppText>
        {!v ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            {load === 'ready' ? <AppText style={{ color: text(0.6) }}>This account isn{'’'}t connected any more.</AppText> : <Spinner size={16} />}
          </View>
        ) : v.calendars.length === 0 ? (
          <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
            <Spinner size={16} />
            <AppText style={{ color: text(0.6), fontSize: 13 }}>Listing your calendars{'…'}</AppText>
          </View>
        ) : (
          v.calendars.map((c) => {
            const writable = canWrite(c.access_role);
            return (
              <Card key={c.id} style={{ marginBottom: 12 }}>
                <View style={styles.head}>
                  <ColorBar color={calendarColor(c)} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText style={styles.name} numberOfLines={1}>{c.name}</AppText>
                    <AppText style={styles.sub}>{c.is_primary ? 'Primary' : c.shared ? 'Shared' : writable ? 'Can publish' : 'Read only'}</AppText>
                  </View>
                </View>
                <Divider />
                <View style={styles.line}>
                  <AppText style={styles.lineTxt}>Show in app</AppText>
                  <Toggle value={c.show_in_app} onChange={(on) => flag(c.id, { show_in_app: on })} label={'Show ' + c.name + ' in app'} />
                </View>
                <Divider />
                <View style={[styles.line, !writable && { opacity: 0.45 }]}>
                  <AppText style={styles.lineTxt}>Can publish to</AppText>
                  <Toggle
                    value={c.can_publish && writable}
                    onChange={(on) => flag(c.id, { can_publish: on })}
                    label={'Publish to ' + c.name}
                    disabled={!writable}
                  />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 12.5, lineHeight: 18, color: text(0.5), marginHorizontal: 16, marginTop: 16, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  name: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  sub: { fontSize: 12, color: text(0.45), marginTop: 1 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 14, minHeight: 48 },
  lineTxt: { fontSize: 14.5 },
  footer: { paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: white(0.07), backgroundColor: SURFACE.bg },
  done: { minHeight: 46, borderRadius: 12, backgroundColor: '#f3efe8', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 14.5, fontWeight: '500', color: SURFACE.bg },
});
