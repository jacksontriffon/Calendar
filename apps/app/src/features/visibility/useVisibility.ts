import type { Visibility } from '@calendar/core';
import { useMemo } from 'react';

import { useEventTargetOp, useEventTargets, useGoogleAccounts } from '../calendars/data';
import { useDeviceCalendars, useDeviceTargetStatus } from '../calendars/device';
import type { LoadState } from '../calendars/store';
import { useOnline } from '@/lib/useOnline';
import { buildGroups, savedChoice, type PickGroup } from './groups';
import { countStatuses, type StatusCounts } from './status';
import type { PickerState } from './state';

export interface VisibilityData {
  load: LoadState;
  error: string | null;
  groups: PickGroup[];
  /** what the event is saved as (its visibility and target rows, or the client's in-flight choice) */
  saved: PickerState;
  /** counts of the saved targets' statuses */
  counts: StatusCounts;
  online: boolean;
  deviceAvailable: boolean;
  refresh: () => Promise<void>;
}

/** Everything the visibility row and picker show for one event. */
export function useVisibilityData(eventId: string, visibility: Visibility): VisibilityData {
  const { views, load, error, refresh } = useGoogleAccounts();
  const targets = useEventTargets(eventId);
  const op = useEventTargetOp(eventId);
  const device = useDeviceCalendars();
  const deviceStatuses = useDeviceTargetStatus(eventId);
  const online = useOnline();

  const groups = useMemo(
    () => buildGroups({ views, targets, device: { calendars: device.calendars, statuses: deviceStatuses }, offline: !online, op }),
    [views, targets, device.calendars, deviceStatuses, online, op],
  );
  const saved = useMemo(() => {
    const s = savedChoice(visibility, targets, deviceStatuses);
    return op ? { ...s, google: [...op.calendarIds] } : s;
  }, [visibility, targets, deviceStatuses, op]);
  const counts = useMemo(() => {
    const picked = new Set([...saved.google, ...saved.device]);
    const statuses = groups.flatMap((g) => g.options).filter((o) => picked.has(o.id)).map((o) => o.status);
    const c = countStatuses(statuses);
    // ticked calendars the list doesn't show (turned off since) still count as targets
    return { ...c, total: Math.max(picked.size, c.total) };
  }, [groups, saved]);

  return { load, error, groups, saved, counts, online, deviceAvailable: device.supported, refresh };
}
