import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionExpiredSheet } from '@/features/auth/SessionExpiredSheet';
import { SessionProvider, useSession, useSessionExpired } from '@/features/auth/session';
import { decideEntryStage } from '@/features/onboarding/entry';
import { WidgetSync } from '@/features/widget';
import { useAppFonts } from '@/lib/fonts';
import { useSessionExpired as useSyncSessionExpired } from '@/store';
import { SyncProvider, useSyncLoading } from '@/sync';
import { colors } from '@/theme/tokens';

// Hold the splash until fonts and the stored session are read.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    primary: colors.accent,
    border: colors.hairline,
  },
};

export default function RootLayout() {
  const fontsReady = useAppFonts();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <BottomSheetModalProvider>
            <StatusBar style="light" />
            <SessionProvider>
              <SyncProvider>
                <SyncExpiryBridge />
                <WidgetSync />
                <Gate fontsReady={fontsReady} />
                <SessionExpiredSheet />
              </SyncProvider>
            </SessionProvider>
          </BottomSheetModalProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** The sync layer also notices expiry (a 401 mid-sync); show the same re-sign-in sheet. */
function SyncExpiryBridge() {
  const syncExpired = useSyncSessionExpired();
  const { expired, report } = useSessionExpired();
  useEffect(() => {
    if (syncExpired && !expired) report();
  }, [syncExpired, expired, report]);
  return null;
}

/**
 * Auth gating. Which routes exist depends on where the user is:
 *
 *   signed out            (auth)/welcome, goodbye
 *   signed in, import     import          (OA 3, silent unless there is an old web calendar)
 *   signed in, setup      onboarding      (OA 2)
 *   signed in, ready      the calendar and everything under it
 *
 * `Stack.Protected` removes a screen the user may not see and redirects away
 * if they are on it, so signing in or out moves them without any imperative
 * navigation. A session that expires mid-use stays on the calendar (status
 * `expired`) with the re-sign-in sheet over it.
 *
 * Routes not listed here (new settings screens, say) are not guarded by this
 * file; list them under the "ready" group when they land.
 */
function Gate({ fontsReady }: { fontsReady: boolean }) {
  const { status, profile, profileState } = useSession();
  const stage = decideEntryStage({ status, profileState, profile });

  // Also wait for the local cache, so the calendar never flashes empty.
  const syncLoading = useSyncLoading();
  const ready = fontsReady && status !== 'loading' && !syncLoading;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return null;

  const signedIn = status === 'signedIn' || status === 'expired';
  const inApp = signedIn && stage === 'app';

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && stage === 'import'}>
        <Stack.Screen name="import" options={{ animation: 'fade' }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && (stage === 'loading' || stage === 'error' || stage === 'onboarding')}>
        <Stack.Screen name="onboarding/index" options={{ animation: 'fade' }} />
      </Stack.Protected>

      <Stack.Protected guard={inApp}>
        <Stack.Screen name="(app)" />
        {/* TODO(phase 3): the event sheet may become a bottom sheet instead of a modal route. */}
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="goal/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/account" />
        <Stack.Screen name="settings/account-delete" />
      </Stack.Protected>

      {/* Reachable signed in or out: the session is cleared right after navigating here. */}
      <Stack.Screen name="goodbye" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
