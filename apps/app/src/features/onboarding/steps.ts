/**
 * First-run setup state (OA 2): three short steps, every one skippable.
 * Pure state functions, so the flow is unit-tested without React.
 *
 *   you            name + time zone (saved to profiles.display_name / .tz)
 *   calendars      bring Google / phone calendars (screens built in a later phase)
 *   notifications  priming screen, then the system permission prompt
 *
 * Phone calendars and notification priming need a device, so on web the flow
 * is just `you` + `calendars`.
 */

export type StepId = 'you' | 'calendars' | 'notifications';

export function stepsFor(platform: string): StepId[] {
  return platform === 'web' ? ['you', 'calendars'] : ['you', 'calendars', 'notifications'];
}

export type CalendarsChoice = 'idle' | 'google' | 'phone' | 'skipped';
export type NotificationsChoice = 'idle' | 'granted' | 'denied' | 'skipped';

export interface SetupState {
  steps: StepId[];
  /** Index into `steps`. */
  index: number;
  name: string;
  tz: string;
  calendars: CalendarsChoice;
  notifications: NotificationsChoice;
  /** True once the last step has been left (continue or skip). */
  finished: boolean;
}

export function initialSetup(args: { name?: string | null; tz: string; platform: string }): SetupState {
  return {
    steps: stepsFor(args.platform),
    index: 0,
    name: (args.name ?? '').trim(),
    tz: args.tz,
    calendars: 'idle',
    notifications: 'idle',
    finished: false,
  };
}

export const currentStep = (s: SetupState): StepId => s.steps[Math.min(s.index, s.steps.length - 1)];

/** Leave the current step (Continue and Skip both do this) and move to the next, or finish. */
export function advance(s: SetupState): SetupState {
  if (s.finished) return s;
  if (s.index >= s.steps.length - 1) return { ...s, finished: true };
  return { ...s, index: s.index + 1 };
}

/** "Skip" in the header: record that the step was skipped, then advance. */
export function skip(s: SetupState): SetupState {
  const step = currentStep(s);
  const next: SetupState =
    step === 'calendars'
      ? { ...s, calendars: s.calendars === 'idle' ? 'skipped' : s.calendars }
      : step === 'notifications'
        ? { ...s, notifications: s.notifications === 'idle' ? 'skipped' : s.notifications }
        : s;
  return advance(next);
}

export const setName = (s: SetupState, name: string): SetupState => ({ ...s, name });
export const setTz = (s: SetupState, tz: string): SetupState => ({ ...s, tz });
export const chooseCalendars = (s: SetupState, choice: CalendarsChoice): SetupState => ({ ...s, calendars: choice });
export const chooseNotifications = (s: SetupState, choice: NotificationsChoice): SetupState => ({ ...s, notifications: choice });

/** "Step 2 of 3 · Calendars" */
export function stepLabel(s: SetupState): string {
  const titles: Record<StepId, string> = { you: 'You', calendars: 'Calendars', notifications: 'Notifications' };
  return `Step ${s.index + 1} of ${s.steps.length} · ${titles[currentStep(s)]}`;
}

/** Which progress segments are filled: everything up to and including the current step. */
export function progressSegments(s: SetupState): boolean[] {
  return s.steps.map((_, i) => i <= s.index);
}

/**
 * What to write to the profile when the "you" step is left. A blank name is
 * not written (it would erase the provider's), and an unchanged time zone is
 * still written so `profiles.tz` stops being the column default.
 */
export function profilePatch(s: SetupState): { display_name?: string; tz: string } {
  const name = s.name.trim();
  return name ? { display_name: name, tz: s.tz } : { tz: s.tz };
}
