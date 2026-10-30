/**
 * Saving the picker's choice. The event's `visibility` goes through the store (the event sheet's draft);
 * this saves the targets: the Google ones through the `set_event_google_targets` RPC (with retry while
 * the event reaches the server, see CalendarsStore.setEventGoogleTargets), the phone ones through the
 * phone-calendar bridge's optional `setDeviceTargets`.
 */
import { setDeviceTargets } from '../calendars/device';
import { getCalendarsStore } from '../calendars/data';
import { isUuid } from '@/sync/mapping';
import { planPersist, targetsRpcArgs } from './payload';
import type { PickerState } from './state';

export interface PersistArgs {
  eventId: string;
  before: PickerState;
  after: PickerState;
  isSeries: boolean;
  /** the later events of the same series (the phone bridge takes one event at a time) */
  seriesEventIds?: string[];
}

/** Fire-and-forget: failures show up as "Failed · Retry" on the target. */
export function persistChoice(args: PersistArgs): void {
  // ids that are not uuids belong to events the server has never seen (local aliases, dev data)
  if (!isUuid(args.eventId)) return;
  const plan = planPersist(args);
  if (plan.google) void getCalendarsStore().setEventGoogleTargets(plan.google);
  if (plan.device) {
    // the bridge reports its own failures as target statuses
    const ids = [plan.device.eventId, ...(plan.device.applyToSeries ? args.seriesEventIds ?? [] : [])];
    ids.forEach((id) => void Promise.resolve(setDeviceTargets(id, plan.device!.keys)).catch(() => undefined));
  }
}

/** Retry the Google targets of an event that failed: the same call again with the saved list. */
export function retryGoogleTargets(eventId: string, savedGoogle: readonly string[], isSeries: boolean): void {
  if (!isUuid(eventId)) return;
  void getCalendarsStore().setEventGoogleTargets(targetsRpcArgs(eventId, savedGoogle, isSeries));
}

/**
 * For code that creates events (the composer, phase 4): a new event in a category that defaults to
 * Public starts Public on the category's targets. Call it with the new event's id after the event is
 * committed; it returns the visibility to put on the event.
 */
export function applyCategoryDefaults(eventId: string, categoryName: string | null | undefined, isSeries = false): 'private' | 'public' {
  const d = categoryName ? getCalendarsStore().getState().categories[categoryName] : undefined;
  if (!d || d.visibility !== 'public' || !d.targets.length) return 'private';
  if (isUuid(eventId)) void getCalendarsStore().setEventGoogleTargets(targetsRpcArgs(eventId, d.targets, isSeries));
  return 'public';
}
