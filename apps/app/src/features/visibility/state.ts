/**
 * The visibility picker's state (EV 02): Private or Public, and for Public the
 * ticked calendars, one list per source. A reducer, so it is tested without UI.
 *
 * Switching to Private keeps the ticks, so switching back restores them (the
 * server keeps the target rows too). "Done" stays off for Public with nothing
 * ticked (EV 2.2).
 */
import type { Visibility } from '@calendar/core';

export type TargetSource = 'google' | 'device';

export interface PickerState {
  visibility: Visibility;
  /** ticked Google calendars: `google_calendars.id` */
  google: string[];
  /** ticked phone calendars: the device calendar `key` */
  device: string[];
}

export type PickerAction =
  | { type: 'visibility'; visibility: Visibility }
  | { type: 'toggle'; source: TargetSource; id: string }
  /** add these (e.g. the calendar a Connect Google flow just added); never removes */
  | { type: 'tick'; source: TargetSource; ids: string[] }
  /** drop ticks for calendars that can no longer be published to */
  | { type: 'prune'; google: ReadonlySet<string> | null; device: ReadonlySet<string> | null }
  | { type: 'reset'; state: PickerState };

export const initPicker = (s: Partial<PickerState> = {}): PickerState => ({
  visibility: s.visibility ?? 'private',
  google: dedupe(s.google ?? []),
  device: dedupe(s.device ?? []),
});

const dedupe = (ids: readonly string[]): string[] => Array.from(new Set(ids));

export function pickerReducer(state: PickerState, a: PickerAction): PickerState {
  switch (a.type) {
    case 'visibility':
      return a.visibility === state.visibility ? state : { ...state, visibility: a.visibility };
    case 'toggle': {
      const list = state[a.source];
      const next = list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id];
      return { ...state, [a.source]: next };
    }
    case 'tick': {
      const next = dedupe([...state[a.source], ...a.ids]);
      return next.length === state[a.source].length ? state : { ...state, [a.source]: next };
    }
    case 'prune': {
      const google = a.google ? state.google.filter((id) => a.google!.has(id)) : state.google;
      const device = a.device ? state.device.filter((id) => a.device!.has(id)) : state.device;
      return google.length === state.google.length && device.length === state.device.length ? state : { ...state, google, device };
    }
    case 'reset':
      return a.state;
  }
}

export const selectedCount = (s: PickerState): number => s.google.length + s.device.length;

/** Done is allowed for Private, and for Public once one calendar is ticked. */
export const canFinish = (s: PickerState): boolean => s.visibility === 'private' || selectedCount(s) > 0;

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export const pickerEqual = (a: PickerState, b: PickerState): boolean =>
  a.visibility === b.visibility && sameSet(a.google, b.google) && sameSet(a.device, b.device);

export const sameIds = sameSet;
