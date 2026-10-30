/**
 * Delete account (OA 4.8-4.18). Six screens so nothing goes by accident:
 *   what      what gets deleted, with counts from the server
 *   type      type DELETE
 *   verify    sign in with the same provider once more (native only)
 *   final     last confirmation dialog
 *   deleting  `account-delete` runs; the back gesture is blocked
 *   error     nothing was removed: try again
 * On success the goodbye screen opens first, then the session is cleared
 * locally (the order matters: clearing it first would bounce to Welcome).
 */
import { ACCENT, white } from '@calendar/core';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, TextInput, View } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

import { ConfirmDialog } from './ConfirmDialog';
import { firstName, setGoodbyeInfo } from './goodbyeInfo';
import { Icon } from './icons';
import { PROVIDER_LABEL, signInErrorMessage } from './providers';
import { useSession } from './session';
import {
  AppText,
  Body,
  Button,
  Caption,
  Card,
  Footer,
  Hero,
  InlineError,
  Page,
  ProgressBar,
  Row,
  ScreenHeader,
  TextButton,
  Title,
  asFontStyle,
  ui,
  useFontKind,
} from './ui';

type Phase = 'what' | 'type' | 'verify' | 'final' | 'deleting' | 'error';

export const DELETE_WORD = 'DELETE';

/** Case-sensitive match of the confirmation word. */
export const isDeleteConfirmed = (typed: string): boolean => typed === DELETE_WORD;

interface Counts {
  events: number | null;
  goals: number | null;
  categories: number | null;
}

async function fetchCounts(): Promise<Counts> {
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    try {
      const { count: n, error } = await q;
      return error ? null : n;
    } catch {
      return null;
    }
  };
  const [events, goals, categories] = await Promise.all([
    count(supabase.from('events').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
    count(supabase.from('goals').select('id', { count: 'exact', head: true })),
    count(supabase.from('categories').select('id', { count: 'exact', head: true })),
  ]);
  return { events, goals, categories };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeleteAccountFlow() {
  const router = useRouter();
  const navigation = useNavigation();
  const kind = useFontKind();
  const { user, displayName, provider, signIn, signingIn, signOut } = useSession();

  const [phase, setPhase] = useState<Phase>('what');
  const [typed, setTyped] = useState('');
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failRef, setFailRef] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    void fetchCounts().then(setCounts);
  }, []);

  // Block back while deleting (iOS swipe, Android hardware back).
  const deleting = phase === 'deleting';
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !deleting });
    if (!deleting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [deleting, navigation]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const goBack = () => {
    if (phase === 'type') setPhase('what');
    else if (phase === 'verify') setPhase('type');
    else if (phase === 'final') setPhase('verify');
    else leave();
  };

  const afterTyping = () => {
    // Re-auth needs the native provider sheet or a browser session that returns
    // here. On web the OAuth redirect would drop this flow, so web goes straight
    // to the final confirmation (typing DELETE is the guard).
    setPhase(Platform.OS === 'web' || !provider ? 'final' : 'verify');
  };

  const reauth = async () => {
    if (!provider) return;
    setError(null);
    const result = await signIn(provider);
    if (!result.ok) {
      setError(signInErrorMessage(provider, result.reason));
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (data.user && user && data.user.id !== user.id) {
      setError('That’s a different account. Sign in with the account you’re deleting.');
      return;
    }
    setPhase('final');
  };

  const runDelete = useCallback(async () => {
    setPhase('deleting');
    setError(null);
    setFailRef(null);
    const { error: fnError } = await supabase.functions.invoke('account-delete');
    if (fnError) {
      let ref: string | null = null;
      try {
        const body = (await (fnError as { context?: Response }).context?.json()) as { ref?: string } | undefined;
        ref = body?.ref ?? null;
      } catch {
        ref = null;
      }
      setFailRef(ref);
      setPhase('error');
      return;
    }
    setDone(true);
    setGoodbyeInfo({ name: firstName(displayName) });
    // Goodbye first (it is reachable signed out), then clear the session.
    setTimeout(() => {
      router.replace('/goodbye');
      void signOut();
    }, 700);
  }, [displayName, router, signOut]);

  const contactSupport = () =>
    void Linking.openURL(
      `mailto:${env.supportEmail}?subject=${encodeURIComponent('Delete account problem')}${failRef ? `&body=${encodeURIComponent(`Reference: ${failRef}`)}` : ''}`,
    );

  if (phase === 'deleting' || done) {
    return (
      <Page>
        <View style={styles.center}>
          <Hero icon="trash" tone="danger" />
          <Title size={24} align="center">
            Deleting your account…
          </Title>
          <Body align="center" style={{ marginTop: 8 }}>
            Don’t close the app. This takes a few seconds.
          </Body>
          <View style={{ marginTop: 28 }}>
            <ProgressBar value={done ? 100 : undefined} />
          </View>
          <View style={{ marginTop: 22 }}>
            <Card>
              <StepRow label="Events and goals" state={done ? 'done' : 'active'} />
              <StepRow label="Google access" state={done ? 'done' : 'active'} />
              <StepRow label="Your account" state={done ? 'done' : 'pending'} />
            </Card>
          </View>
        </View>
      </Page>
    );
  }

  if (phase === 'error') {
    return (
      <Page>
        <View style={styles.center}>
          <Hero icon="warning" tone="danger" />
          <Title size={24} align="center">
            Couldn’t delete your account
          </Title>
          <Body align="center" style={{ marginTop: 8 }}>
            Nothing was removed. Check your connection and try again.
          </Body>
          {failRef ? (
            <Caption align="center" style={{ marginTop: 14 }}>
              DEL-2 · ref {failRef}
            </Caption>
          ) : null}
        </View>
        <Footer>
          <Button label="Try again" testID="delete-retry" onPress={() => void runDelete()} />
          <Button label="Contact support" variant="ghost" onPress={contactSupport} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label="Back to account" onPress={leave} />
          </View>
        </Footer>
      </Page>
    );
  }

  return (
    <Page>
      <ScreenHeader onBack={goBack} />
      {phase === 'what' ? (
        <>
          <View style={styles.body}>
            <View style={{ marginTop: 8 }}>
              <Title>Delete your account?</Title>
            </View>
            <Body style={{ marginTop: 8 }}>This permanently deletes everything below. It can’t be undone.</Body>
            <AppText size={10.5} letterSpacing={1.1} color={ui.faint} style={{ marginTop: 22, marginBottom: 10, textTransform: 'uppercase' }}>
              What gets deleted
            </AppText>
            <Card>
              <Row
                title={counts?.events != null ? plural(counts.events, 'event', 'events') : 'Your events'}
                subtitle="Everything on your calendar, on every device."
                icon="calendar"
                iconBg="rgba(255,107,94,0.1)"
                iconColor={ui.destructive}
              />
              <Row
                title={
                  counts?.goals != null && counts.categories != null
                    ? `${plural(counts.goals, 'goal', 'goals')} and ${plural(counts.categories, 'category', 'categories')}`
                    : 'Your goals and categories'
                }
                subtitle="Plus your name and settings."
                icon="tag"
                iconBg="rgba(255,107,94,0.1)"
                iconColor={ui.destructive}
              />
              <Row
                title="Your Google accounts"
                subtitle="Access is revoked. Events in Google stay put."
                icon="link"
                iconBg="rgba(255,107,94,0.1)"
                iconColor={ui.destructive}
              />
            </Card>
            <Caption style={{ marginTop: 12 }}>Nothing in your Google or phone calendars is deleted.</Caption>
          </View>
          <Footer>
            <Button label="Keep my account" variant="light" testID="delete-keep" onPress={leave} />
            <View style={{ alignItems: 'center' }}>
              <TextButton label="Continue" testID="delete-continue" color={ui.destructive} onPress={() => setPhase('type')} />
            </View>
          </Footer>
        </>
      ) : phase === 'type' ? (
        <>
          <View style={styles.body}>
            <View style={{ marginTop: 8 }}>
              <Title>Type DELETE to confirm</Title>
            </View>
            <Body style={{ marginTop: 8 }}>
              Then we’ll ask you to confirm it’s you. Your account is <AppText size={14.5} weight={600} color={ui.text}>{displayName ?? 'this account'}</AppText>.
            </Body>
            <TextInput
              testID="delete-input"
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              placeholder="DEL"
              placeholderTextColor="rgba(243,239,232,0.34)"
              style={[styles.input, asFontStyle(kind, 600)]}
            />
            <Caption style={{ marginTop: 8 }}>{isDeleteConfirmed(typed) ? 'That’s it.' : 'Capital letters only.'}</Caption>
          </View>
          <Footer>
            <Button label="Continue" testID="delete-type-continue" variant="danger" disabled={!isDeleteConfirmed(typed)} onPress={afterTyping} />
          </Footer>
        </>
      ) : phase === 'verify' ? (
        <>
          <View style={styles.body}>
            <View style={{ marginTop: 8 }}>
              <Title>Confirm it’s you</Title>
            </View>
            <Body style={{ marginTop: 8 }}>
              {provider === 'apple'
                ? 'Sign in with Apple once more. Apple needs a fresh sign-in to revoke access.'
                : 'Sign in with Google once more. Google needs a fresh sign-in to revoke Calendar access.'}
            </Body>
            {error ? (
              <View style={{ marginTop: 16 }}>
                <InlineError>{error}</InlineError>
              </View>
            ) : null}
          </View>
          <Footer>
            <Button
              label={`Continue with ${provider ? PROVIDER_LABEL[provider] : 'provider'}`}
              testID="delete-reauth"
              variant="light"
              loading={signingIn !== null}
              onPress={() => void reauth()}
            />
            <View style={{ alignItems: 'center' }}>
              <TextButton label="Cancel" onPress={leave} />
            </View>
          </Footer>
        </>
      ) : (
        <>
          <View style={styles.body}>
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={18} color={ACCENT} />
              <AppText size={13} color={ACCENT}>
                Verified
              </AppText>
            </View>
            <View style={{ marginTop: 10 }}>
              <Title>One last look</Title>
            </View>
            <Body style={{ marginTop: 8 }}>One last look before we delete anything.</Body>
          </View>
          <Footer>
            <Button label="Delete my account" testID="delete-final" variant="danger" onPress={() => setConfirmOpen(true)} />
            <View style={{ alignItems: 'center' }}>
              <TextButton label="Cancel" onPress={leave} />
            </View>
          </Footer>
        </>
      )}

      <ConfirmDialog
        visible={confirmOpen && phase === 'final'}
        title="Delete account permanently?"
        message="Your events, goals and categories will be deleted now. This can’t be undone."
        confirmLabel="Delete"
        destructive
        onCancel={() => {
          setConfirmOpen(false);
          leave();
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void runDelete();
        }}
      />
    </Page>
  );
}

function StepRow({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <View style={styles.stepRow}>
      {state === 'done' ? (
        <View style={styles.stepDone}>
          <Icon name="check" size={13} color={ui.onAccent} strokeWidth={2.6} />
        </View>
      ) : state === 'active' ? (
        <ActivityIndicator size="small" color={ACCENT} style={{ width: 22, height: 22 }} />
      ) : (
        <View style={styles.stepPending} />
      )}
      <AppText size={14.5} color={state === 'pending' ? 'rgba(243,239,232,0.4)' : ui.text} style={{ flex: 1 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  body: { flex: 1, paddingHorizontal: 22 },
  input: {
    marginTop: 26,
    backgroundColor: ui.field,
    borderWidth: 1,
    borderColor: ui.fieldEdge,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 18,
    letterSpacing: 2,
    color: ui.text,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12 },
  stepDone: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT },
  stepPending: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: white(0.14) },
});
