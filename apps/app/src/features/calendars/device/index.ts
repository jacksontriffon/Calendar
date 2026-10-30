// STUB: replaced by phone-calendar agent
//
// The visibility picker and Calendars settings are coded against this interface. The real module
// (phone-calendar bridge, phase 6) replaces this file at merge and must keep these exports.
//
//   useDeviceCalendars()          the phone's calendars. `available` is false on web (and until the
//                                 permission is granted); `key` is the opaque id that is also stored in
//                                 event_targets.device_calendar_key and hidden_items.external_key.
//   useDeviceTargetStatus(id)     the status of each phone-calendar target of an event.
//   setDeviceTargets (optional)   OPTIONAL extension, called by the picker when it persists a choice:
//                                 `setDeviceTargets(eventId, calendarKeys, applyToSeries)`. `calendarKeys`
//                                 is the full set of phone calendars the event should be published to
//                                 ([] when the event was made private). Publishing is the device agent's
//                                 job; if this export is missing the picker simply doesn't write device
//                                 targets. Hidden-event handling for phone events is also theirs.

export type DeviceTargetStatusValue = 'pending' | 'synced' | 'failed' | 'queued';

export interface DeviceCalendar {
  key: string;
  name: string;
  color: string;
  account: string;
  showInApp: boolean;
  canPublish: boolean;
}

const NONE = { available: false, calendars: [] as DeviceCalendar[] };
const NO_STATUS: { key: string; status: DeviceTargetStatusValue }[] = [];

export function useDeviceCalendars(): { available: boolean; calendars: DeviceCalendar[] } {
  return NONE;
}

export function useDeviceTargetStatus(_eventId: string): { key: string; status: DeviceTargetStatusValue }[] {
  return NO_STATUS;
}

/** Optional (see above). `undefined` here: the picker skips device targets. */
export const setDeviceTargets: ((eventId: string, calendarKeys: string[], applyToSeries: boolean) => void | Promise<void>) | undefined = undefined;
