/**
 * First-run setup (OA 2.1-2.12): You -> Calendars -> Notifications.
 * Every step can be skipped; signing in can't. Completion is persisted to
 * `profiles.prefs.onboarded`, which is what sends the user on to the calendar.
 */
import { ACCENT, white } from '@calendar/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/features/auth/Avatar';
import { GoogleMark, Icon } from '@/features/auth/icons';
import { useSession } from '@/features/auth/session';
import {
  AppText,
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  Footer,
  InlineError,
  Row,
  SmallButton,
  TextButton,
  Title,
  asFontStyle,
  ui,
  useFontKind,
} from '@/features/auth/ui';
import { detectTimeZone, cityName, listTimeZones, zoneDetail } from '@/lib/tz';
import { useRouteExists } from '@/lib/useRouteExists';

import { requestNotificationPermission } from './notifications';
import {
  advance,
  chooseCalendars,
  chooseNotifications,
  currentStep,
  initialSetup,
  profilePatch,
  progressSegments,
  setName,
  setTz,
  skip,
  stepLabel,
  type SetupState,
} from './steps';

export const GOOGLE_CONNECT_ROUTE = '/settings/calendars/google/connect';
export const PHONE_CALENDARS_ROUTE = '/settings/calendars/phone';

export function SetupFlow() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routeExists = useRouteExists();
  const { displayName, email, profile, saveProfile, saveEntryPrefs } = useSession();

  const [detectedTz] = useState(detectTimeZone);
  const [state, setState] = useState<SetupState>(() =>
    initialSetup({ name: displayName ?? '', tz: detectedTz, platform: Platform.OS }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);

  // Connect Google / Use phone calendars open screens from a later phase; when
  // they return, setup moves on (all three choices advance to step 3).
  const awaitingReturn = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (awaitingReturn.current) {
        awaitingReturn.current = false;
        setState((s) => advance(s));
      }
    }, []),
  );

  const step = currentStep(state);

  const finish = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveEntryPrefs({ onboarded: true });
      // The gate in the root layout now sends the user to the calendar.
    } catch {
      setError('Couldn’t save your setup. Check your connection and try again.');
      setSaving(false);
    }
  }, [saveEntryPrefs]);

  // Every move goes through here so leaving the last step persists completion.
  const move = (fn: (s: SetupState) => SetupState) => {
    const next = fn(state);
    setState(next);
    if (next.finished && !state.finished) void finish();
  };

  const saveYou = async (ignoreErrors: boolean): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await saveProfile(profilePatch(state));
      setSaving(false);
      return true;
    } catch {
      setSaving(false);
      if (ignoreErrors) return true;
      setError('Couldn’t save that. Check your connection and try again.');
      return false;
    }
  };

  const onContinueYou = async () => {
    if (await saveYou(false)) move(advance);
  };

  const onSkip = async () => {
    // Skip on step 1 keeps the pre-filled values (it still saves them).
    if (step === 'you') await saveYou(true);
    setNotifDenied(false);
    move(skip);
  };

  const goTo = (route: string, choice: 'google' | 'phone') => {
    if (!routeExists(route)) {
      // The screen isn't built yet (a later phase): treat it as "Not now".
      move((s) => advance(chooseCalendars(s, 'skipped')));
      return;
    }
    awaitingReturn.current = true;
    setState((s) => chooseCalendars(s, choice));
    router.push(route as never);
  };

  const onTurnOnNotifications = async () => {
    setSaving(true);
    const result = await requestNotificationPermission();
    setSaving(false);
    if (result === 'granted') {
      move((s) => advance(chooseNotifications(s, 'granted')));
    } else {
      setState((s) => chooseNotifications(s, 'denied'));
      setNotifDenied(true);
    }
  };

  const segments = progressSegments(state);

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.progressRow}>
        <View style={styles.segments}>
          {segments.map((on, i) => (
            <View key={i} style={[styles.segment, { backgroundColor: on ? ACCENT : white(0.12) }]} />
          ))}
        </View>
        <Pressable accessibilityRole="button" testID="setup-skip" onPress={() => void onSkip()} hitSlop={8} style={{ paddingVertical: 4, paddingLeft: 6 }}>
          <AppText size={14} color="rgba(243,239,232,0.55)">
            Skip
          </AppText>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Eyebrow style={{ marginTop: 26 }}>{stepLabel(state)}</Eyebrow>

        {step === 'you' ? (
          <YouStep
            state={state}
            detectedTz={detectedTz}
            email={email}
            fallbackName={profile?.display_name ?? ''}
            onName={(n) => setState((s) => setName(s, n))}
            onOpenTz={() => setTzOpen(true)}
          />
        ) : step === 'calendars' ? (
          <CalendarsStep onGoogle={() => goTo(GOOGLE_CONNECT_ROUTE, 'google')} onPhone={() => goTo(PHONE_CALENDARS_ROUTE, 'phone')} />
        ) : (
          <NotificationsStep denied={notifDenied} />
        )}

        {error ? <View style={{ marginTop: 16 }}><InlineError testID="setup-error">{error}</InlineError></View> : null}
      </ScrollView>

      <Footer>
        {state.finished ? (
          <Button label={error ? 'Try again' : 'Finishing up…'} testID="setup-finish" onPress={() => void finish()} loading={saving} />
        ) : step === 'you' ? (
          <Button label="Continue" testID="setup-continue" onPress={() => void onContinueYou()} loading={saving} />
        ) : step === 'calendars' ? (
          <TextButton label="Not now" testID="setup-not-now" onPress={() => move((s) => advance(chooseCalendars(s, 'skipped')))} color="rgba(243,239,232,0.6)" size={15} />
        ) : notifDenied ? (
          <>
            <Button label="Open Settings" variant="light" onPress={() => void Linking.openSettings()} />
            <Button label="Continue without" variant="ghost" onPress={() => move(advance)} />
          </>
        ) : (
          <>
            <Button label="Turn on notifications" testID="setup-notifications" onPress={() => void onTurnOnNotifications()} loading={saving} />
            <TextButton label="Not now" onPress={() => move((s) => advance(chooseNotifications(s, 'skipped')))} color="rgba(243,239,232,0.6)" size={15} />
          </>
        )}
      </Footer>

      <TimeZonePicker
        visible={tzOpen}
        selected={state.tz}
        detected={detectedTz}
        onClose={() => setTzOpen(false)}
        onSelect={(tz) => {
          setState((s) => setTz(s, tz));
          setTzOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

/* ---------- step 1: You ---------- */

function YouStep({
  state,
  detectedTz,
  email,
  fallbackName,
  onName,
  onOpenTz,
}: {
  state: SetupState;
  detectedTz: string;
  email: string | null;
  fallbackName: string;
  onName: (n: string) => void;
  onOpenTz: () => void;
}) {
  const kind = useFontKind();
  return (
    <>
      <View style={{ marginTop: 10 }}>
        <Title>What should we call you?</Title>
      </View>
      <Body style={{ marginTop: 8 }}>Shows on your account and in check-ins.</Body>

      <View style={styles.nameRow}>
        <Avatar name={state.name || fallbackName || email} size={56} />
        <TextInput
          testID="setup-name"
          value={state.name}
          onChangeText={onName}
          placeholder="Your name"
          placeholderTextColor="rgba(243,239,232,0.34)"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="done"
          style={[styles.field, { flex: 1, ...asFontStyle(kind) }]}
        />
      </View>

      <Eyebrow style={{ marginTop: 22 }}>Time zone</Eyebrow>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time zone, ${cityName(state.tz)}`}
        testID="setup-tz"
        onPress={onOpenTz}
        style={({ pressed }) => [styles.tzField, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText size={14.5} lineHeight={20}>
            {cityName(state.tz)}
          </AppText>
          <AppText size={11.5} lineHeight={16} color={ui.soft}>
            {zoneDetail(state.tz)}
          </AppText>
        </View>
        {state.tz === detectedTz ? (
          <View style={styles.detected}>
            <AppText size={10.5} weight={600} letterSpacing={0.3} color={ACCENT}>
              Detected
            </AppText>
          </View>
        ) : null}
        <AppText size={10} color={white(0.4) as string}>
          ▾
        </AppText>
      </Pressable>
      <Caption style={{ marginTop: 8 }}>Read from your phone. Event times and check-ins follow it.</Caption>
    </>
  );
}

/* ---------- step 2: Calendars ---------- */

function CalendarsStep({ onGoogle, onPhone }: { onGoogle: () => void; onPhone: () => void }) {
  return (
    <>
      <View style={{ marginTop: 10 }}>
        <Title>Bring your calendars</Title>
      </View>
      <Body style={{ marginTop: 8 }}>Pull in events you already have. Change this any time in Settings.</Body>
      <View style={{ marginTop: 24 }}>
        <Card>
          <Row
            title="Google Calendar"
            subtitle="Show your Google events next to yours."
            leading={
              <View style={styles.brandBox}>
                <GoogleMark size={17} />
              </View>
            }
            right={<SmallButton label="Connect" testID="setup-connect-google" onPress={onGoogle} />}
          />
          {Platform.OS !== 'web' ? (
            <Row
              title="Phone calendars"
              subtitle="Show events from iCloud and other calendars on this phone."
              icon="phone"
              right={<SmallButton label="Use" testID="setup-use-phone" onPress={onPhone} />}
            />
          ) : null}
        </Card>
      </View>
    </>
  );
}

/* ---------- step 3: Notifications ---------- */

function NotificationsStep({ denied }: { denied: boolean }) {
  return (
    <>
      <View style={{ marginTop: 10 }}>
        <Title>Stay on time</Title>
      </View>
      <Body style={{ marginTop: 8 }}>Two things we’d like to nudge you about. Nothing else.</Body>

      {denied ? (
        <View style={{ marginTop: 26 }}>
          <InlineError>
            Notifications are off. Reminders and check-ins can’t reach you until you turn them on in Settings.
          </InlineError>
        </View>
      ) : (
        <View style={styles.sample}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText size={12} weight={600} color="rgba(243,239,232,0.8)">
              Calendar
            </AppText>
            <AppText size={12} color="rgba(243,239,232,0.55)">
              now
            </AppText>
          </View>
          <AppText size={13.5} lineHeight={18} weight={500}>
            Dog walk starts in 10 minutes
          </AppText>
          <AppText size={12} lineHeight={16} color="rgba(243,239,232,0.55)">
            5:30–6:10pm · Pets
          </AppText>
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Card>
          <Row title="Event reminders" subtitle="A nudge when an event is about to start." icon="bell" iconColor={ACCENT} />
          <Row title="Check-ins" subtitle="A short check-in when you come back after a while, so your day stays accurate." icon="clockFace" iconColor={ACCENT} />
        </Card>
      </View>
    </>
  );
}

/* ---------- time zone picker ---------- */

function TimeZonePicker({
  visible,
  selected,
  detected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  detected: string;
  onSelect: (tz: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const kind = useFontKind();
  const zones = useMemo(() => listTimeZones(detected), [detected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    const base = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
    return base.slice(0, 300);
  }, [zones, query]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.pickerBackdrop}>
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.pickerHead}>
            <AppText size={17} weight={600} letterSpacing={-0.2} accessibilityRole="header">
              Time zone
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeCircle}>
              <Icon name="x" size={16} color="rgba(243,239,232,0.7)" />
            </Pressable>
          </View>
          <TextInput
            testID="tz-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search cities and regions"
            placeholderTextColor="rgba(243,239,232,0.34)"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.field, { marginHorizontal: 18, marginBottom: 8, ...asFontStyle(kind) }]}
          />
          <FlatList
            data={filtered}
            keyExtractor={(z) => z}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                testID={`tz-${item}`}
                onPress={() => onSelect(item)}
                style={({ pressed }) => [styles.tzItem, pressed && { backgroundColor: white(0.06) }]}
              >
                <View style={{ flex: 1 }}>
                  <AppText size={14.5} lineHeight={20}>
                    {cityName(item)}
                  </AppText>
                  <AppText size={11.5} lineHeight={16} color={ui.soft}>
                    {item.replace(/_/g, ' ')} · {zoneDetail(item)}
                  </AppText>
                </View>
                {item === selected ? <Icon name="check" size={18} color={ACCENT} /> : null}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.bg },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 4 },
  segments: { flex: 1, flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 3, borderRadius: 2 },
  content: { paddingHorizontal: 22, paddingBottom: 24 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 26 },
  field: {
    backgroundColor: ui.field,
    borderWidth: 1,
    borderColor: ui.fieldEdge,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    lineHeight: 22,
    color: ui.text,
  },
  tzField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 12,
    paddingLeft: 13,
    paddingRight: 14,
    borderRadius: 12,
    backgroundColor: ui.field,
    borderWidth: 1,
    borderColor: ui.fieldEdge,
  },
  detected: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(207,123,88,0.14)' },
  brandBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.07) },
  sample: {
    marginTop: 26,
    gap: 2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(58,56,54,0.85)',
    borderWidth: 1,
    borderColor: white(0.08),
    boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
  },
  pickerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,9,9,0.6)' },
  pickerSheet: {
    height: '78%',
    backgroundColor: ui.sheet,
    borderTopWidth: 1,
    borderColor: white(0.09),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  grabber: { width: 34, height: 4, borderRadius: 3, backgroundColor: white(0.16), alignSelf: 'center', marginBottom: 12 },
  pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10 },
  closeCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.08) },
  tzItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 10 },
});
