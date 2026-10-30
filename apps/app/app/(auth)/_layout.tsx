import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

// Signed-out routes. The root layout only mounts this group while there is no session.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.background } }} />;
}
