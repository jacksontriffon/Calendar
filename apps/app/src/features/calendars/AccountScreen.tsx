import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { DANGER, text } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { ConfirmDialog } from '@/features/auth/ConfirmDialog';
import { Glyph, Spinner } from '../visibility/glyphs';
import { getCalendarsStore, useGoogleAccounts } from './data';
import { calendarColor, calendarRoleLabel, countsLine, syncedLabel } from './view';
import { chooseHref, useConnectGoogle } from './useConnect';
import { Banner, Card, ColorBar, Divider, GoogleBadge, Label, NavRow, PlainButton, Screen, SharedPill, goBack } from './ui';

/** Google account (CA 3.2–3.5): status and Sync now, its calendars, Reconnect when it needs signing in, Disconnect. */
export function AccountScreen({ id }: { id: string }) {
  const { views, load, syncing } = useGoogleAccounts();
  const { busy, notice, connect } = useConnectGoogle();
  const [confirm, setConfirm] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const v = views.find((x) => x.account.id === id);

  if (!v) {
    return (
      <Screen title="Google account">
        <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          {load === 'ready' ? <AppText style={{ color: text(0.6) }}>This account isn{'’'}t connected any more.</AppText> : <Spinner size={16} />}
          {load === 'ready' ? <PlainButton label="Back to Calendars" onPress={goBack} /> : null}
        </View>
      </Screen>
    );
  }

  const disconnect = async () => {
    setConfirm(false);
    try {
      await getCalendarsStore().disconnect(v.account.id);
      showToast({ label: 'Disconnected ' + v.account.email });
      goBack();
    } catch {
      showToast({ label: 'Couldn’t disconnect. Try again in a moment.' });
    }
  };

  return (
    <Screen title="Google account" subtitle={v.account.email}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {notice ? <Banner text={notice} tone="error" /> : null}
        <Card style={{ marginTop: 16 }}>
          <View style={styles.top}>
            <GoogleBadge size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText style={styles.email} numberOfLines={1}>{v.account.email}</AppText>
              <AppText style={[styles.sub, v.needsSignIn && { color: DANGER }]}>{v.needsSignIn ? 'Needs sign-in' : 'Connected'}</AppText>
            </View>
          </View>
          <Divider />
          <View style={styles.sync}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.sub}>Last synced</AppText>
              <AppText style={styles.when}>{syncedLabel(v.lastSyncedAt, nowMs).replace(/^Synced /, '')}</AppText>
            </View>
            {v.needsSignIn ? (
              <PlainButton label={busy ? 'Opening…' : 'Reconnect'} onPress={() => void connect({ accountId: v.account.id })} disabled={busy} danger />
            ) : (
              <PlainButton
                label={syncing ? 'Syncing…' : 'Sync now'}
                onPress={() => {
                  getCalendarsStore().syncNow().then(
                    () => showToast({ label: 'Calendars synced' }),
                    () => showToast({ label: 'Couldn’t sync. Try again in a moment.' }),
                  );
                }}
                disabled={syncing}
                icon={syncing ? <Spinner size={13} /> : <Glyph name="refresh" size={14} color={text(0.8)} />}
              />
            )}
          </View>
        </Card>

        <Label>Calendars</Label>
        <Card>
          <NavRow
            icon={<Glyph name="calendar" size={16} color={text(0.8)} />}
            title="Choose calendars"
            sub={countsLine(v)}
            onPress={() => router.push(chooseHref(v.account.id) as never)}
          />
          {v.calendars.map((c) => (
            <View key={c.id}>
              <Divider />
              <View style={styles.cal}>
                <ColorBar color={calendarColor(c)} dim={!c.show_in_app} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText style={styles.calName} numberOfLines={1}>{c.name}</AppText>
                  <AppText style={styles.sub}>
                    {calendarRoleLabel(c)}{c.show_in_app ? ' · Shown' : ' · Hidden'}
                  </AppText>
                </View>
                {c.shared ? <SharedPill /> : null}
              </View>
            </View>
          ))}
        </Card>

        <Label>Accounts</Label>
        <Card>
          <NavRow
            icon={<Icon name="plus" size={16} color={text(0.8)} />}
            title="Add another Google account"
            onPress={() => void connect()}
          />
        </Card>

        <View style={{ marginHorizontal: 14, marginTop: 28 }}>
          <PlainButton label="Disconnect" onPress={() => setConfirm(true)} danger />
          <AppText style={styles.foot}>Imported events are removed from this app. Nothing changes in your Google Calendar.</AppText>
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirm}
        title={'Disconnect ' + v.account.email + '?'}
        message={'Its events leave this app and its calendars stop showing. Copies you published stay in Google Calendar.'}
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => void disconnect()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  email: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  sub: { fontSize: 12, lineHeight: 16, color: text(0.45), marginTop: 1 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  when: { fontSize: 15, fontWeight: '500', marginTop: 2 },
  cal: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  calName: { fontSize: 14, fontWeight: '500' },
  foot: { fontSize: 12, lineHeight: 17, color: text(0.38), marginTop: 10 },
});
