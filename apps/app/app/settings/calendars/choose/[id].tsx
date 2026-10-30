import { useLocalSearchParams } from 'expo-router';

import { ChooseCalendarsScreen } from '@/features/calendars/ChooseCalendarsScreen';

export default function ChooseCalendarsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChooseCalendarsScreen id={String(id)} />;
}
