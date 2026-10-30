/**
 * Settings > Account (OA 4.2-4.7): avatar, name, email, sign-in provider,
 * sync status, Sign out and Delete account.
 */
import { white } from '@calendar/core';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useSyncStatus } from '@/store';
import { useOnline } from '@/lib/useOnline';
import { useRouteExists } from '@/lib/useRouteExists';

import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { AppleMark, GoogleMark, Icon } from './icons';
import { isRelayEmail, useSession } from './session';
import {
  AppText,
  Button,
  Caption,
  Card,
  Eyebrow,
  InlineError,
  Page,
  Row,
  ScreenHeader,
  SmallButton,
  asFontStyle,
  ui,
  useFontKind,
} from './ui';

const SYNC_COPY = {
  idle: { title: 'Synced', subtitle: 'Up to date on this phone' },
  syncing: { title: 'Syncing…', subtitle: 'Sending your latest changes' },
  offline: { title: 'Offline', subtitle: 'Changes will sync when you’re back online' },
  error: { title: 'Sync problem', subtitle: 'Some changes haven’t synced yet' },
} as const;

export function AccountScreen() {
  const router = useRouter();
  const routeExists = useRouteExists();
  const { email, provider, displayName, signOut, saveProfile } = useSession();
  const sync = useSyncStatus();
  const online = useOnline();
  const kind = useFontKind();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(false);

  const unsynced = sync === 'offline' || sync === 'error';
  const relay = isRelayEmail(email);
  const name = displayName ?? email ?? 'Your account';
  const version = Constants.expoConfig?.version;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const onSignOut = () => {
    // One tap when everything is synced; a warning when it isn't (OA 4.6).
    if (unsynced) setConfirmSignOut(true);
    else void signOut();
  };

  const saveName = async () => {
    setSaving(true);
    setEditError(false);
    try {
      await saveProfile({ display_name: draft.trim() || null });
      setEditing(false);
    } catch {
      setEditError(true);
    } finally {
      setSaving(false);
    }
  };

  const syncCopy = SYNC_COPY[sync];

  return (
    <Page>
      <ScreenHeader title="Account" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content} testID="account-screen">
        <View style={{ alignItems: 'center', paddingTop: 6 }}>
          <Avatar name={name} size={76} testID="account-avatar" />
          <AppText size={22} lineHeight={26} weight={600} letterSpacing={-0.4} color={ui.heading} style={{ marginTop: 12 }} testID="account-name">
            {name}
          </AppText>
          {email ? (
            <AppText size={12.5} color="rgba(243,239,232,0.5)" align="center" style={{ marginTop: 3, maxWidth: 300 }} testID="account-email">
              {email}
            </AppText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="account-edit-name"
            onPress={() => {
              setDraft(displayName ?? '');
              setEditError(false);
              setEditing(true);
            }}
            style={({ pressed }) => [styles.editName, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppText size={12} color="rgba(243,239,232,0.55)">
              Edit name
            </AppText>
          </Pressable>
        </View>

        <Eyebrow style={{ marginTop: 26 }}>Sign-in</Eyebrow>
        <View style={{ marginTop: 9 }}>
          <Card>
            <Row
              title={provider === 'apple' ? 'Signed in with Apple' : provider === 'google' ? 'Signed in with Google' : 'Signed in'}
              subtitle={relay ? 'Email hidden by Apple' : (email ?? undefined)}
              leading={
                <View style={[styles.brandBox, provider === 'apple' && { backgroundColor: '#fff' }]}>
                  {provider === 'apple' ? <AppleMark size={15} color="#000" /> : <GoogleMark size={17} />}
                </View>
              }
            />
            <Row
              title={syncCopy.title}
              subtitle={syncCopy.subtitle}
              icon={sync === 'offline' ? 'cloudOff' : 'refresh'}
              // TODO(phase 3): a "Sync now" button once the sync layer exposes `syncNow()`.
            />
          </Card>
        </View>

        {routeExists('/settings/calendars') ? (
          <>
            <Eyebrow style={{ marginTop: 20 }}>Calendars</Eyebrow>
            <View style={{ marginTop: 9 }}>
              <Card>
                <Row
                  title="Connected accounts"
                  icon="link"
                  right={<Icon name="chevronRight" size={14} color={white(0.4)} />}
                  onPress={() => router.push('/settings/calendars' as never)}
                />
              </Card>
            </View>
          </>
        ) : null}

        <View style={{ marginTop: 26 }}>
          <Button label="Sign out" variant="ghost" testID="account-sign-out" onPress={onSignOut} />
        </View>

        <View style={{ alignItems: 'center', gap: 3, paddingTop: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !online }}
            testID="account-delete"
            disabled={!online}
            onPress={() => router.push('/settings/account-delete' as never)}
            style={{ opacity: online ? 1 : 0.4, paddingVertical: 4 }}
          >
            <AppText size={14.5} weight={500} color={ui.destructive}>
              Delete account
            </AppText>
          </Pressable>
          <Caption>{online ? 'Permanently deletes your calendar and account.' : 'Needs a connection.'}</Caption>
        </View>

        {version ? (
          <AppText size={11} color="rgba(243,239,232,0.28)" align="center" style={{ paddingTop: 18 }}>
            Calendar {version}
          </AppText>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={confirmSignOut}
        title={`Sign out of ${name}?`}
        message="Changes that haven’t synced yet will be lost. Everything else stays in your account."
        confirmLabel="Sign out anyway"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)} statusBarTranslucent>
        <View style={styles.editBackdrop}>
          <View style={styles.editSheet}>
            <AppText size={17} weight={600} accessibilityRole="header">
              Edit name
            </AppText>
            <TextInput
              testID="account-name-input"
              value={draft}
              onChangeText={setDraft}
              autoFocus
              autoCapitalize="words"
              placeholder="Your name"
              placeholderTextColor="rgba(243,239,232,0.34)"
              style={[styles.input, asFontStyle(kind)]}
              onSubmitEditing={() => void saveName()}
            />
            {editError ? <InlineError>Couldn’t save that. Try again.</InlineError> : null}
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <SmallButton label="Cancel" onPress={() => setEditing(false)} />
              <SmallButton label={saving ? 'Saving…' : 'Save'} testID="account-name-save" disabled={saving} onPress={() => void saveName()} />
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingBottom: 24 },
  editName: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: white(0.06) },
  brandBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.07) },
  editBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(10,9,9,0.6)' },
  editSheet: { width: '100%', maxWidth: 360, gap: 14, padding: 18, borderRadius: 18, backgroundColor: ui.sheet, borderWidth: 1, borderColor: white(0.09) },
  input: {
    backgroundColor: ui.field,
    borderWidth: 1,
    borderColor: ui.fieldEdge,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: ui.text,
  },
});
