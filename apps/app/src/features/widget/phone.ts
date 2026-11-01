/**
 * Phone-calendar events for the widget. Pure: turns the device bridge's state into the extra rows the
 * snapshot builder takes. Nothing here reaches the network; the events go only into the on-device
 * widget snapshot (the "phone events are never uploaded" rule still holds).
 */
import { deviceCats, toProtoEvent } from '@/sync/deviceMap';
import type { DeviceState } from '@/sync/deviceTypes';

import type { PhoneEvents } from './snapshot';

/** The events of the phone calendars switched on under "Show in app", or null when there are none to show. */
export function phoneEventsOf(state: Pick<DeviceState, 'available' | 'events' | 'calendars'>): PhoneEvents | null {
  if (!state.available || !state.events.length) return null;
  return { events: state.events.map(toProtoEvent), cats: deviceCats(state.calendars) };
}
