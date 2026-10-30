/**
 * Pure view-model helpers for the Calendars screens and the visibility picker: accounts with their
 * calendars and counts, what can be published to, the words under each calendar.
 */
import type { EventTarget, GoogleAccountPublic, GoogleCalendar } from '@calendar/db';

import { normalizeHex } from './colors';

export interface AccountView {
  account: GoogleAccountPublic;
  /** primary first, then by name */
  calendars: GoogleCalendar[];
  shown: number;
  canPublish: number;
  lastSyncedAt: string | null;
  needsSignIn: boolean;
}

export const canWrite = (role: string): boolean => role === 'owner' || role === 'writer';

const byPrimaryThenName = (a: GoogleCalendar, b: GoogleCalendar): number =>
  Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name);

export function buildAccountViews(accounts: readonly GoogleAccountPublic[], calendars: readonly GoogleCalendar[]): AccountView[] {
  return accounts
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.email.localeCompare(b.email))
    .map((account) => {
      const cals = calendars.filter((c) => c.account_id === account.id).sort(byPrimaryThenName);
      const synced = cals.map((c) => c.last_synced_at).filter((x): x is string => !!x).sort();
      return {
        account,
        calendars: cals,
        shown: cals.filter((c) => c.show_in_app).length,
        canPublish: cals.filter((c) => c.can_publish).length,
        lastSyncedAt: synced.length ? synced[synced.length - 1] : null,
        needsSignIn: account.status === 'needs_signin',
      };
    });
}

/** A calendar the picker offers: can publish to, on an account that is signed in. */
export function publishableCalendars(views: readonly AccountView[]): { account: GoogleAccountPublic; calendars: GoogleCalendar[] }[] {
  return views
    .filter((v) => !v.needsSignIn)
    .map((v) => ({ account: v.account, calendars: v.calendars.filter((c) => c.can_publish && canWrite(c.access_role)) }))
    .filter((g) => g.calendars.length > 0);
}

/** "Primary", "Shared with others", "Read only"... the line under a calendar's name in the picker. */
export function calendarSubtitle(c: Pick<GoogleCalendar, 'is_primary' | 'shared' | 'access_role'>): string {
  if (c.is_primary) return 'Primary';
  if (c.shared) return 'Shared with others';
  return canWrite(c.access_role) ? 'Can publish' : 'Read only';
}

/** The line under a calendar's name on the Calendars screens. */
export function calendarRoleLabel(c: Pick<GoogleCalendar, 'is_primary' | 'can_publish' | 'access_role'>): string {
  if (c.is_primary) return 'Primary';
  if (!canWrite(c.access_role)) return 'Read only';
  return c.can_publish ? 'Can publish' : 'Can publish to is off';
}

export const calendarColor = (c: Pick<GoogleCalendar, 'color'>): string => normalizeHex(c.color);

/** "Synced 2 min ago", "Synced just now", "Not synced yet". */
export function syncedLabel(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'Not synced yet';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Not synced yet';
  return 'Synced ' + agoLabel(nowMs - t);
}

export function agoLabel(diffMs: number): string {
  const m = Math.floor(Math.max(0, diffMs) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}

/** "4 shown · 3 can publish" (CA 3.2). */
export const countsLine = (v: Pick<AccountView, 'shown' | 'canPublish'>): string => v.shown + ' shown · ' + v.canPublish + ' can publish';

/** The Google targets of an event that count (not queued for removal), by calendar id. */
export function activeGoogleTargets(targets: readonly EventTarget[] | undefined): EventTarget[] {
  return (targets ?? []).filter((t) => t.kind === 'google' && !!t.google_calendar_id && !t.remove_requested);
}
