/** Row shapes and Google API shapes used by the Google edge functions. */

export type AccountStatus = 'ok' | 'needs_signin';
export type AccessRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner';

export interface AccountRow {
  id: string;
  user_id: string;
  email: string;
  status: AccountStatus;
}

export interface CalendarRow {
  id: string;
  user_id: string;
  account_id: string;
  google_id: string;
  name: string;
  color: string | null;
  access_role: AccessRole;
  is_primary: boolean;
  shared: boolean;
  show_in_app: boolean;
  can_publish: boolean;
  sync_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: string | null;
  last_synced_at: string | null;
  full_synced_at: string | null;
}

/** The fields of an app `events` row the Google sync reads. */
export interface AppEvent {
  id: string;
  user_id: string;
  title: string;
  day: string;
  start_min: number;
  end_min: number;
  all_day: boolean;
  days: number;
  visibility: 'private' | 'public';
  source: 'app' | 'google';
  series_id: string | null;
  deleted_at: string | null;
}

export interface SeriesInfo {
  id: string;
  weekdays: number[];
  start_day: string;
  until: string | null;
}

export type TargetStatus = 'pending' | 'synced' | 'failed' | 'queued';

export interface TargetRow {
  id: string;
  user_id: string;
  event_id: string;
  google_calendar_id: string;
  external_id: string | null;
  fingerprint: string | null;
  status: TargetStatus;
  error: string | null;
  synced_at: string | null;
  remove_requested: boolean;
}

export type TargetPatch = Partial<Pick<TargetRow, 'external_id' | 'fingerprint' | 'status' | 'error' | 'synced_at'>>;

/** What `events` rows google-sync writes for an imported Google event. */
export interface ImportedEventRow {
  user_id: string;
  google_calendar_id: string;
  google_event_id: string;
  source: 'google';
  title: string;
  day: string;
  start_min: number;
  end_min: number;
  all_day: boolean;
  days: number;
  etag: string | null;
  organizer_email: string | null;
  is_mine: boolean;
  deleted_at: null;
}

/* ------------------------------------------------------------ Google API */

export interface GoogleDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GooglePerson {
  email?: string;
  self?: boolean;
  displayName?: string;
}

export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  summary?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  creator?: GooglePerson;
  organizer?: GooglePerson;
  attendees?: Array<GooglePerson & { responseStatus?: string }>;
  recurringEventId?: string;
  recurrence?: string[];
  eventType?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export interface GoogleEventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: AccessRole;
  primary?: boolean;
  deleted?: boolean;
  hidden?: boolean;
}

export interface GoogleAclRule {
  role?: string;
  scope?: { type?: string; value?: string };
}

export interface GoogleChannel {
  id: string;
  resourceId: string;
  /** epoch milliseconds, as a string */
  expiration?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type?: string;
}
