import { white } from '@calendar/core';
import { useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnline } from '@/lib/useOnline';

import { Icon } from './icons';
import { ProviderButton } from './ProviderButton';
import { orderWithLastUsed, providerOrder, signInErrorMessage } from './providers';
import { useSession } from './session';
import { AppText, InlineError, OfflinePill, ui } from './ui';

/**
 * Re-sign-in sheet (OA 5.5 / 5.6), shown over whatever the user was doing
 * when a session expires. No "Not now" and no close: Back doesn't dismiss it,
 * the app needs a session. Local edits keep queuing underneath. The
 * last-used provider comes first.
 *
 * Mounted once in the root layout. Other screens trigger it with
 * `useSessionExpired().report()`.
 */
export function SessionExpiredSheet({ pendingChanges = 0 }: { pendingChanges?: number }) {
  const { status, lastProvider, provider, signingIn, signIn } = useSession();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);

  const open = status === 'expired';
  const order = orderWithLastUsed(provider ?? lastProvider, providerOrder(Platform.OS));

  const run = async (p: (typeof order)[number]) => {
    setError(null);
    const result = await signIn(p);
    if (!result.ok) setError(signInErrorMessage(p, result.reason));
  };

  return (
    <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 14, 28) }]}
          testID="session-expired-sheet"
        >
          <View style={styles.grabber} />
          <View style={styles.icon}>
            <Icon name="logOut" size={26} color="rgba(243,239,232,0.75)" />
          </View>
          <AppText size={19} lineHeight={24} weight={600} letterSpacing={-0.3} style={{ marginTop: 16 }} accessibilityRole="header">
            You’ve been signed out
          </AppText>
          <AppText size={14} lineHeight={20} color={ui.muted} align="center" style={{ marginTop: 8, maxWidth: 310 }}>
            Your session expired. Sign in again to keep syncing. Everything you changed is saved on this phone.
          </AppText>
          {pendingChanges > 0 ? (
            <View style={styles.pending}>
              <Icon name="refresh" size={13} color="rgba(243,239,232,0.7)" />
              <AppText size={12} color="rgba(243,239,232,0.7)">
                {pendingChanges} {pendingChanges === 1 ? 'change' : 'changes'} waiting to sync
              </AppText>
            </View>
          ) : null}
          <View style={styles.buttons}>
            {!online ? <OfflinePill /> : null}
            {error ? <InlineError>{error}</InlineError> : null}
            {order.map((p) => (
              <ProviderButton
                key={p}
                provider={p}
                testID={`expired-${p}`}
                busy={signingIn === p}
                disabled={!online || (signingIn !== null && signingIn !== p)}
                onPress={() => void run(p)}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,9,9,0.6)' },
  sheet: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 22,
    backgroundColor: ui.sheet,
    borderTopWidth: 1,
    borderColor: white(0.09),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  grabber: { width: 34, height: 4, borderRadius: 3, backgroundColor: white(0.16), marginBottom: 22 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: white(0.07) },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: white(0.06),
  },
  buttons: { width: '100%', gap: 10, marginTop: 22 },
});
