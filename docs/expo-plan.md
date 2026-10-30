# Expo + Supabase build plan

Plan for rebuilding the Calendar app as an Expo app for iOS, Android and web, backed by Supabase. It covers auth, the database, edge functions, Google and phone calendar sync, AI note parsing, and a home-screen widget.

**Sources of truth**

- **Design Spec**: the `Design Spec` page on the design canvas, https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT. It holds every screen and state, the flows, the glossary, the component reference, the deep links, the decisions and the open questions. Screen codes in this plan (`OA 1.1`, `EV 2.3`, `CA 2.7`, `WG 1a`) refer to it.
- **Prototype**: the `AI Calendar Web` page on the same canvas. It is the working app and the source of today's `index.html`, with the new header, visibility picker, Settings and Welcome animation applied. Use it for behaviour, styles and motion.
- **Existing backend pieces**: `supabase.sql` (the one-JSON-row `calendars` table plus `gcal_links`), the `gcal` edge function (Google primary-calendar sync), and `skills/` + `evals/` (the AI scheduling skills and their test harness).

## 1. Decisions already made

| Area | Decision |
|---|---|
| Platforms | One Expo codebase for iOS, Android and web. Expo web replaces `index.html` on Vercel at cutover. |
| Sign-in | Google and Apple only for v1, and sign-in is required (no "Not now"). Email-code sign-in is designed (Design Spec appendix OA A) but deferred. |
| Calendars | There are no in-app shared calendars: the app doesn't create, invite to, share or manage membership of calendars. Calendars are **My calendar**, **Google · ‹email›** (one or more Google accounts) and **On this phone** (device calendars). Some of these may be shared with other people outside the app; they get a quiet "Shared" label. |
| Visibility | Every event is **Private** or **Public**. A public event goes to the targets the user picks: Google calendars marked *Can publish to* and phone calendars marked *Can publish to*. Private events never leave the app, and are hidden entirely on shared calendars (never shown as "Busy"). |
| Someone else's event | An event on a shared Google or phone calendar created by another person. It is read-only, with *Copy to my calendar* and a subtle *Remove*. Remove hides the event in this app only, with an Undo toast; hidden events can be restored from Settings → Calendars → Hidden events. |
| Google calendars | Each Google calendar has two toggles: *Show in app* (import) and *Can publish to*. |
| Phone calendars | The user picks which phone calendars to show and which to publish to. Phone events are read on the device and are **never uploaded**. |
| Header | The user's avatar replaces the settings gear and opens Settings. There is no layers button; calendar show/hide lives in Settings → Calendars. |
| Event sheet | Delete is only a trash icon. Repeating events have no "All future" pill; a quiet note under the visibility control says "Applies to this and all future events in the series." |
| Event blocks | The public glyph sits bottom right on blocks 40px or taller and never appears in month view. The "on another calendar" dot sits bottom left. |
| Welcome | The tagline is "Schedule your day in seconds". The intro animation plays once (≈9.7 s): a note types into the bottom composer and sends, a 7am–7pm day of ten events staggers in, the composer fades, and the Apple and Google buttons stagger in. With reduced motion, the end state shows immediately. Exact timing is in the Design Spec timing panel and the prototype's `.hv*` CSS. |
| Widget | Agenda + goals. Android uses the same designs as iOS (Small 2×2, Medium 4×2, Large 4×4). Goals show a daily-progress ring plus "45m left today" / "Done today" and the total time left. The widget follows system light/dark mode: white text on dark, black on light, no coloured text. Only one "+" is visible at a time. |
| AI | Note parsing runs server-side. There are no API keys in the app UI. |

## 2. Architecture

```
┌──────────── Expo app (iOS · Android · web) ────────────┐
│ Expo Router screens  ·  local-first store (offline)    │
│ expo-calendar (phone) · widgets (WidgetKit / Android)  │
└───────────────┬───────────────────────┬────────────────┘
                │ supabase-js (RLS)     │ functions.invoke
┌───────────────▼─────────┐   ┌─────────▼──────────────────┐
│ Postgres + RLS          │   │ Edge functions             │
│ events, goals, cats,    │◄──┤ ai-schedule  google-*      │
│ google_*, event_targets │   │ account-delete legacy-imp. │
│ pgmq queue · pg_cron    │──►│ (service role)             │
└─────────────────────────┘   └─────────┬──────────────────┘
                                        │
                        Google Calendar API · Anthropic API
```

- **The client reads and writes its own rows directly** through supabase-js, with Row Level Security doing the access control. Edge functions handle anything that needs a secret: Google tokens, the Anthropic key, or the service role.
- **Google sync runs on the server.** A change to an event enqueues a publish job. Google push notifications and a pg_cron fallback enqueue import jobs.
- **Phone-calendar sync runs on the device**, because device calendars are only reachable there.

## 3. Repository layout

The repo becomes a small **pnpm workspace**.

**Why a workspace at all:** three separate consumers need the same scheduling logic. The Expo app applies AI operations and runs the date and goal maths. The `ai-schedule` edge function validates the same operations before returning them. `evals/` grades replies against them. Keeping that logic in one `packages/core` package means one implementation and one set of tests, instead of three copies drifting apart. Without the shared code, the Expo app could simply live at the repo root.

**Tooling:**
- **pnpm:** a `pnpm-workspace.yaml` covers `apps/*`, `packages/*` and `evals`. `evals/` moves from npm to pnpm; `pnpm import` converts its `package-lock.json`. Expo supports pnpm workspaces; if a native module misbehaves with isolated installs, fall back to `node-linker=hoisted` in `.npmrc`.
- **Turborepo, only if needed:** start with plain `pnpm -r` / `pnpm --filter` scripts. Add Turbo later only if CI or local typecheck and test runs get slow enough that caching pays off. With two or three packages it likely won't at first.
- **Edge functions (Deno):** they import `packages/core` through a `deno.json` import map pointing at its TypeScript source, so core must stay free of Node-only APIs. Phase 0 checks that `supabase functions deploy` bundles it. If it doesn't, a prebuild step copies core into `supabase/functions/_shared/core`.

```
apps/app/            Expo app (Expo Router, TypeScript)
  app/               routes: (auth)/welcome, (app)/index, event/[id], settings/…, goal/[id]
  src/features/      calendar views, composer, event sheet, visibility, settings, goals, timer
  src/sync/          local store, Supabase sync, phone-calendar bridge, widget snapshot
  targets/widget/    iOS WidgetKit extension (SwiftUI) via @bacons/apple-targets
  widgets/           Android widget (react-native-android-widget)
packages/core/       pure TS shared by app, functions and evals: date/time maths, event model,
                     recurrence, goal maths, AI-op schema + validator + applier, colour/hue tokens
supabase/
  config.toml
  migrations/        SQL migrations (schema, RLS, triggers, cron, queues)
  functions/         ai-schedule, google-connect, google-sync, google-webhook,
                     account-delete, legacy-import, _shared/
  seed.sql
skills/  evals/      unchanged; evals gain a target that calls ai-schedule
index.html           legacy web app, kept until web cutover (phase 8)
```

Most of `packages/core` is extracted from the prototype's logic class. That means the date helpers, `repWords`, the series and top-up logic, goal pacing, the op validator, and how ops are applied, ported as typed, unit-tested modules. The app, the AI function and the evals then share one implementation.

Phase 0 also updates `CLAUDE.md` and `README.md`, which currently describe a single-HTML-file repo.

## 4. Data model

Times stay **floating local time**, as in today's app and the AI operations: `day` is a date, and `start_min` / `end_min` are minutes past midnight. The user's IANA time zone lives on `profiles.tz`, and the Google sync converts using it, as `gcal` does today. All tables have `user_id uuid references auth.users on delete cascade`, plus RLS `user_id = auth.uid()` for select, insert, update and delete, unless noted.

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= user), `display_name`, `avatar_url`, `tz`, `prefs jsonb` | `prefs` holds view, font, zoom, region/sun and AI toggles: everything the prototype keeps in `aical.v1` except data. |
| `categories` | `id`, `name`, `hue`, `default_visibility`, `default_targets uuid[]` | Unique `(user_id, name)`. The default visibility comes from the category editor (EV 06). |
| `goals` | `id`, `title`, `outcome`, `deadline`, `hours`, `hue`, `category_id`, `start_date` | Same shape as the AI `goal` op. |
| `series` | `id`, `freq` (`weekly`), `weekdays smallint[]`, `start_day`, `until` | Weekly series, as the prototype has today. |
| `events` | `id uuid`, `title`, `category_id`, `day`, `start_min`, `end_min`, `all_day`, `days`, `done`, `pauses jsonb`, `win jsonb`, `series_id`, `visibility` (`private`/`public`), `source` (`app`/`google`), `google_calendar_id`, `google_event_id`, `etag`, `organizer_email`, `is_mine`, `updated_at`, `deleted_at`, `legacy_id` | Soft delete (`deleted_at`) so sync and undo can see deletions. Imported Google events are rows with `source='google'`. `is_mine=false` marks someone else's event, which the app treats as read-only. |
| `hidden_items` | `source` (`google`/`device`), `external_key`, `hidden_at` | Remove = insert; Unhide = delete. Device keys are opaque to the server. |
| `google_accounts` | `id`, `email`, `status` (`ok`/`needs_signin`), `refresh_token_id` (Vault) | The refresh token lives in Supabase Vault. Clients read through a view without the token column. |
| `google_calendars` | `id`, `account_id`, `google_id`, `name`, `color`, `access_role`, `is_primary`, `shared`, `show_in_app`, `can_publish`, `sync_token`, `channel_id`, `channel_expires_at`, `last_synced_at` | The client may update only `show_in_app` and `can_publish` (column-level grant). |
| `event_targets` | `event_id`, `kind` (`google`/`device`), `google_calendar_id`, `device_id`, `device_calendar_key`, `external_id`, `fingerprint`, `status` (`pending`/`synced`/`failed`/`queued`), `error`, `synced_at` | One row per place a public event is published. Device rows are written only by the device that owns them. |
| `ai_usage` | `month`, `notes` | Feeds the AI usage indicator (OA 6). |
| `legacy_calendar_blobs` | the old `calendars` table, renamed | Read once by `legacy-import`, then dropped after the import window. |

The `can_publish` / `show_in_app` flags of phone calendars are device-local settings, stored on the device in the app's local store.

**Triggers:**
- `events` change: bump `updated_at`. If the event is public (or was public), enqueue `publish:{event_id}` on a pgmq queue.
- New user: create a `profiles` row and the default categories (Work, Food, Health, Family, Social, Routine, Pets, with the prototype's hues).

## 5. Edge functions

All functions verify the caller's JWT. Only `google-connect`'s OAuth callback and `google-webhook` run without JWT verification, and both validate their own state or channel token. Shared code lives in `supabase/functions/_shared/` (Supabase admin client, Google client, `packages/core` import).

| Function | Responsibility |
|---|---|
| `ai-schedule` | Server-side replacement for the browser's direct Anthropic calls. Input: a note (or goal-adjust or check-in request) plus calendar context from the user's rows. It runs the existing two-pass flow: the skill (`calendar-scheduler` / `calendar-goal-adjust` / `calendar-checkin`) produces ops, then the code validator from `packages/core` and the `calendar-verifier` skill check them, with one fix round. It returns the ops; the client applies them so undo and history keep working. The Anthropic key and the model choice are function secrets and config, not app settings. Skills are uploaded once per deploy, and their ids are stored as secrets. It counts usage in `ai_usage` and enforces the monthly allowance and per-minute rate limits. |
| `google-connect` | `start` returns a Google OAuth URL with the `calendar.events` + `calendar.readonly` scopes, offline access, and a nonce `state`. `callback` exchanges the code, stores the refresh token in Vault, lists calendars into `google_calendars`, then redirects to an **allow-listed** return URL (`aicalendar://google/connected` or the web origin). `list`, `disconnect` (revokes the token and deletes imported events) and `reconnect` round it out. This replaces `gcal`'s start/callback; note that today's `back` parameter accepts any URL and must be allow-listed. |
| `google-sync` | Per-calendar incremental sync using Google `syncToken`s instead of today's 30-day/180-day full window.<br>• **Import** for calendars with `show_in_app`: upsert into `events` with `source='google'`, setting `is_mine` from creator/organizer vs the account email, and honouring deletions.<br>• **Publish** for `event_targets` rows of kind `google`: create, patch or delete using fingerprints, as `gcal` does. Weekly series publish as one Google event with an `RRULE`, not one event per occurrence.<br>• Writes target status back. Triggered by the queue consumer, by `google-webhook`, by a pg_cron sweep every 15 minutes, and by "Sync now". |
| `google-webhook` | Receives Google push notifications (`events.watch`) and enqueues `import:{calendar}`. pg_cron renews watch channels before they expire (about every 6 days). |
| `account-delete` | Required by App Store rules. It revokes Google tokens, deletes Vault secrets, then deletes the auth user (rows cascade). It returns once done, for the goodbye screen (OA 4.x). |
| `legacy-import` | A one-time, idempotent conversion of the user's row in `legacy_calendar_blobs` (the old web app's JSON) into categories, goals, series and events. It keeps `legacy_id` and maps old `gcal_links.map` entries to `event_targets`. It returns counts for the "Bringing over your calendar…" screen (OA 3.x). |

**Queue consumer:** a pg_cron job runs every minute. It reads a batch from pgmq and calls `google-sync` through `pg_net` with the service role, with a per-user advisory lock so syncs never overlap.

## 6. The app

### Stack

| Area | Choice |
|---|---|
| Project | Latest stable Expo SDK at kickoff, TypeScript and Expo Router. Builds use a development client (not Expo Go) because of widgets and native modules, and ship through EAS Build, Submit and Update. |
| UI | Reanimated + Gesture Handler for drag, resize, pinch-zoom and the Welcome timeline. `@gorhom/bottom-sheet` for sheets. `expo-haptics`. The prototype's fonts (Serif / Sans / Mono) through `expo-font`. |
| Design tokens | `packages/core/tokens.ts`, generated from the Design Spec reference sheet: surfaces, text opacities, accent, danger, category hue formulas, avatar sizes, glyphs (lock, globe, check, cloud-off, warning, trash, eye, phone). |
| Local-first store | **Legend-State v3** with its Supabase sync plugin. It persists to MMKV on native and IndexedDB on web, with optimistic writes, retry when back online, and Supabase Realtime for changes from other devices. Conflicts resolve last-write-wins per row on `updated_at`, and the History/Undo log stays on the device as it does today. Phase 3 opens with a spike to confirm it on all three platforms; if it falls short, the fallback is PowerSync. |
| Auth | **Apple:** `expo-apple-authentication` with `supabase.auth.signInWithIdToken` on iOS, and Supabase OAuth elsewhere. **Google:** `@react-native-google-signin/google-signin` with `signInWithIdToken`, and Supabase OAuth on web. **Sessions:** stored with `expo-secure-store` (encrypted AsyncStorage blob, key in SecureStore, per Supabase's Expo guide). |
| Deep links | `aicalendar://` scheme (table in the Design Spec), with Universal/App Links on claude-calendar.com later. |
| Phone calendars | `expo-calendar` (iOS/Android only; hidden on web with the "available in the mobile app" note). |
| Notifications | `expo-notifications` for local event-start reminders and the existing check-in prompt (OA 2.x priming). No push server needed in v1. |
| Background | `expo-background-task` refreshes the widget snapshot and phone-calendar publish status. |

### Screens

Each screen is built to its Design Spec section.

- **Welcome / sign-in** (OA 1): the one-shot intro animation runs on a single Reanimated clock using the timings from the spec and prototype (`--t` 0→9700 ms). It respects `AccessibilityInfo.isReduceMotionEnabled()`. Apple and Google buttons, with Google first on Android.
- **First-run setup** (OA 2): name and time zone, then bring calendars (Connect Google / Use phone calendars), then notification priming. Each step can be skipped; signing in can't.
- **Import** (OA 3): calls `legacy-import` when the account has a legacy blob.
- **Calendar**: day, 3-day, week, month, goal and story views, ported from the prototype. That includes drag/resize with snapping, pinch zoom levels, the now line, sunrise/sunset shading, the done state, the timer and pauses, check-ins and wins. The event blocks get the visibility glyph, the calendar dot and the someone-else's-event outline (EV 04/05).
- **Composer**: a note goes to `ai-schedule`, and the ops are applied locally. That covers the ask flow (question sheets), goal-adjust actions and check-ins. History/Undo works as today.
- **Event sheet**: title, time, category, repeat, the visibility row and picker (EV 01–03), and trash-icon delete. On someone else's event, a read-only sheet with Copy and Remove (EV 05).
- **Settings** (CA 5 / OA 4–6): Account, Calendars (My calendar, Google accounts, On this phone, Hidden events), region and sun, typeface, Claude parsing (model, toggles, usage), History. Delete account lives under Account.
- **Connect Google** (CA 2–3): runs in `expo-web-browser` (ASWebAuthenticationSession / Custom Tab), then the Choose calendars screen, then account detail.
- **Phone calendars** (CA 4): priming, then the OS permission prompt, then Choose calendars. There is a denied state with "Open Settings".
- **Global states** (OA 5): offline pill, sync-conflict toast with Undo, session-expired sheet, force update. EAS Update decides the minimum supported version.

### Phone-calendar bridge

This runs only on device, in `src/sync/device.ts`.

- **Read:** for each calendar with *Show in app*, read events in a rolling window into an in-memory, device-only source. These are never written to Supabase. Phone events created by other people (where the platform exposes the organizer) get the someone-else's-event treatment, and Remove adds a `device` key to `hidden_items`.
- **Publish:** when a public event targets a phone calendar, create, update or delete it with `expo-calendar`. The mapping (`external_id`) is stored in `event_targets` with this `device_id`, so other devices show the status but don't act on it.
- **Duplicates:** Google calendars that also appear on the phone are hidden from the phone list (CA 4.5), matched on account and calendar name.

### Widgets

Built to the Design Spec Widgets section (WG 1–6).

- **Shared snapshot:** the app writes a compact JSON snapshot on every change and on background refresh. It holds the next ~24h of visible events (private/public flag, owner initials for someone else's events), today's goal progress (`todayNeed` / `todayDone` / total left / ring fraction), the clock preference, and the light/dark tokens. The format is in WG 5.
  - **iOS:** written to the App Group container.
  - **Android:** written to the widget's shared storage.
- **iOS:** a SwiftUI WidgetKit extension in `apps/app/targets/widget`, added with `@bacons/apple-targets`.
  - Families: `systemSmall`, `systemMedium`, `systemLarge` and `systemExtraLarge` (iPad).
  - Timeline entries at each event start and end.
  - App Intents for "mark done", which update the snapshot and queue the change for the app to sync.
  - `containerBackground` plus tinted and clear rendering modes.
  - Check `expo-widgets` at kickoff and use it instead if it's stable by then.
- **Android:** `react-native-android-widget` with the same three layouts at 2×2, 4×2 and 4×4.
  - A `MARK_DONE` click handler in the headless task.
  - `OPEN_URI` deep links.
  - The system corner radius.
- **Shared rules:** goal rings copy the app's ring geometry (18-unit viewBox, r 7.5, stroke 2.5, starting at the top). There is no coloured text, and the "+" is hidden whenever the empty-day "Add a note" call to action is showing.

### Web

- `expo export -p web` replaces `index.html` on Vercel, keeping https://www.claude-calendar.com.
- Native-only features don't show on web: phone calendars, widgets and haptics.
- Apple and Google sign-in on web use Supabase OAuth redirects.

## 7. Phases

Each phase ends with the app runnable on iOS, Android and web, CI green, and the matching Design Spec screens checked on device.

| # | Phase | Deliverables | Done when |
|---|---|---|---|
| 0 | Foundations | pnpm workspace (`evals` moved over; no Turbo yet). Expo app scaffold with dev client and EAS project. Supabase CLI local stack. CI (typecheck, lint, unit tests, `evals` tests). `packages/core` extracted from the prototype with unit tests. Updated `CLAUDE.md` / `README.md`. | `pnpm -r test` passes; a blank app builds on all three platforms; an edge function imports `packages/core` and deploys. |
| 1 | Schema & RLS | Migrations for §4, RLS policies with tests (pgTAP or a SQL test script), Vault, pgmq, pg_cron, generated TS types, seed data, `legacy-import`. | A user can only see their own rows; a legacy blob imports correctly in tests. |
| 2 | Auth & entry | Welcome screen with the intro animation, Apple and Google sign-in, session storage, first-run setup, the import screen, Account screen, `account-delete`, deep-link handling. | Sign in, out and delete work on iOS, Android and web. |
| 3 | Calendar core | Local-first store spike, then all views, the event sheet, categories, goals, the timer, check-ins and History/Undo on Supabase. Offline, conflict and session-expired states. | Feature parity with the prototype minus AI; edits sync across two devices; works offline. |
| 4 | AI | `ai-schedule` (skills, verifier, usage, limits), the composer and ask flow, goal-adjust, check-in. `evals` gain an `ai-schedule` target. | The eval suite passes at the current bar; the usage indicator works. |
| 5 | Visibility & Google | `google-connect`, `google-sync` (import and publish, RRULE series), `google-webhook`, queue consumer, cron. Visibility row and picker, target statuses, Connect Google flow, Choose calendars, someone-else's events, Remove/Hidden events, category default visibility. | Multi-account import and publish round-trip with Google in both directions, including deletes; private events never reach Google. |
| 6 | Phone calendars | `expo-calendar` bridge (read, publish, permissions, duplicate hiding), "On this phone" targets and statuses. | Publish to iCloud and Android device calendars; phone events never reach Supabase (verified by test). |
| 7 | Widgets | iOS extension (all families, light/dark, tinted/clear, App Intents) and Android widget (3 sizes, MARK_DONE); snapshot writer; background refresh. | WG frames match on device; mark done from the widget syncs. |
| 8 | Web cutover | Expo web deployed to Vercel in place of `index.html`; legacy web app retired; `legacy_calendar_blobs` dropped after the import window. | claude-calendar.com serves the Expo build; legacy users are imported. |
| 9 | Store release | Bundle ids, icons and splash from `assets/`, iOS privacy manifest, App Privacy and Play Data safety forms, App Review notes with a demo account, TestFlight / internal testing, EAS Submit. | Both apps are approved. |

Phases 5–7 can overlap once phase 3 lands. Phase 4 can start in parallel with phase 3.

**Start now** (these have long lead times):
- **Google OAuth verification:** the `calendar.events` scope is sensitive and needs Google's review before non-test users can connect.
- **Apple setup:** Developer team, App ID with Sign in with Apple and App Groups, and Services ID.
- **Bundle ids and App Links:** pick the app name and bundle id, and prepare the `apple-app-site-association` / `assetlinks.json` hosting on claude-calendar.com.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Google verification delays public launch | Start in phase 0; until approved, test users only (as `gcal` today). |
| Local-first sync on web (IndexedDB) or conflicts misbehave | Phase 3 starts with a spike; PowerSync is the fallback; per-row LWW plus the existing History/Undo limits damage. |
| Floating local times across time zones | Store `profiles.tz`; convert only at the Google boundary; flag events when the device zone differs from the profile zone. |
| Recurring events: the prototype doesn't persist `series` / `rep` today | The new schema has a real `series` table; publish series to Google as RRULE; design the "delete this vs series" step (open question). |
| Widget data goes stale | Timeline entries at event boundaries, background refresh, and the "Updated 3h ago" state (WG 6a). |
| AI cost per user | Server-side allowance and rate limits in `ai-schedule`; the model is configurable. |
| Supabase project access | The live project `rsojhermvtxxizwxaina` isn't reachable from the Supabase connector used during planning. Link it with the Supabase CLI in phase 0, or decide on a new project. |

## 9. Open questions

These carry over from the Design Spec. Decide them before the phase that needs them.

1. **AI allowance:** the real monthly allowance and what happens at the limit. The spec shows a placeholder "of 200 · resets Nov 1". (Phase 4)
2. **Repeating events:** whether deleting one asks "this event or the series". Today trash deletes this and all future occurrences. (Phase 3)
3. **"Family" naming:** it is both a category and a Google calendar name, in different colours. Should the sample data or the UI disambiguate? (Phase 3)
4. **Imported Google events:** which category they get. Options are a per-calendar default, "Google", or AI-assigned. (Phase 5)
5. **Widget check buttons:** shown only on goal sessions and tasks, or on every event? (Phase 7)
6. **Widget clock:** should it follow a 12h/24h preference? The app has none yet. (Phase 7)
7. **Widget accent:** should the "+", now line and pin markers go neutral like the text? (Phase 7)
8. **Android widget sizes:** are fixed sizes (2×2 / 4×2 / 4×4) enough, or should it resize continuously? (Phase 7)
9. **Supabase project:** reuse the live project (`rsojhermvtxxizwxaina`) or start fresh for the Expo app. Also decide the app name and bundle id. (Phase 0)
