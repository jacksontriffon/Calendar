import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { ACCENT, SURFACE, text, white } from '@calendar/core';

import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { ToastHost } from '@/components/Toast';
import { requestDevicePermission, setCalendarFlags, useDeviceCalendars, type DeviceCalendarView } from './index';

const INK = '#f3efe8';

/**
 * Phone calendars (CA 4): a short explainer, then the OS permission prompt, then Choose calendars.
 * There is a denied state with "Open Settings", and on web a note that this is a mobile feature.
 */
export function PhoneCalendarsScreen() {
  const c = useDeviceCalendars();
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings' as never));

  const allow = async () => {
    setBusy(true);
    try {
      const r = await requestDevicePermission();
      if (r !== 'granted') setAsked(true);
    } finally {
      setBusy(false);
    }
  };

  if (!c.supported) return <Unavailable onBack={back} />;
  if (!c.ready) return <Shell title="Phone calendars" sub="On this phone" onBack={back}><Loading label="Checking access…" /></Shell>;
  if (c.permission === 'granted') return <Choose c={c} onDone={back} onBack={back} />;
  if (c.permission === 'denied' && !c.canAskAgain) return <Denied onBack={back} />;
  return <Priming busy={busy} retry={asked} onContinue={allow} onNotNow={back} />;
}

/* ------------------------------------------------------------------ shell */

function Shell({ title, sub, onBack, children, footer }: { title: string; sub?: string; onBack: () => void; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={styles.page}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Icon name="chevronLeft" size={16} color={text(0.7)} strokeWidth={2} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText style={styles.barTitle} numberOfLines={1} accessibilityRole="header">{title}</AppText>
            {sub ? <AppText style={styles.barSub} numberOfLines={1}>{sub}</AppText> : null}
          </View>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
        {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>{footer}</View> : null}
        <ToastHost bottom={insets.bottom + 90} />
      </View>
    </View>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={text(0.5)} />
      <AppText style={styles.loadingTxt}>{label}</AppText>
    </View>
  );
}

/* -------------------------------------------------------------------- web */

function Unavailable({ onBack }: { onBack: () => void }) {
  return (
    <Shell title="Phone calendars" sub="On this phone" onBack={onBack}>
      <View style={styles.center} testID="phone-calendars-web">
        <View style={styles.badge}>
          <Icon name="phone" size={26} color={text(0.7)} strokeWidth={1.6} />
        </View>
        <AppText style={styles.h2}>Available in the mobile app</AppText>
        <AppText style={styles.body}>
          Phone calendars show events from iCloud and other calendars on your phone next to your own. Open Calendar on your iPhone or Android to use them.
        </AppText>
      </View>
    </Shell>
  );
}

/* ---------------------------------------------------------------- priming */

const SAMPLE = [
  { name: 'Calendar', color: '#8fb3a6', n: '6 events' },
  { name: 'Home', color: '#b0aea5', n: '2 events' },
  { name: 'Birthdays', color: '#d4a27f', n: '1 event' },
];

function Priming({ busy, retry, onContinue, onNotNow }: { busy: boolean; retry: boolean; onContinue: () => void; onNotNow: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root} testID="phone-calendars-priming">
      <View style={styles.page}>
        <View style={[styles.closeRow, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onNotNow} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
            <Icon name="close" size={13} color={text(0.6)} strokeWidth={1.5} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.primingBody} showsVerticalScrollIndicator={false}>
          <View style={styles.sample}>
            {SAMPLE.map((s, i) => (
              <View key={s.name} style={[styles.sampleRow, i > 0 && styles.sampleDivider]}>
                <View style={[styles.sampleBar, { backgroundColor: s.color }]} />
                <AppText style={styles.sampleName}>{s.name}</AppText>
                <AppText style={styles.sampleN}>{s.n}</AppText>
              </View>
            ))}
          </View>
          <View style={{ gap: 10 }}>
            <AppText style={styles.h1} accessibilityRole="header">Bring in your phone’s calendars</AppText>
            <AppText style={styles.lead}>See events from iCloud and other calendars on this phone next to your own.</AppText>
          </View>
          <View style={{ gap: 12 }}>
            {['You pick which calendars show.', 'Phone events stay on this phone. We never upload them.', 'You can add an event to a phone calendar when you choose to.'].map((t) => (
              <View key={t} style={styles.bullet}>
                <Icon name="check" size={15} color={ACCENT} strokeWidth={2} />
                <AppText style={styles.bulletTxt}>{t}</AppText>
              </View>
            ))}
          </View>
          {retry ? <AppText style={styles.retry}>Calendar access wasn’t turned on. You can try again, or skip this for now.</AppText> : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 18, gap: 4 }]}>
          <Pressable onPress={onContinue} disabled={busy} accessibilityRole="button" style={[styles.primary, busy && { opacity: 0.6 }]}>
            <AppText style={styles.primaryTxt}>Continue</AppText>
          </Pressable>
          <Pressable onPress={onNotNow} accessibilityRole="button" style={styles.quiet}>
            <AppText style={styles.quietTxt}>Not now</AppText>
          </Pressable>
          <AppText style={styles.caption}>Next, your phone asks for permission.</AppText>
        </View>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------------- denied */

function Denied({ onBack }: { onBack: () => void }) {
  const ios = Platform.OS === 'ios';
  const steps = ios
    ? [['Open Settings', ''], ['Tap ', 'Calendars'], ['Choose ', 'Full Access']]
    : [['Open Settings', ''], ['Tap ', 'Permissions, then Calendar'], ['Choose ', 'Allow']];
  return (
    <Shell title="Phone calendars" sub="On this phone" onBack={onBack}>
      <View style={styles.center} testID="phone-calendars-denied">
        <View style={styles.badge}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={text(0.7)} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <Rect x="3.5" y="5" width="17" height="15" rx="3" />
            <Path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
          </Svg>
        </View>
        <AppText style={styles.h2}>{ios ? 'Calendar access is off' : 'Calendar permission is off'}</AppText>
        <AppText style={styles.body}>
          {ios
            ? 'Calendar can’t see this phone’s calendars. Turn access on in Settings, then come back.'
            : 'Android won’t ask again. Turn the permission on in Settings, then come back.'}
        </AppText>
        <View style={styles.steps}>
          {steps.map(([a, b], i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNo}><AppText style={styles.stepNoTxt}>{i + 1}</AppText></View>
              <AppText style={styles.stepTxt}>
                {a}
                {b ? <AppText style={{ fontWeight: '600', color: INK }}>{b}</AppText> : null}
              </AppText>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: 'stretch', gap: 4, marginTop: 8 }}>
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={styles.primary}>
            <AppText style={styles.primaryTxt}>Open Settings</AppText>
          </Pressable>
          <Pressable onPress={onBack} accessibilityRole="button" style={styles.quiet}>
            <AppText style={styles.quietTxt}>Not now</AppText>
          </Pressable>
        </View>
      </View>
    </Shell>
  );
}

/* ---------------------------------------------------------------- choose */

function Choose({ c, onDone, onBack }: { c: ReturnType<typeof useDeviceCalendars>; onDone: () => void; onBack: () => void }) {
  const groups: { account: string; items: DeviceCalendarView[] }[] = [];
  c.calendars.forEach((cal) => {
    const g = groups.find((x) => x.account === cal.account);
    if (g) g.items.push(cal);
    else groups.push({ account: cal.account, items: [cal] });
  });
  return (
    <Shell
      title="Choose calendars"
      sub="On this phone"
      onBack={onBack}
      footer={
        <Pressable onPress={onDone} accessibilityRole="button" style={styles.primary} testID="phone-calendars-done">
          <AppText style={styles.primaryTxt}>Done</AppText>
        </Pressable>
      }
    >
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} testID="phone-calendars-choose">
        <AppText style={styles.hint}>
          Show in app puts a calendar’s events in your views. Can publish to lets you add your own events to it, only when you make one Public.
        </AppText>
        {c.duplicateAccounts.map((a) => (
          <View key={a} style={styles.banner} testID="phone-calendars-duplicates">
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={text(0.6)} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1 }}>
              <Path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
              <Path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
            </Svg>
            <View style={{ flex: 1, gap: 3 }}>
              <AppText style={styles.bannerTitle}>{a} is already connected</AppText>
              <AppText style={styles.bannerBody}>Its calendars are hidden here so events don’t show twice.</AppText>
            </View>
          </View>
        ))}
        {c.loading && !c.calendars.length ? <Loading label="Getting your calendars…" /> : null}
        {!c.loading && !c.calendars.length ? (
          <AppText style={[styles.hint, { textAlign: 'center', marginTop: 24 }]}>There are no calendars on this phone to show.</AppText>
        ) : null}
        {groups.map((g) => (
          <View key={g.account}>
            <AppText style={styles.groupLabel}>{g.account}</AppText>
            <View style={{ gap: 10 }}>
              {g.items.map((cal) => (
                <CalendarCard key={cal.key} cal={cal} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Shell>
  );
}

function CalendarCard({ cal }: { cal: DeviceCalendarView }) {
  return (
    <View style={[styles.card, !cal.showInApp && { opacity: 0.92 }]} testID={'phone-calendar-' + cal.key}>
      <View style={styles.cardHead}>
        <View style={[styles.bar4, { backgroundColor: cal.color, opacity: cal.showInApp ? 1 : 0.35 }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText style={styles.calName} numberOfLines={1}>{cal.name}</AppText>
          <AppText style={styles.calSub}>{cal.readOnly ? 'Read only' : 'Can publish'}</AppText>
        </View>
      </View>
      <ToggleRow label="Show in app" value={cal.showInApp} onChange={(v) => void setCalendarFlags(cal.key, { showInApp: v })} />
      <ToggleRow
        label="Can publish to"
        sub={cal.readOnly ? 'Read only calendar' : undefined}
        value={cal.canPublish}
        disabled={cal.readOnly}
        onChange={(v) => void setCalendarFlags(cal.key, { canPublish: v })}
      />
    </View>
  );
}

function ToggleRow({ label, sub, value, disabled, onChange }: { label: string; sub?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.55 }]}>
      <View style={{ flex: 1 }}>
        <AppText style={styles.toggleLabel}>{label}</AppText>
        {sub ? <AppText style={styles.toggleSub}>{sub}</AppText> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: white(0.12), true: ACCENT }}
        thumbColor={value ? '#17120f' : text(0.65)}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#100f0e', alignItems: 'center' },
  page: { flex: 1, width: '100%', maxWidth: 480, backgroundColor: SURFACE.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: white(0.07), backgroundColor: '#1b1a18' },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.06) },
  barTitle: { fontSize: 21, lineHeight: 25, fontWeight: '600', letterSpacing: -0.5 },
  barSub: { fontSize: 11.5, lineHeight: 15, color: text(0.45) },
  footer: { paddingHorizontal: 14, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28 },
  loadingTxt: { fontSize: 12.5, color: text(0.5) },
  badge: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.06) },
  h1: { fontSize: 25, lineHeight: 30, fontWeight: '600', letterSpacing: -0.6 },
  h2: { fontSize: 21, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4, textAlign: 'center' },
  lead: { fontSize: 14, lineHeight: 21, color: text(0.55) },
  body: { fontSize: 13.5, lineHeight: 20, color: text(0.55), textAlign: 'center', maxWidth: 300 },
  closeRow: { alignItems: 'flex-end', paddingHorizontal: 14 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.06) },
  primingBody: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 20, gap: 26 },
  sample: { alignSelf: 'center', width: 250, backgroundColor: '#201e1c', borderRadius: 12, borderWidth: 1, borderColor: white(0.08), overflow: 'hidden' },
  sampleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  sampleDivider: { borderTopWidth: 1, borderTopColor: white(0.07) },
  sampleBar: { width: 4, height: 24, borderRadius: 2 },
  sampleName: { flex: 1, fontSize: 12.5, fontWeight: '500' },
  sampleN: { fontSize: 11, color: text(0.4) },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletTxt: { flex: 1, fontSize: 13.5, lineHeight: 19, color: text(0.78) },
  retry: { fontSize: 12.5, lineHeight: 18, color: text(0.55) },
  primary: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: INK },
  primaryTxt: { fontSize: 14, fontWeight: '500', color: SURFACE.bg },
  quiet: { height: 42, alignItems: 'center', justifyContent: 'center' },
  quietTxt: { fontSize: 13.5, color: text(0.6) },
  caption: { fontSize: 11.5, color: text(0.38), textAlign: 'center', marginTop: 2 },
  steps: { alignSelf: 'stretch', gap: 12, marginTop: 6, paddingHorizontal: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNo: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.08) },
  stepNoTxt: { fontSize: 12, fontWeight: '600', color: text(0.7) },
  stepTxt: { flex: 1, fontSize: 13.5, color: text(0.7) },
  list: { padding: 14, paddingBottom: 40, gap: 0 },
  hint: { fontSize: 11.5, lineHeight: 16, color: text(0.4), paddingHorizontal: 2 },
  banner: { flexDirection: 'row', gap: 11, marginTop: 16, padding: 13, borderRadius: 12, backgroundColor: white(0.05), borderWidth: 1, borderColor: white(0.1) },
  bannerTitle: { fontSize: 13.5, fontWeight: '600' },
  bannerBody: { fontSize: 12, lineHeight: 17, color: text(0.78) },
  groupLabel: { fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: text(0.34), marginTop: 18, marginBottom: 8, marginHorizontal: 2 },
  card: { backgroundColor: white(0.04), borderWidth: 1, borderColor: white(0.08), borderRadius: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 8, paddingHorizontal: 14 },
  bar4: { width: 4, height: 32, borderRadius: 2 },
  calName: { fontSize: 14.5, lineHeight: 19, fontWeight: '500' },
  calSub: { fontSize: 11.5, lineHeight: 15, color: text(0.45) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: white(0.07) },
  toggleLabel: { fontSize: 13.5, color: INK },
  toggleSub: { fontSize: 11, color: text(0.45) },
});
