import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENT, SURFACE, text, white } from '@calendar/core';

import { AppInput, AppText } from '@/components/AppText';
import { FONT_LABELS, asFontKey, fontFamilyFor, type FontKey } from '@/components/fonts';
import { UserAvatar } from '@/features/auth';
import { Icon, type IconName } from '@/components/Icon';
import { ToastHost } from '@/components/Toast';
import { showToast } from '@/components/toast';
import { getStore, useHistory, usePrefs, useSyncStatus } from '@/store';
import { useNow } from '../calendar/useNow';
import { runCheckInNow } from '../checkin/CheckInHost';
import { undoEntry } from '../history/commit';
import {
  REGION_LIST, daylightNote, historyRows, regionLabel, sunForRegion, sunWithTime,
} from './model';

const FONTS: FontKey[] = ['serif', 'sans', 'mono'];

/** Settings (CA 5): Account, Calendars, region and sun, typeface, Claude parsing, check-ins and History. */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const history = useHistory();
  const sync = useSyncStatus();
  const now = useNow();
  const [regionOpen, setRegionOpen] = useState(false);
  const [sr, setSr] = useState<string | null>(null);
  const [ss, setSs] = useState<string | null>(null);
  const font = asFontKey(prefs.font);

  const soon = (what: string) => showToast({ label: what + ' arrives in a later phase' });
  const setSun = (which: 'sunrise' | 'sunset', v: string) => {
    const next = sunWithTime(prefs.sun, which, v);
    if (next) getStore().setPrefs({ sun: next });
  };
  const rows = historyRows(history, now.nowMs);

  return (
    <View style={styles.root}>
      <View style={styles.page}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="chevronLeft" size={20} color={text(0.7)} />
          </Pressable>
          <AppText style={styles.barTitle} accessibilityRole="header">Settings</AppText>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {/* Account first (CA 5.1). The Account screen is owned by the auth work. */}
          <Group>
            <Pressable onPress={() => router.push('/settings/account' as never)} accessibilityRole="button" style={styles.accountRow} testID="account-row">
              <UserAvatar size={38} />
              <View style={{ flex: 1 }}>
                <AppText style={styles.rowTitle}>Account</AppText>
                <AppText style={styles.rowSub}>
                  {sync === 'syncing' ? 'Syncing…' : sync === 'offline' ? 'Offline' : sync === 'error' ? 'Sync problem' : 'Synced'}
                </AppText>
              </View>
              <Icon name="chevronRight" size={16} color={text(0.35)} />
            </Pressable>
          </Group>

          <Label>Calendars</Label>
          <Group>
            {/* TODO(phase 5/6): real routes: settings/calendars, settings/google, settings/phone, settings/hidden. */}
            <NavRow icon="eye" title="My calendar" sub="Shown" onPress={() => soon('Calendar visibility')} />
            <NavRow icon="google" title="Google accounts" sub="Not connected" onPress={() => soon('Google accounts')} />
            <NavRow icon="phone" title="On this phone" sub="Available in the mobile app" onPress={() => soon('Phone calendars')} />
            <NavRow icon="eye" title="Hidden events" sub="None" onPress={() => soon('Hidden events')} last />
          </Group>

          <Label>Region and sun</Label>
          <Group>
            <Pressable onPress={() => setRegionOpen((o) => !o)} style={styles.row} accessibilityRole="button">
              <AppText style={styles.rowTitle}>Region</AppText>
              <View style={{ flex: 1 }} />
              <AppText style={styles.value}>{regionLabel(prefs.sun.region)}</AppText>
              <Icon name="chevronDown" size={14} color={text(0.35)} />
            </Pressable>
            {regionOpen ? (
              <View style={styles.regionList}>
                {REGION_LIST.map((r) => (
                  <Pressable
                    key={r.k}
                    onPress={() => {
                      const s = sunForRegion(r.k);
                      if (s) getStore().setPrefs({ sun: s });
                      setSr(null);
                      setSs(null);
                      setRegionOpen(false);
                    }}
                    style={styles.regionRow}
                    accessibilityRole="button"
                  >
                    <AppText style={[styles.regionTxt, prefs.sun.region === r.k && { color: ACCENT }]}>{r.label}</AppText>
                    {prefs.sun.region === r.k ? <Icon name="check" size={14} color={ACCENT} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.row}>
              <AppText style={styles.rowTitle}>Sunrise</AppText>
              <View style={{ flex: 1 }} />
              <AppInput
                value={sr ?? hm24(prefs.sun.sunrise)}
                onChangeText={(v) => { setSr(v); setSun('sunrise', v); }}
                onBlur={() => setSr(null)}
                style={styles.timeInput}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Sunrise"
              />
            </View>
            <View style={styles.row}>
              <AppText style={styles.rowTitle}>Sunset</AppText>
              <View style={{ flex: 1 }} />
              <AppInput
                value={ss ?? hm24(prefs.sun.sunset)}
                onChangeText={(v) => { setSs(v); setSun('sunset', v); }}
                onBlur={() => setSs(null)}
                style={styles.timeInput}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Sunset"
              />
            </View>
            <AppText style={styles.note}>{daylightNote(prefs.sun)}</AppText>
          </Group>

          <Label>Typeface</Label>
          <Group>
            <View style={styles.fontRow}>
              {FONTS.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => getStore().setPrefs({ font: f })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: font === f }}
                  style={[styles.fontOpt, font === f && styles.fontOn]}
                >
                  <Text style={[styles.fontSample, { fontFamily: fontFamilyFor(f, 500) }]}>Aa</Text>
                  <AppText style={[styles.fontName, font === f && { color: text(1) }]}>{f === 'serif' ? 'Serif' : f === 'sans' ? 'Sans' : 'Mono'}</AppText>
                  <AppText style={styles.fontSub}>{FONT_LABELS[f]}</AppText>
                </Pressable>
              ))}
            </View>
          </Group>

          <Label>Claude parsing</Label>
          <Group>
            {/* TODO(phase 4): model, ask-first and usage toggles live here once ai-schedule exists. */}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.rowTitle}>Claude parsing</AppText>
                <AppText style={styles.rowSub}>Model, questions and usage arrive with the composer.</AppText>
              </View>
              <AppText style={styles.value}>Soon</AppText>
            </View>
            <View style={[styles.row, { borderTopWidth: 1, borderTopColor: white(0.06) }]}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.rowTitle}>Check-ins</AppText>
                <AppText style={styles.rowSub}>A few questions after a long time away.</AppText>
              </View>
              <Switch
                value={prefs.ai.checkin}
                onValueChange={(v) => getStore().setPrefs({ ai: { ...prefs.ai, checkin: v } })}
                trackColor={{ false: white(0.12), true: ACCENT }}
                thumbColor={prefs.ai.checkin ? '#17120f' : text(0.65)}
                accessibilityLabel="Check-ins"
              />
            </View>
            <Pressable
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/');
                setTimeout(runCheckInNow, 320);
              }}
              style={[styles.row, { borderTopWidth: 1, borderTopColor: white(0.06) }]}
              accessibilityRole="button"
            >
              <AppText style={[styles.rowTitle, { color: ACCENT }]}>Run a check-in now</AppText>
            </Pressable>
          </Group>

          <Label>History</Label>
          <Group>
            <AppText style={styles.note}>
              {rows.length
                ? 'Saved on this device. Revert puts the calendar back to how it was just before that change.'
                : 'Every change — yours or Claude’s — is logged here with a way back.'}
            </AppText>
            {rows.map((h) => (
              <View key={h.id} style={styles.histRow} testID="history-row">
                <View style={[styles.histDot, { backgroundColor: h.dot }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText style={styles.histLabel} numberOfLines={2}>{h.label}</AppText>
                  <AppText style={styles.rowSub}>{h.meta}{h.tag ? ' · ' + h.tag : ''}</AppText>
                </View>
                <Pressable onPress={() => undoEntry(h.id)} accessibilityRole="button" accessibilityLabel={'Revert ' + h.label} style={styles.revert}>
                  <Icon name="undo" size={12} color={text(0.66)} />
                  <AppText style={styles.revertTxt}>Revert</AppText>
                </Pressable>
              </View>
            ))}
          </Group>
        </ScrollView>
        <ToastHost bottom={insets.bottom + 16} />
      </View>
    </View>
  );
}

const hm24 = (m: number): string => {
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return p(Math.floor(m / 60)) + ':' + p(m % 60);
};

function Label({ children }: { children: string }) {
  return <AppText style={styles.label}>{children}</AppText>;
}
function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}
function NavRow({ icon, title, sub, onPress, last }: { icon: IconName; title: string; sub: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, !last && styles.rowDivider]}>
      <Icon name={icon} size={16} color={text(0.55)} />
      <View style={{ flex: 1 }}>
        <AppText style={styles.rowTitle}>{title}</AppText>
        <AppText style={styles.rowSub}>{sub}</AppText>
      </View>
      <Icon name="chevronRight" size={16} color={text(0.35)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100f0e', alignItems: 'center' },
  page: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: SURFACE.bg },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: white(0.07), backgroundColor: '#1b1a18' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  label: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34), marginTop: 24, marginBottom: 8, marginHorizontal: 20 },
  group: { marginHorizontal: 14, backgroundColor: SURFACE.sheet, borderRadius: 14, borderWidth: 1, borderColor: white(0.07), overflow: 'hidden' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: white(0.06) },
  rowTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: '#f6f2ec' },
  rowSub: { fontSize: 12, lineHeight: 16, color: text(0.42), marginTop: 1 },
  value: { fontSize: 13, color: text(0.55) },
  note: { fontSize: 12, lineHeight: 17, color: text(0.42), paddingHorizontal: 14, paddingVertical: 10 },
  regionList: { borderTopWidth: 1, borderTopColor: white(0.06), maxHeight: 260 },
  regionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 18 },
  regionTxt: { fontSize: 13.5, color: text(0.8) },
  timeInput: { width: 64, textAlign: 'right', fontSize: 14, color: text(0.8), fontVariant: ['tabular-nums'] },
  fontRow: { flexDirection: 'row', gap: 8, padding: 10 },
  fontOpt: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 11, backgroundColor: white(0.04), borderWidth: 1, borderColor: 'transparent' },
  fontOn: { backgroundColor: white(0.09), borderColor: white(0.16) },
  fontSample: { fontSize: 24, color: '#f6f2ec' },
  fontName: { fontSize: 12.5, fontWeight: '600', color: text(0.6), marginTop: 4 },
  fontSub: { fontSize: 10.5, color: text(0.34), marginTop: 1 },
  histRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: white(0.06) },
  histDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  histLabel: { fontSize: 13.5, lineHeight: 18, color: text(0.85) },
  revert: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: white(0.18) },
  revertTxt: { fontSize: 11.5, color: text(0.66) },
});
