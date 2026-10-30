import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { getGoodbyeInfo } from './goodbyeInfo';
import { Icon } from './icons';
import { AppText, Body, Button, Caption, Card, Footer, Hero, Page, Title, ui } from './ui';

/** OA 4.16: the account is gone and the session is already cleared. Done returns to Welcome. */
export function GoodbyeScreen() {
  const router = useRouter();
  const { name } = getGoodbyeInfo();
  return (
    <Page>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 22 }} testID="goodbye-screen">
        <Hero icon="check" tone="solid" />
        <Title size={24} align="center">
          Your account is deleted
        </Title>
        <Body align="center" style={{ marginTop: 8 }}>
          {name ? `Goodbye, ${name}.` : 'Goodbye.'}
        </Body>
        <View style={{ marginTop: 26 }}>
          <Card>
            {['Events, goals and categories deleted', 'Google access revoked'].map((label) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, paddingVertical: 12 }}>
                <Icon name="check" size={18} color={ui.accent} />
                <AppText size={13.5}>{label}</AppText>
              </View>
            ))}
          </Card>
        </View>
        <Caption align="center" style={{ marginTop: 14 }}>
          You can start again any time with an empty calendar.
        </Caption>
      </View>
      <Footer>
        <Button label="Done" variant="light" testID="goodbye-done" onPress={() => router.replace('/welcome')} />
      </Footer>
    </Page>
  );
}
