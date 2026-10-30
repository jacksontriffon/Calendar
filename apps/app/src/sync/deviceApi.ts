/**
 * The OS calendar behind `DeviceCalendarApi`. This file is the fallback used on web and by tooling:
 * there are no phone calendars there, so the bridge does nothing. Metro picks `deviceApi.native.ts`
 * (expo-calendar) on iOS and Android, which keeps expo-calendar out of the web bundle.
 */
import type { DeviceCalendarApi } from './deviceTypes';

export function createDeviceApi(): DeviceCalendarApi {
  const none = async (): Promise<never> => {
    throw new Error('Phone calendars are only available in the mobile app');
  };
  return {
    platform: 'web',
    supported: false,
    getPermission: async () => ({ status: 'undetermined', canAskAgain: false }),
    requestPermission: async () => ({ status: 'undetermined', canAskAgain: false }),
    getCalendars: async () => [],
    getEvents: async () => [],
    createEvent: none,
    updateEvent: none,
    deleteEvent: none,
  };
}
