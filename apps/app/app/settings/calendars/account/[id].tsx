import { useLocalSearchParams } from 'expo-router';

import { AccountScreen } from '@/features/calendars/AccountScreen';

export default function GoogleAccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AccountScreen id={String(id)} />;
}
