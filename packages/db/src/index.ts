// @calendar/db: types for the Calendar Supabase schema (supabase/migrations).
//
// `database.types.ts` is GENERATED (see supabase/README.md, "Regenerating the TypeScript types") and
// must not be edited by hand. This file adds the convenience aliases the app and the edge functions
// share. The unions below mirror the `check (... in (...))` constraints in the migrations, which the
// generator can only express as `string`.

import type { Database, Tables, TablesInsert, TablesUpdate } from "./database.types.ts";

export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types.ts";
export { Constants } from "./database.types.ts";

/** events.visibility, categories.default_visibility */
export type Visibility = "private" | "public";
/** events.source */
export type EventSource = "app" | "google";
/** event_targets.kind */
export type TargetKind = "google" | "device";
/** event_targets.status */
export type TargetStatus = "pending" | "synced" | "failed" | "queued";
/** hidden_items.source */
export type HiddenSource = "google" | "device";
/** google_accounts.status */
export type GoogleAccountStatus = "ok" | "needs_signin";
/** google_calendars.access_role (Google's accessRole) */
export type GoogleAccessRole = "freeBusyReader" | "reader" | "writer" | "owner";
/** series.freq */
export type SeriesFreq = "weekly";

export type Profile = Tables<"profiles">;
export type Category = Tables<"categories">;
export type Goal = Tables<"goals">;
export type Series = Tables<"series">;
export type CalendarEvent = Tables<"events">;
export type HiddenItem = Tables<"hidden_items">;
/** What clients read: google_accounts without the Vault token pointer. */
export type GoogleAccountPublic = Database["public"]["Views"]["google_accounts_public"]["Row"];
export type GoogleCalendar = Tables<"google_calendars">;
export type EventTarget = Tables<"event_targets">;
export type AiUsage = Tables<"ai_usage">;

export type NewEvent = TablesInsert<"events">;
export type EventPatch = TablesUpdate<"events">;
export type NewCategory = TablesInsert<"categories">;
export type NewGoal = TablesInsert<"goals">;
export type NewSeries = TablesInsert<"series">;

/** The only google_calendars columns a client may update (column-level grant). */
export type GoogleCalendarClientPatch = Pick<
  TablesUpdate<"google_calendars">,
  "show_in_app" | "can_publish"
>;

/** The default categories every new user gets, with the prototype's hues (see handle_new_user()). */
export const DEFAULT_CATEGORIES = [
  { name: "Work", hue: 255 },
  { name: "Food", hue: 72 },
  { name: "Health", hue: 132 },
  { name: "Family", hue: 28 },
  { name: "Social", hue: 12 },
  { name: "Routine", hue: 104 },
  { name: "Pets", hue: 166 },
] as const;
