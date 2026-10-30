import { Stack, useLocalSearchParams } from 'expo-router';

import { EventSheet } from '@/features/event-sheet/EventSheet';

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      {/* a bottom sheet over the calendar: transparent modal, the sheet draws its own backdrop */}
      <Stack.Screen
        options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
      />
      <EventSheet id={String(id)} />
    </>
  );
}
