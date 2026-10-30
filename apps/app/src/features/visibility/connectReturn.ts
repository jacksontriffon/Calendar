/**
 * "Back from Connect Google" (EV 2.12): the picker starts the Connect flow, which leaves it for the Choose
 * calendars screen. This remembers which event and account, so the event sheet reopens the picker with the
 * new calendar ticked when Choose calendars is done.
 */
export interface ConnectReturn {
  eventId: string;
  accountId: string | null;
}

let pending: ConnectReturn | null = null;

export const setConnectReturn = (r: ConnectReturn | null): void => {
  pending = r;
};

/** Take (and clear) the pending return for this event, if any. */
export function takeConnectReturn(eventId: string): ConnectReturn | null {
  if (!pending || pending.eventId !== eventId) return null;
  const r = pending;
  pending = null;
  return r;
}

export const hasConnectReturn = (): boolean => pending !== null;
