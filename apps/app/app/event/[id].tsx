import { Stack, useLocalSearchParams } from 'expo-router';

import { DeviceEventSheet } from '@/features/calendars/device/DeviceEventSheet';
import { isDeviceEventId } from '@/features/calendars/device';
import { EventSheet } from '@/features/event-sheet/EventSheet';

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      {/* a bottom sheet over the calendar: transparent modal, the sheet draws its own backdrop */}
      <Stack.Screen
        options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }}
      />
      {/* phone-calendar events (`dev_…`) are not in the store: their own read-only sheet */}
      {isDeviceEventId(String(id)) ? <DeviceEventSheet id={String(id)} /> : <EventSheet id={String(id)} />}
    </>
  );
}
