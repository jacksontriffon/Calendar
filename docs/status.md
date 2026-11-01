# Build status

Where the Expo + Supabase rebuild stands against `expo-plan.md` §7. Update this when a phase moves.

## Built (code on `main`, CI green)

| Phase | State |
|---|---|
| 0 Foundations | Done. pnpm workspace, `packages/core` (port of the prototype logic, differential-tested against it), Expo SDK 58 app, CI. |
| 1 Schema & RLS | Done. Migrations, RLS, Vault/pgmq/pg_cron wiring, `legacy-import`. Tests run on plain Postgres with shimmed extensions. |
| 2 Auth & entry | Done in code. Welcome animation, Apple/Google sign-in, setup, import, Account, delete, deep links. |
| 3 Calendar core | Done in code. Views, drag/resize/pinch, event sheet, goals, timer, check-ins, History/Undo. Local-first sync is a hand-written outbox + pull sync (`apps/app/src/sync/SPIKE.md` explains why not Legend-State). |
| 4 AI | Done in code. `ai-schedule` (two-pass with verifier, usage limits), composer, ask flow, goal-adjust, AI check-ins, `evals --target ai-schedule`. |
| 5 Visibility & Google | Done in code. `google-connect/sync/webhook`, queue consumer, visibility picker, Connect Google, Choose calendars, Remove/Hidden events, category default visibility. |
| 6 Phone calendars | Done in code. `expo-calendar` bridge (read, publish, duplicate hiding); a test enforces that phone events never reach Supabase. |
| 7 Widgets | Done in code. iOS WidgetKit extension (`@bacons/apple-targets`), Android widget, snapshot + mark-done queue. iPhone Large (three-day carousel) and Medium (today, one goal at a time) follow WG 1g–1i and 2i; Android and the missing states are still on the old designs (see below). |
| 8 Web cutover | Not started: needs a decision (it replaces the live site). |
| 9 Store release | Not started: needs Apple/Google accounts. |

## Not verified yet

Nothing below could run in the build environment (no Docker, no Xcode, no devices, no credentials):

- Native iOS/Android builds and runtime: gestures on touch, sign-in, MMKV, `expo-calendar`, widgets. The Swift widget code has never been compiled.
- A real Supabase stack: the real extensions (pgTAP, Vault, pgmq, pg_cron, pg_net), PostgREST queries (notably `supabase/functions/_shared/google/db.ts` and the app's sync layer), Realtime, and `supabase functions deploy` with the `sync-core.sh` copy of core.
- Real Anthropic and Google API calls.

## Manual setup before it can run for real

- **Supabase project** (open question 9): reuse `rsojhermvtxxizwxaina` or create one; `supabase link`, `db push`, set the Vault secrets `project_url` / `service_role_key` and the function secrets (`supabase/README.md`, `supabase/functions/_shared/google/README.md`).
- **Sign-in**: Apple Services ID + key; Google web/iOS/Android OAuth clients; Supabase redirect allow-list (`aicalendar://auth/callback`, web origin); app env vars (`apps/app/.env.example`).
- **Google Calendar**: OAuth consent screen verification for `calendar.events` (long lead time).
- **Expo/EAS**: `eas init`, the real bundle id (placeholder `com.claudecalendar.app`), `ios.appleTeamId`, App Group `group.com.claudecalendar.app`.
- **AI**: `ANTHROPIC_API_KEY`, optionally upload skills (`ai-schedule/upload-skills.ts`) and set `SKILL_ID_*`.

## Defaults chosen for open questions (revisit any)

- Q1 AI allowance: 200 notes per UTC month (`AI_MONTHLY_LIMIT`), 6 per minute; failed calls are refunded.
- Q4 Imported Google events: no category, painted in their Google calendar's colour.
- Q5 Widget checks: goal sessions only (`showsCheck()` in `apps/app/src/features/widget/snapshot.ts`), and only on iPad and Android. iPhone Large and Medium have no check buttons (WG 1g–2i); the mark-done path is kept for the layouts that still use it.
- Q6 Widget clock: follows the device's 12/24h setting.
- Q7 Widget accent: neutral, except the now line and send button on iPhone Large and Medium, which use the accent as in WG 1g and 2i.
- Q8 Android widget sizes: fixed 2×2 / 4×2 / 4×4.

## Widget carousel (issue 5): decisions and what is open

Decided while building iPhone Large and Medium (details in `expo-plan.md`, Widgets):

- The message field is a deep link to the composer; the carousels move on a tap through App Intents (iOS 17); the tap state resets to Today and the first goal after 5 minutes and at midnight (`apps/app/src/features/widget/carousel.ts`, `CarouselIntents.swift`).
- Not removed: `MarkDoneIntent`, the queue and Android's `MARK_DONE`, because iPad and Android still draw checks.
- The 5-minute reset, the "2 of 3 done" count (goal sessions only) and the goals-block tap (next page, or the goal itself when there is one page) are my choices, not in the frames.

Still open (no frames, so these use defaults): in progress (a card in place of the now line), empty day ("Nothing scheduled" and the next event as text), signed out and stale (the old cards; stale shows the cloud-off mark by the month and "Open Calendar to refresh" in the message field), tinted and clear (the field's solid fill cannot survive them), the second page of goals (the sample has three goals), dark-mode default, and Android (4×4 and 4×2). The Design Spec text still describes the old Large (one "+", "Add a note", WG 5's tap map and check interaction).

Not verified: none of the Swift has been compiled, and the carousel taps have never run on a device. The `aicalendar://compose` link focuses the composer only when the `compose` param changes (`Composer.tsx`), so a second tap on the field while the app is already open at `/?compose=1` may not raise the keyboard.

## Known follow-ups

- The composer should apply category default visibility to new events (`applyCategoryDefaults` in `apps/app/src/features/visibility/persist.ts`).
- The calendar doesn't yet pulse/scroll to AI-changed events (`apps/app/src/features/ai/highlight.ts`).
- Timer, check-in state and AI usage persist on web only; move them to `apps/app/src/lib/deviceKv.ts`.
- No Settings switch yet for the widget's "Hide private titles".
- Month view isn't persisted (`prefs.view` only knows `day3`/`week`).
