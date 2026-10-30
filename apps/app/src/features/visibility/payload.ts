/**
 * What to send when the picker's choice is saved.
 *
 * Google targets: the client can't write `google` event_targets rows (RLS), so the
 * choice goes through `rpc('set_event_google_targets', { p_event_id, p_calendar_ids,
 * p_apply_to_series })`. It makes `p_calendar_ids` the set the event is published to;
 * calling it again with the same list is "Retry".
 *
 * The event's own `visibility` is saved with the event (the store); a trigger queues
 * the publish job, and google-sync deletes the Google copy of an event that is
 * Private. So Private needs no Google call.
 *
 * Phone targets: handed to the phone-calendar bridge (`setDeviceTargets`), which owns
 * its own targets. A private event is passed `[]` so the bridge can remove its copies.
 */
import type { Visibility } from '@calendar/core';

import { sameIds, type PickerState } from './state';

export interface TargetsRpcArgs {
  p_event_id: string;
  p_calendar_ids: string[];
  p_apply_to_series: boolean;
}

export const targetsRpcArgs = (eventId: string, calendarIds: readonly string[], applyToSeries: boolean): TargetsRpcArgs => ({
  p_event_id: eventId,
  p_calendar_ids: Array.from(new Set(calendarIds)).sort(),
  p_apply_to_series: applyToSeries,
});

export interface PersistPlan {
  /** arguments for the RPC, or null when the Google targets don't need to change */
  google: TargetsRpcArgs | null;
  /** for `setDeviceTargets(eventId, keys, applyToSeries)`, or null */
  device: { eventId: string; keys: string[]; applyToSeries: boolean } | null;
}

/**
 * Which calls a change from `before` to `after` needs. `isSeries`: the event repeats, so the
 * change covers this and all future events (EV 03: never a scope question).
 */
export function planPersist(args: { eventId: string; before: PickerState; after: PickerState; isSeries: boolean }): PersistPlan {
  const { eventId, before, after, isSeries } = args;
  const plan: PersistPlan = { google: null, device: null };
  const nowPublic = after.visibility === 'public';
  const becamePublic = nowPublic && before.visibility !== 'public';

  if (nowPublic) {
    const googleChanged = becamePublic || !sameIds(before.google, after.google);
    if (googleChanged && (after.google.length > 0 || before.google.length > 0)) {
      plan.google = targetsRpcArgs(eventId, after.google, isSeries);
    }
    const deviceChanged = becamePublic || !sameIds(before.device, after.device);
    if (deviceChanged && (after.device.length > 0 || before.device.length > 0)) {
      plan.device = { eventId, keys: [...after.device], applyToSeries: isSeries };
    }
  } else if (before.visibility === 'public' && before.device.length > 0) {
    plan.device = { eventId, keys: [], applyToSeries: isSeries };
  }
  return plan;
}

/** Calendar names a series would leave when made Private (EV 3.3 confirmation). */
export function leavesMessage(title: string, names: readonly string[]): string {
  if (!names.length) return '';
  const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const from = names.length === 1 ? 'there' : names.length === 2 ? 'both' : 'all';
  return title + ' is public on ' + list + '. Making it private removes it from ' + from + ', for this and all future events.';
}

export type { Visibility };
