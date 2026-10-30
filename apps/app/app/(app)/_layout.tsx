import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

// Signed-in shell. TODO(phase 3): global states (offline pill, sync-conflict
// toast, session-expired sheet) and the composer mount here.
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
