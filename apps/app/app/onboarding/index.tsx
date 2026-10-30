import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/features/auth/session';
import { AppText, Body, Button, Page, TextButton, Title, ui } from '@/features/auth/ui';
import { decideEntryStage } from '@/features/onboarding/entry';
import { SetupFlow } from '@/features/onboarding/SetupFlow';

/**
 * Signed in, but not in the calendar yet: waiting for the profile (loading),
 * unable to load it (error), or on first-run setup (OA 2).
 */
export default function Onboarding() {
  const { status, profile, profileState, reloadProfile, signOut } = useSession();
  const stage = decideEntryStage({ status, profileState, profile });

  if (stage === 'onboarding') return <SetupFlow />;

  if (stage === 'error') {
    return (
      <Page>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 22, gap: 8 }}>
          <Title size={24} align="center">
            Couldn’t load your account
          </Title>
          <Body align="center">Check your connection and try again.</Body>
          <View style={{ marginTop: 20, gap: 10 }}>
            <Button label="Try again" testID="entry-retry" onPress={() => void reloadProfile()} />
            <View style={{ alignItems: 'center' }}>
              <TextButton label="Sign out" onPress={() => void signOut()} />
            </View>
          </View>
        </View>
      </Page>
    );
  }

  return (
    <Page>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={ui.accent} />
        <AppText size={12} color={ui.faint} style={{ marginTop: 12 }}>
          Signing you in…
        </AppText>
      </View>
    </Page>
  );
}
