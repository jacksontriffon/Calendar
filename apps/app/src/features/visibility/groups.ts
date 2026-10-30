/**
 * The picker's list (EV 02): one group per source, each calendar with the status of its target.
 * Pure: the hook in ./useVisibility.ts feeds it the store's rows.
 */
import type { EventTarget } from '@calendar/db';

import { calendarColor, calendarSubtitle, publishableCalendars, type AccountView } from '../calendars/view';
import type { DeviceCalendar, DeviceTargetStatusValue } from '../calendars/device';
import { failureReason, targetUiStatus, type LocalOp, type UiStatus } from './status';
import { initPicker, type PickerState } from './state';
import type { Visibility } from '@calendar/core';

export interface PickOption {
  /** `google_calendars.id`, or the device calendar key */
  id: string;
  name: string;
  subtitle: string;
  color: string;
  /** null until the event has been saved to this calendar */
  status: UiStatus | null;
  /** "Google didn't respond", for a failed status */
  failure: string | null;
}

export interface PickGroup {
  source: 'google' | 'device';
  key: string;
  /** "sam.rivera@gmail.com", or empty for the phone */
  label: string;
  /** Google account id (for Manage) */
  accountId?: string;
  options: PickOption[];
}

export interface GroupInputs {
  views: readonly AccountView[];
  targets: readonly EventTarget[];
  device: { calendars: readonly DeviceCalendar[]; statuses: ReadonlyArray<{ key: string; status: DeviceTargetStatusValue }> };
  offline: boolean;
  /** the client's own work on the Google targets of this event */
  op: { state: Exclude<LocalOp, null | undefined>; calendarIds: readonly string[]; error?: string } | null | undefined;
}

export function buildGroups(inp: GroupInputs): PickGroup[] {
  const { views, targets, device, offline, op } = inp;
  const groups: PickGroup[] = [];
  publishableCalendars(views).forEach(({ account, calendars }) => {
    groups.push({
      source: 'google',
      key: 'google:' + account.id,
      label: account.email,
      accountId: account.id,
      options: calendars.map((c) => {
        const row = targets.find((t) => t.kind === 'google' && t.google_calendar_id === c.id) ?? null;
        const opHere = op && op.calendarIds.includes(c.id) ? op.state : null;
        const status = targetUiStatus(row, { offline, localOp: opHere });
        const failureText = status === 'failed' ? failureReason(opHere === 'failed' ? op?.error : row?.error) : null;
        return { id: c.id, name: c.name, subtitle: calendarSubtitle(c), color: calendarColor(c), status, failure: failureText };
      }),
    });
  });
  const phone = device.calendars.filter((c) => c.canPublish);
  if (phone.length) {
    groups.push({
      source: 'device',
      key: 'device',
      label: '',
      options: phone.map((c) => {
        const row = device.statuses.find((s) => s.key === c.key);
        return {
          id: c.key,
          name: c.name,
          subtitle: c.account,
          color: c.color,
          status: row ? targetUiStatus({ status: row.status }, { offline }) : null,
          failure: row?.status === 'failed' ? failureReason(null) : null,
        };
      }),
    });
  }
  return groups;
}

/** What the event is saved as: its visibility and the calendars its target rows name (never those queued for removal). */
export function savedChoice(visibility: Visibility, targets: readonly EventTarget[], deviceStatuses: ReadonlyArray<{ key: string }>): PickerState {
  const live = targets.filter((t) => !t.remove_requested);
  return initPicker({
    visibility,
    google: live.filter((t) => t.kind === 'google' && t.google_calendar_id).map((t) => t.google_calendar_id as string),
    device: [...live.filter((t) => t.kind === 'device' && t.device_calendar_key).map((t) => t.device_calendar_key as string), ...deviceStatuses.map((s) => s.key)],
  });
}
