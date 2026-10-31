import { CANCELLED_MESSAGE, connectErrorMessage, type ConnectOutcome } from '../calendars/connect';
import { applyCalendarsOutcome, PHONE_DENIED_MESSAGE, runGoogleStep, runPhoneStep } from './calendarsStep';
import { advance, currentStep, initialSetup, skip } from './steps';

const onCalendars = (platform = 'ios') => advance(initialSetup({ name: 'Sam', tz: 'UTC', platform }));
const connect = (r: ConnectOutcome) => jest.fn().mockResolvedValue(r);

describe('Connect Google during setup', () => {
  it('connected: advances with the google choice', async () => {
    const fn = connect({ kind: 'connected', accountId: 'acc_1' });
    const out = await runGoogleStep(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: 'advance', choice: 'google' });

    const s = applyCalendarsOutcome(onCalendars(), out);
    expect(s.calendars).toBe('google');
    expect(currentStep(s)).toBe('notifications');
  });

  it('cancelled: stays on the step with the "Google said no" message', async () => {
    const out = await runGoogleStep(connect({ kind: 'cancelled' }));
    expect(out).toEqual({ kind: 'stay', message: CANCELLED_MESSAGE });

    const before = onCalendars();
    const after = applyCalendarsOutcome(before, out);
    expect(after).toBe(before);
    expect(currentStep(after)).toBe('calendars');
    expect(after.calendars).toBe('idle');
  });

  it('error: stays on the step with the error text', async () => {
    const message = connectErrorMessage('missing_scope');
    const out = await runGoogleStep(connect({ kind: 'error', code: 'missing_scope', message }));
    expect(out).toEqual({ kind: 'stay', message });
    const before = onCalendars();
    expect(applyCalendarsOutcome(before, out)).toBe(before);
  });

  it('a thrown connect (e.g. the accounts reload failing) is an error, not an advance', async () => {
    const out = await runGoogleStep(() => Promise.reject(new Error('boom')));
    expect(out).toEqual({ kind: 'stay', message: connectErrorMessage('start_failed') });
  });

  it('web redirect: neither advances nor shows an error', async () => {
    const out = await runGoogleStep(connect({ kind: 'redirecting' }));
    expect(out).toEqual({ kind: 'redirecting' });
    const before = onCalendars('web');
    expect(applyCalendarsOutcome(before, out)).toBe(before);
  });

  it('Connect stays available after a failure: a retry that connects advances', async () => {
    const fn = jest
      .fn<Promise<ConnectOutcome>, []>()
      .mockResolvedValueOnce({ kind: 'cancelled' })
      .mockResolvedValueOnce({ kind: 'connected', accountId: null });
    let s = onCalendars();
    s = applyCalendarsOutcome(s, await runGoogleStep(fn));
    expect(currentStep(s)).toBe('calendars');
    s = applyCalendarsOutcome(s, await runGoogleStep(fn));
    expect(s.calendars).toBe('google');
    expect(currentStep(s)).toBe('notifications');
  });

  it('web: connecting finishes setup after the calendars step', async () => {
    const s = applyCalendarsOutcome(onCalendars('web'), await runGoogleStep(connect({ kind: 'connected', accountId: 'a' })));
    expect(s.finished).toBe(true);
  });

  it('a late result does not skip another step once the person has moved on', async () => {
    const out = await runGoogleStep(connect({ kind: 'connected', accountId: 'a' }));
    const moved = skip(onCalendars()); // tapped Skip / Not now while the browser sheet was open
    expect(currentStep(moved)).toBe('notifications');
    expect(applyCalendarsOutcome(moved, out)).toBe(moved);
  });
});

describe('Use phone calendars during setup', () => {
  it('granted: advances with the phone choice', async () => {
    const out = await runPhoneStep(async () => 'granted');
    expect(out).toEqual({ kind: 'advance', choice: 'phone' });
    const s = applyCalendarsOutcome(onCalendars(), out);
    expect(s.calendars).toBe('phone');
    expect(currentStep(s)).toBe('notifications');
  });

  it.each(['denied', 'undetermined'])('%s: stays on the step with a message', async (status) => {
    const out = await runPhoneStep(async () => status);
    expect(out).toEqual({ kind: 'stay', message: PHONE_DENIED_MESSAGE });
    const before = onCalendars();
    expect(applyCalendarsOutcome(before, out)).toBe(before);
  });

  it('a thrown permission request stays on the step', async () => {
    const out = await runPhoneStep(() => Promise.reject(new Error('no module')));
    expect(out).toEqual({ kind: 'stay', message: PHONE_DENIED_MESSAGE });
  });
});
