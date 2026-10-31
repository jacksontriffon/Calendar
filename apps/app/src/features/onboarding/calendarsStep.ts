/**
 * The "Bring your calendars" step (OA 2.5-2.8): what happens when Connect (Google) or Use (phone)
 * is tapped. Setup can't push to the Settings screens (they are only registered once setup is
 * done), so each button runs its connect logic directly and reports one of two outcomes:
 *
 *   advance  it worked: record the choice and move on (picking calendars happens later, in Settings)
 *   stay     it didn't: stay on the step, show `message`, leave the button available
 *
 * Pure (the I/O comes in as an argument) so it is unit-tested without React.
 */
import { CANCELLED_MESSAGE, connectErrorMessage, type ConnectOutcome } from '../calendars/connect';
import { chooseCalendars, advance, currentStep, type SetupState } from './steps';

export type CalendarsOutcome =
  | { kind: 'advance'; choice: 'google' | 'phone' }
  | { kind: 'stay'; message: string }
  /** The page is leaving for Google (web); nothing to do until it comes back. */
  | { kind: 'redirecting' };

/** Shown when the OS calendar permission wasn't granted. */
export const PHONE_DENIED_MESSAGE = 'Calendar access wasn’t turned on. Try again, turn it on in Settings, or tap Not now.';

/** Run Connect Google (`connectGoogle` in the calendars actions) and decide what the step does next. Never throws. */
export async function runGoogleStep(connect: () => Promise<ConnectOutcome>): Promise<CalendarsOutcome> {
  try {
    const r = await connect();
    switch (r.kind) {
      case 'connected':
        return { kind: 'advance', choice: 'google' };
      case 'cancelled':
        return { kind: 'stay', message: CANCELLED_MESSAGE };
      case 'error':
        return { kind: 'stay', message: r.message };
      case 'redirecting':
        return { kind: 'redirecting' };
    }
  } catch {
    return { kind: 'stay', message: connectErrorMessage('start_failed') };
  }
}

/** Ask for the OS calendar permission and decide what the step does next. Never throws. */
export async function runPhoneStep(request: () => Promise<string>): Promise<CalendarsOutcome> {
  try {
    return (await request()) === 'granted' ? { kind: 'advance', choice: 'phone' } : { kind: 'stay', message: PHONE_DENIED_MESSAGE };
  } catch {
    return { kind: 'stay', message: PHONE_DENIED_MESSAGE };
  }
}

/**
 * Apply an outcome to the setup state. Only moves on if the person is still on the calendars step
 * (they may have tapped Not now / Skip while the browser sheet was open), so a late result can't
 * skip the next step too.
 */
export function applyCalendarsOutcome(s: SetupState, outcome: CalendarsOutcome): SetupState {
  if (outcome.kind !== 'advance' || currentStep(s) !== 'calendars') return s;
  return advance(chooseCalendars(s, outcome.choice));
}
