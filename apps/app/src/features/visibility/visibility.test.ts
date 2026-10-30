import { initPicker, canFinish, pickerEqual, pickerReducer, selectedCount } from './state';
import { leavesMessage, planPersist, targetsRpcArgs } from './payload';
import {
  countStatuses, failureReason, publicTitle, summaryLine, targetUiStatus, worstStatus,
} from './status';
import { buildGroups, savedChoice } from './groups';
import type { AccountView } from '../calendars/view';

const EV = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('picker reducer', () => {
  it('toggles ticks per source and keeps them when switching to Private and back', () => {
    let s = initPicker({ visibility: 'public' });
    s = pickerReducer(s, { type: 'toggle', source: 'google', id: A });
    s = pickerReducer(s, { type: 'toggle', source: 'device', id: 'icloud:Calendar' });
    expect(selectedCount(s)).toBe(2);
    s = pickerReducer(s, { type: 'visibility', visibility: 'private' });
    expect(canFinish(s)).toBe(true);
    s = pickerReducer(s, { type: 'visibility', visibility: 'public' });
    expect(s.google).toEqual([A]);
    s = pickerReducer(s, { type: 'toggle', source: 'google', id: A });
    expect(s.google).toEqual([]);
  });

  it('keeps Done off for Public with nothing ticked (EV 2.2)', () => {
    expect(canFinish(initPicker({ visibility: 'public' }))).toBe(false);
    expect(canFinish(initPicker({ visibility: 'public', google: [A] }))).toBe(true);
  });

  it('ticks add without duplicates; prune drops calendars that can no longer be published to', () => {
    let s = initPicker({ visibility: 'public', google: [A] });
    s = pickerReducer(s, { type: 'tick', source: 'google', ids: [A, B] });
    expect(s.google).toEqual([A, B]);
    const same = pickerReducer(s, { type: 'tick', source: 'google', ids: [B] });
    expect(same).toBe(s);
    s = pickerReducer(s, { type: 'prune', google: new Set([B]), device: null });
    expect(s.google).toEqual([B]);
  });

  it('compares choices as sets', () => {
    expect(pickerEqual(initPicker({ google: [A, B] }), initPicker({ google: [B, A] }))).toBe(true);
    expect(pickerEqual(initPicker({ google: [A] }), initPicker({ google: [A], visibility: 'public' }))).toBe(false);
  });
});

describe('RPC payload', () => {
  it('builds set_event_google_targets arguments with sorted, unique ids', () => {
    expect(targetsRpcArgs(EV, [B, A, B], true)).toEqual({ p_event_id: EV, p_calendar_ids: [A, B], p_apply_to_series: true });
  });

  it('plans a Google call when an event becomes Public, or its targets change', () => {
    const priv = initPicker();
    const pub = initPicker({ visibility: 'public', google: [A] });
    expect(planPersist({ eventId: EV, before: priv, after: pub, isSeries: false }).google).toEqual({ p_event_id: EV, p_calendar_ids: [A], p_apply_to_series: false });
    expect(planPersist({ eventId: EV, before: pub, after: pub, isSeries: false }).google).toBeNull();
    const more = initPicker({ visibility: 'public', google: [A, B] });
    expect(planPersist({ eventId: EV, before: pub, after: more, isSeries: false }).google?.p_calendar_ids).toEqual([A, B]);
    // unticking everything still has to tell the server
    const none = initPicker({ visibility: 'public', device: ['k'] });
    expect(planPersist({ eventId: EV, before: pub, after: none, isSeries: false }).google?.p_calendar_ids).toEqual([]);
  });

  it('covers the series without a scope question', () => {
    const plan = planPersist({ eventId: EV, before: initPicker(), after: initPicker({ visibility: 'public', google: [A], device: ['k'] }), isSeries: true });
    expect(plan.google?.p_apply_to_series).toBe(true);
    expect(plan.device).toEqual({ eventId: EV, keys: ['k'], applyToSeries: true });
  });

  it('makes no Google call for Private (google-sync removes the copy), but clears phone copies', () => {
    const before = initPicker({ visibility: 'public', google: [A], device: ['k'] });
    const plan = planPersist({ eventId: EV, before, after: { ...before, visibility: 'private' }, isSeries: false });
    expect(plan.google).toBeNull();
    expect(plan.device).toEqual({ eventId: EV, keys: [], applyToSeries: false });
  });

  it('names the calendars a series leaves (EV 3.3)', () => {
    expect(leavesMessage('Long run', ['Marathon crew', 'Sam Rivera'])).toBe(
      'Long run is public on Marathon crew and Sam Rivera. Making it private removes it from both, for this and all future events.',
    );
    expect(leavesMessage('Run', ['Family'])).toContain('removes it from there');
  });
});

describe('status mapping', () => {
  it('reports nothing for a calendar the event was not saved to yet', () => {
    expect(targetUiStatus(null)).toBeNull();
    expect(targetUiStatus({ status: 'pending', remove_requested: true })).toBeNull();
  });

  it('maps rows to the four states', () => {
    expect(targetUiStatus({ status: 'synced' })).toBe('synced');
    expect(targetUiStatus({ status: 'pending' })).toBe('pending');
    expect(targetUiStatus({ status: 'failed' })).toBe('failed');
    expect(targetUiStatus({ status: 'queued' })).toBe('queued');
    expect(targetUiStatus({ status: 'weird' })).toBe('pending');
  });

  it('shows pending work as queued while offline, and lets the client op win', () => {
    expect(targetUiStatus({ status: 'pending' }, { offline: true })).toBe('queued');
    expect(targetUiStatus({ status: 'synced' }, { offline: true })).toBe('synced');
    expect(targetUiStatus(null, { localOp: 'pending' })).toBe('pending');
    expect(targetUiStatus(null, { localOp: 'pending', offline: true })).toBe('queued');
    expect(targetUiStatus({ status: 'synced' }, { localOp: 'failed' })).toBe('failed');
  });

  it('words the failure and the summary lines like the spec', () => {
    expect(failureReason(null)).toBe('Google didn’t respond');
    expect(failureReason('HTTP 403 forbidden')).toBe('No permission to add events');
    const c = (s: ('synced' | 'pending' | 'failed' | 'queued' | null)[]) => countStatuses(s);
    expect(summaryLine(c(['synced', 'synced', 'pending']))).toBe('2 synced · 1 pending');
    expect(summaryLine(c(['synced', 'synced', 'failed']))).toBe('2 synced · 1 failed');
    expect(summaryLine(c(['synced', 'synced', 'synced']))).toBe('All synced');
    expect(summaryLine(c(['queued', 'queued', 'synced']))).toBe('2 queued until you’re online');
    expect(summaryLine(c([null, null]))).toBe('');
    expect(publicTitle(3)).toBe('Public on 3 calendars');
    expect(publicTitle(1)).toBe('Public on 1 calendar');
    expect(worstStatus(c(['synced', 'failed']))).toBe('failed');
    expect(worstStatus(c(['pending', 'queued']))).toBe('queued');
  });
});

describe('groups', () => {
  const cal = (id: string, name: string, extra: object = {}) => ({
    id, name, account_id: 'acc', color: '#6a9bcc', access_role: 'owner', is_primary: false, shared: false, show_in_app: true, can_publish: true,
    last_synced_at: null, ...extra,
  });
  const view = {
    account: { id: 'acc', email: 'sam@x.co', status: 'ok', created_at: '2026-01-01' },
    calendars: [cal(A, 'Sam', { is_primary: true }), cal(B, 'Family', { shared: true }), cal('c3', 'Birthdays', { can_publish: false, access_role: 'reader' })],
    shown: 3, canPublish: 2, lastSyncedAt: null, needsSignIn: false,
  } as unknown as AccountView;

  it('lists only calendars that can be published to, with each target status', () => {
    const groups = buildGroups({
      views: [view],
      targets: [{ kind: 'google', google_calendar_id: B, status: 'failed', error: null, remove_requested: false }] as never,
      device: { calendars: [{ key: 'k1', name: 'Calendar', color: '#8fb3a6', account: 'iCloud', showInApp: true, canPublish: true, readOnly: false }] as never, statuses: [{ key: 'k1', status: 'synced' }] },
      offline: false,
      op: null,
    });
    expect(groups.map((g) => g.source)).toEqual(['google', 'device']);
    const g = groups[0].options;
    expect(g.map((o) => [o.name, o.subtitle, o.status])).toEqual([['Sam', 'Primary', null], ['Family', 'Shared with others', 'failed']]);
    expect(g[1].failure).toBe('Google didn’t respond');
    expect(groups[1].options[0].status).toBe('synced');
  });

  it('derives what is saved from the target rows, ignoring ones queued for removal', () => {
    const s = savedChoice('public', [
      { kind: 'google', google_calendar_id: A, remove_requested: false },
      { kind: 'google', google_calendar_id: B, remove_requested: true },
      { kind: 'device', device_calendar_key: 'k1', remove_requested: false },
    ] as never, []);
    expect(s).toEqual({ visibility: 'public', google: [A], device: ['k1'] });
  });
});
