import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from '@/theme/tokens';

// TODO(phase 2): load fonts with expo-font (Serif / Sans / Mono) and hold the
// splash screen until they and the Supabase session are ready.

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
  // TODO(phase 2): gate on the Supabase session. Signed out -> (auth)/welcome,
  // signed in -> (app). Use <Stack.Protected guard={...}> once auth lands.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={theme}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="(auth)/welcome" />
            <Stack.Screen name="(app)" />
            {/* TODO(phase 3): the event sheet may become a bottom sheet instead of a modal route. */}
            <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="goal/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="settings/index" />
          </Stack>
        </BottomSheetModalProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
