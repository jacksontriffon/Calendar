/**
 * iOS / Android: the OS calendar through expo-calendar's procedural API (`expo-calendar/legacy`,
 * which is stable and has everything the bridge needs; the object API at the package root is the
 * newer one). Everything the rest of the bridge knows about expo-calendar is in this file.
 *
 * expo-calendar has no change notifications, so `onChange` is not provided: the bridge refreshes on
 * foreground, on a timer while the app is open, and after its own writes.
 */
import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import type {
  DeviceCalendarApi,
  DeviceEventWrite,
  DevicePermission,
  DevicePlatform,
  RawCalendar,
  RawEvent,
} from './deviceTypes';

const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

const toPermission = (r: { status: string; granted?: boolean; canAskAgain?: boolean }): DevicePermission => ({
  status: r.granted ? 'granted' : r.status === 'denied' ? 'denied' : 'undetermined',
  canAskAgain: r.canAskAgain !== false,
});

const toRawCalendar = (c: Calendar.Calendar): RawCalendar => ({
  id: c.id,
  title: c.title,
  color: c.color,
  // iOS: the source ("iCloud", "Gmail", "On My iPhone"). Android: the account that owns the calendar.
  account: (platform === 'android' ? c.ownerAccount || c.source?.name : c.source?.name) || '',
  allowsModifications: c.allowsModifications !== false,
  internalName: c.name ?? null,
});

const toRawEvent = (e: Calendar.Event): RawEvent => ({
  id: e.id,
  calendarId: e.calendarId,
  title: e.title,
  startDate: e.startDate,
  endDate: e.endDate,
  allDay: !!e.allDay,
  location: e.location ?? null,
  organizerIsCurrentUser: e.organizer ? e.organizer.isCurrentUser : undefined,
  organizerEmail: e.organizerEmail ?? null,
  notes: e.notes ?? null,
});

const toDetails = (d: DeviceEventWrite) => ({
  title: d.title,
  startDate: d.startDate,
  endDate: d.endDate,
  allDay: d.allDay,
  timeZone: d.timeZone,
  notes: d.notes,
});

export function createDeviceApi(): DeviceCalendarApi {
  return {
    platform,
    supported: platform !== 'web',
    async getPermission() {
      return toPermission(await Calendar.getCalendarPermissionsAsync());
    },
    async requestPermission() {
      return toPermission(await Calendar.requestCalendarPermissionsAsync());
    },
    async getCalendars() {
      const list = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      return list.map(toRawCalendar);
    },
    async getEvents(calendarIds, from, to) {
      if (!calendarIds.length) return [];
      const list = await Calendar.getEventsAsync(calendarIds, from, to);
      return list.map(toRawEvent);
    },
    async createEvent(calendarId, details) {
      return Calendar.createEventAsync(calendarId, toDetails(details));
    },
    async updateEvent(eventId, details) {
      await Calendar.updateEventAsync(eventId, toDetails(details));
    },
    async deleteEvent(eventId) {
      await Calendar.deleteEventAsync(eventId);
    },
  };
}
