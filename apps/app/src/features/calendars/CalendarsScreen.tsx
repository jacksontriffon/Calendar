import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DANGER, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/toast';
import { Glyph, Spinner } from '../visibility/glyphs';
import { useGoogleAccounts, useHiddenItems, getCalendarsStore } from './data';
import { PHONE_CALENDARS_ROUTE, usePhoneCalendarsSummary, useDeviceCalendars } from './device';
import { calendarColor, calendarRoleLabel, syncedLabel, type AccountView } from './view';
import { useConnectGoogle, useConnectReturn } from './useConnect';
import { Banner, Card, ColorBar, Divider, GoogleBadge, Label, NavRow, PlainButton, Screen, SharedPill, Toggle } from './ui';

/** Settings › Calendars (CA 1, CA 5): My calendar, Google accounts and their calendars, this phone, Hidden events. */
export function CalendarsScreen() {
  const { views, load, error, syncing, refresh } = useGoogleAccounts();
  const hidden = useHiddenItems();
  const device = useDeviceCalendars();
  const { busy, notice, connect, clearNotice } = useConnectGoogle();
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const onNotice = useCallback((m: string) => setReturnNotice(m), []);
  useConnectReturn(onNotice);
  const shownNotice = notice ?? returnNotice;
  const [now] = useState(() => Date.now());

  const sync = () => {
    getCalendarsStore().syncNow().then(
      () => showToast({ label: 'Calendars synced' }),
      () => showToast({ label: 'Couldn’t sync. Try again in a moment.' }),
    );
  };
  const flag = (id: string, patch: { show_in_app?: boolean; can_publish?: boolean }) => {
    getCalendarsStore().setCalendarFlag(id, patch).catch(() => showToast({ label: 'Couldn’t save that change.' }));
  };

  const phoneSub = usePhoneCalendarsSummary();

  return (
    <Screen title="Calendars" subtitle="Choose what shows in your views">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {error && load === 'ready' ? <Banner text="Couldn't refresh your calendars. Showing what was saved." tone="error" action={{ label: 'Retry', run: () => void refresh() }} /> : null}
        {shownNotice ? <Banner text={shownNotice} tone="error" action={{ label: 'Dismiss', run: () => { clearNotice(); setReturnNotice(null); } }} /> : null}

        <Label>My calendar</Label>
        <Card>
          <View style={styles.row}>
            <ColorBar color="#cf7b58" />
            <View style={{ flex: 1 }}>
              <AppText style={styles.name}>My calendar</AppText>
              <AppText style={styles.sub}>Default {'·'} new events go here</AppText>
            </View>
          </View>
        </Card>

        <Label
          right={
            <PlainButton
              label="Add account"
              onPress={() => void connect()}
              disabled={busy}
              icon={<Icon name="plus" size={13} color={text(0.8)} />}
            />
          }
        >
          Google
        </Label>

        {load === 'idle' || load === 'loading' ? (
          <Card>
            <View style={[styles.row, { gap: 10 }]}>
              <Spinner size={14} />
              <AppText style={styles.sub}>Loading your Google accounts{'…'}</AppText>
            </View>
          </Card>
        ) : load === 'error' ? (
          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.name}>Couldn{'’'}t load your accounts</AppText>
                <AppText style={styles.sub}>{error || 'Check your connection and try again.'}</AppText>
              </View>
              <PlainButton label="Try again" onPress={() => void refresh()} />
            </View>
          </Card>
        ) : views.length === 0 ? (
          <Card>
            <NavRow
              icon={<Icon name="google" size={16} color={text(0.8)} strokeWidth={0} />}
              title="Connect Google"
              sub="Show your Google calendars here, and publish events to them when you make one Public."
              onPress={() => void connect()}
            />
          </Card>
        ) : (
          views.map((v) => <AccountCard key={v.account.id} v={v} now={now} onFlag={flag} onReconnect={() => void connect({ accountId: v.account.id })} />)
        )}

        <Label>On this phone</Label>
        <Card>
          <NavRow
            icon={<Icon name="phone" size={16} color={text(0.8)} />}
            title="On this phone"
            sub={phoneSub}
            onPress={() => (device.supported ? router.push(PHONE_CALENDARS_ROUTE as never) : showToast({ label: 'Phone calendars are available in the mobile app' }))}
          />
        </Card>

        <Label>Hidden events</Label>
        <Card>
          <NavRow
            icon={<Icon name="eye" size={16} color={text(0.8)} />}
            title="Hidden events"
            sub={hidden.length ? hidden.length + (hidden.length === 1 ? ' event removed from your view' : ' events removed from your view') : 'None'}
            onPress={() => router.push('/settings/calendars/hidden' as never)}
          />
        </Card>

        {views.length ? (
          <View style={{ marginHorizontal: 14, marginTop: 22, flexDirection: 'row', justifyContent: 'center' }}>
            <PlainButton
              label={syncing ? 'Syncing…' : 'Sync now'}
              onPress={sync}
              disabled={syncing}
              icon={syncing ? <Spinner size={13} /> : <Glyph name="refresh" size={14} color={text(0.8)} />}
            />
          </View>
        ) : null}
        <AppText style={styles.foot}>Google events show in your views. Yours go to Google only when you make one Public.</AppText>
      </ScrollView>
    </Screen>
  );
}

function AccountCard({ v, now, onFlag, onReconnect }: {
  v: AccountView; now: number; onFlag: (id: string, p: { show_in_app?: boolean }) => void; onReconnect: () => void;
}) {
  const dim = v.needsSignIn;
  return (
    <Card style={{ marginBottom: 12 }}>
      <Pressable onPress={() => router.push(`/settings/calendars/account/${v.account.id}` as never)} accessibilityRole="button" style={styles.accountHead} testID="account-row">
        <GoogleBadge />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText style={styles.name} numberOfLines={1}>{v.account.email}</AppText>
          {v.needsSignIn ? (
            <AppText style={[styles.sub, { color: DANGER }]}>Needs sign-in</AppText>
          ) : (
            <AppText style={styles.sub}>{syncedLabel(v.lastSyncedAt, now)}</AppText>
          )}
        </View>
        {v.needsSignIn ? (
          <PlainButton label="Reconnect" onPress={onReconnect} danger />
        ) : (
          <Icon name="chevronRight" size={15} color={text(0.35)} />
        )}
      </Pressable>
      {v.calendars.map((c) => (
        <View key={c.id}>
          <Divider />
          <View style={[styles.row, dim && { opacity: 0.45 }]}>
            <ColorBar color={calendarColor(c)} dim={!c.show_in_app} />
            <View style={{ flex: 1, minWidth: 0, opacity: c.show_in_app ? 1 : 0.5 }}>
              <AppText style={styles.name} numberOfLines={1}>{c.name}</AppText>
              <AppText style={styles.sub}>{calendarRoleLabel(c)}</AppText>
            </View>
            {c.shared ? <SharedPill /> : null}
            <Toggle value={c.show_in_app} onChange={(on) => onFlag(c.id, { show_in_app: on })} label={'Show ' + c.name + ' in app'} disabled={dim} />
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: white(0.02) },
  name: { fontSize: 15, fontWeight: '500', letterSpacing: -0.2 },
  sub: { fontSize: 12, lineHeight: 16, color: text(0.45), marginTop: 1 },
  foot: { fontSize: 12, lineHeight: 17, color: text(0.38), marginHorizontal: 20, marginTop: 18 },
});
