# Design agent prompts: mobile app gaps

Prompts for agents that will add the screens the Expo + Supabase mobile app needs to the Calendar design canvas (https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT).

## How to run them

- Prompts **1–4 can run in parallel.** Each one adds its own new page and leaves every existing page alone, so they don't overwrite each other.
- Run **prompt 5 after the other four finish.** It makes the new pages consistent with each other and adds an index page.
- No prompt edits `AI Calendar Web.dc.html`. That page is the source of the live site (`index.html`), and the new screens are a reference for the Expo build, not changes to ship on the web today.
- Each prompt is self-contained (the shared project context and style rules are repeated in every one). Copy a whole code block into a Claude Design / Claude Code session that can open the canvas.

## Decisions the prompts assume (change before running if wrong)

1. **Visibility is Private or Public.** A private event appears only in its owner's own calendar. It's hidden entirely from shared calendars, with no "Busy" block. A public event goes to the targets the owner picks, which can be any mix of in-app shared calendars, Google calendars and on-device calendars.
2. **Other people's public events on a shared calendar are read-only.** Only the owner edits them. Viewers can "Copy to my calendar".
3. **Google:** one or more Google accounts. For each Google calendar there are two toggles: *Show in app* (import) and *Can publish to*.
4. **Device calendars** (iCloud, Exchange, etc. via the phone): the user chooses which ones to show (read-only, never uploaded) and which ones they can publish to.
5. **The home-screen widget shows the agenda plus goals.** On iOS the largest size is Large, and widgets can't scroll. On Android the widget resizes up to full screen and the list scrolls.
6. **No API keys or Supabase fields in the UI.** Auth, AI and sync all go through the backend, so the current "Supabase project URL", "Anon public key", "Anthropic API key" and proxy fields go away.

---


## Prompt 1: Event visibility and publishing targets

Page to create: **`Mobile - Event Visibility.dc.html`**

```
**Project.** The Calendar design canvas is https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT, a Claude Design project (Migrated Design type). Read `project/compat.json` first, then `project/AI Calendar Web.dc.html`, the current app (React-style `.dc.html` page with a 390×844 phone preview), and `artifact-type/reference/format.md` for the `.dc.html` rules. Skim `project/README.md` for how sync works today.

**Where this is going.** The app is being rebuilt as an Expo (React Native) app for iOS, Android and web, backed by Supabase (auth, Postgres, edge functions). The new screens you design are the spec the Expo build will follow, so they must be realistic native mobile UI, not desktop web.

**Visual language. Match the existing page exactly; don't invent a new style.** Dark UI: background `#171615`, raised surfaces `#221f1d` / `#242322`, primary text `#f3efe8` with lower-emphasis text as `rgba(243,239,232,.78 / .45 / .33)`, hairlines `rgba(255,255,255,.12)`, fills `rgba(255,255,255,.06)`, accent `#e8745f` / `#cf7b58`, danger `#ff6b5e`. Category colors are hues stored per category (`cats: {name: hue}`). Reuse the existing bottom-sheet, row, toggle, button and segmented-control patterns and the app font (`var(--appFont)`). Copy the exact style strings from the existing page, the way the Settings sheet and event sheet are built.

**Rules.**
- Do **not** edit `AI Calendar Web.dc.html` or any existing file. Add exactly one new page at the project root (the name is given below), plus any images it needs beside it. Publish it as the canvas instructions describe, sending `project/compat.json` unchanged as the `file_path`. If a publish is refused because someone else saved, read again and redo it once.
- Lay out each screen and state as its own 390×844 phone frame, side by side in a flow left to right. Put a short caption under each frame naming the screen and the state. Where iOS and Android differ meaningfully (system permission dialogs, back navigation, share sheets, widgets), show both.
- For every screen, design the states that matter: default, empty, loading or syncing, error, and offline where relevant.
- Use realistic sample data consistent with the existing page's categories and events. No lorem ipsum.
- Keep copy short and plain, in the same voice as the existing app.
- When done, reply with the page name and a list of the frames you made. Don't screenshot or re-verify.

Your task: design how a user makes an event Private or Public, and where a public event goes.

Today the event sheet in `AI Calendar Web.dc.html` has a single "Share to Google" button (see `gcShareSel`). Replace that concept with:

1. Event sheet, Visibility row. A compact row in the existing event sheet showing "Private" (lock icon) or "Public · 3 calendars" (globe icon + count). It must sit naturally beside the existing title/time/category/repeat rows. Frames: a private event, and a public event on 3 targets.
2. Visibility picker sheet (opens from that row). A Private/Public segmented control at the top. Under Public, a checklist of targets grouped by source with section headers:
   - "Shared calendars" (in-app, each with color dot + member avatars)
   - "Google · alex@gmail.com" (one group per connected Google account; only calendars marked "Can publish to")
   - "On this phone" (device calendars, e.g. iCloud "Home", Exchange "Work")
   Each target row shows its sync status once published: Synced, Pending (spinner), or Failed (with a "Retry" action).
   Frames: Private selected; Public with nothing checked yet (Done disabled, hint text); Public with 3 targets mixed across sources; one target failed; no accounts connected (empty state with "Connect Google" / "Use phone calendars" / "Create shared calendar" shortcuts).
3. Repeating events. When the event is part of a weekly series, changing visibility asks "This event" / "All events in series". Design that prompt.
4. Event blocks in Day / Week / Month views. A subtle indicator on public events (small globe or target-count glyph) that doesn't fight the category color. Show a busy day in the week view with a mix of private and public events.
5. Someone else's event on a shared calendar. A read-only version of the event sheet: owner avatar and name, "On Family calendar", no edit controls, and a "Copy to my calendar" action. Also show how such events look in the week view (e.g. a thin outline or the owner's initials) so they read as "not mine".
6. Category default (optional, small). In the category editor, a "New events in this category are" Private / Public-on-[targets] default. One frame.
```

---

## Prompt 2: Calendars and connected accounts

Page to create: **`Mobile - Calendars & Accounts.dc.html`**

```
**Project.** The Calendar design canvas is https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT, a Claude Design project (Migrated Design type). Read `project/compat.json` first, then `project/AI Calendar Web.dc.html`, the current app (React-style `.dc.html` page with a 390×844 phone preview), and `artifact-type/reference/format.md` for the `.dc.html` rules. Skim `project/README.md` for how sync works today.

**Where this is going.** The app is being rebuilt as an Expo (React Native) app for iOS, Android and web, backed by Supabase (auth, Postgres, edge functions). The new screens you design are the spec the Expo build will follow, so they must be realistic native mobile UI, not desktop web.

**Visual language. Match the existing page exactly; don't invent a new style.** Dark UI: background `#171615`, raised surfaces `#221f1d` / `#242322`, primary text `#f3efe8` with lower-emphasis text as `rgba(243,239,232,.78 / .45 / .33)`, hairlines `rgba(255,255,255,.12)`, fills `rgba(255,255,255,.06)`, accent `#e8745f` / `#cf7b58`, danger `#ff6b5e`. Category colors are hues stored per category (`cats: {name: hue}`). Reuse the existing bottom-sheet, row, toggle, button and segmented-control patterns and the app font (`var(--appFont)`). Copy the exact style strings from the existing page, the way the Settings sheet and event sheet are built.

**Rules.**
- Do **not** edit `AI Calendar Web.dc.html` or any existing file. Add exactly one new page at the project root (the name is given below), plus any images it needs beside it. Publish it as the canvas instructions describe, sending `project/compat.json` unchanged as the `file_path`. If a publish is refused because someone else saved, read again and redo it once.
- Lay out each screen and state as its own 390×844 phone frame, side by side in a flow left to right. Put a short caption under each frame naming the screen and the state. Where iOS and Android differ meaningfully (system permission dialogs, back navigation, share sheets, widgets), show both.
- For every screen, design the states that matter: default, empty, loading or syncing, error, and offline where relevant.
- Use realistic sample data consistent with the existing page's categories and events. No lorem ipsum.
- Keep copy short and plain, in the same voice as the existing app.
- When done, reply with the page name and a list of the frames you made. Don't screenshot or re-verify.

Your task: design how users manage in-app shared calendars and connect external calendars (Google and on-device). Today Settings → Sync in `AI Calendar Web.dc.html` has Supabase URL / anon key fields and one "Google Calendar" connect/disconnect block. Those developer fields are removed in the mobile app.

1. Calendars screen (reachable from Settings and from a calendar-layer button in the view header). Sections:
   - "My calendar" (the personal default; always present)
   - "Shared calendars": rows with color, name, member avatars, your role (Owner / Editor / Viewer), and an eye toggle to show or hide it in views
   - "Google": per account, its calendars with eye toggles
   - "On this phone": device calendars with eye toggles
   Frames: first-run (only My calendar, with call-to-action cards), populated, one Google account needing reconnection (warning row).
2. Calendar layer quick toggle. A compact popover or sheet from the main view header for flipping calendars on and off without leaving the view. One frame over the week view.
3. Create / edit shared calendar. Name, color (reuse the existing hue picker), members list with roles, "Invite by email" field, pending invites with "Resend" / "Cancel", "Leave calendar" (member) or "Delete calendar" (owner, destructive confirm). Frames: create, edit as owner, edit as viewer, delete confirm.
4. Invite acceptance. What an invitee sees on opening an invite link: who invited them, the calendar name and color, and Accept / Decline. Include a signed-out variant ("Sign in to accept").
5. Connect Google. The account row → system OAuth (show iOS ASWebAuthenticationSession sheet and Android Custom Tab as frames) → a "Choose calendars" screen listing that account's calendars with two toggles each: "Show in app" and "Can publish to". Then the account detail screen: last synced time, "Sync now", "Add another Google account", "Disconnect" (destructive confirm explaining imported events will be removed from the app). Frames for each step, plus an error state (access denied).
6. Use phone calendars. A priming screen explaining why we ask, then the iOS and Android system calendar-permission dialogs as frames, then a "Choose calendars" screen with "Show in app" / "Can publish to" toggles. Also a "Permission denied" state with "Open Settings".
7. Settings → Sync, rewritten. Signed-in account row, sync status ("Synced 2 min ago" / "Syncing…" / "Offline, changes will sync later"), links to Calendars and Connected accounts. No URL or key fields anywhere.
```

---

## Prompt 3: Sign-in, onboarding, account and app states

Page to create: **`Mobile - Onboarding & Account.dc.html`**

```
**Project.** The Calendar design canvas is https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT, a Claude Design project (Migrated Design type). Read `project/compat.json` first, then `project/AI Calendar Web.dc.html`, the current app (React-style `.dc.html` page with a 390×844 phone preview), and `artifact-type/reference/format.md` for the `.dc.html` rules. Skim `project/README.md` for how sync works today.

**Where this is going.** The app is being rebuilt as an Expo (React Native) app for iOS, Android and web, backed by Supabase (auth, Postgres, edge functions). The new screens you design are the spec the Expo build will follow, so they must be realistic native mobile UI, not desktop web.

**Visual language. Match the existing page exactly; don't invent a new style.** Dark UI: background `#171615`, raised surfaces `#221f1d` / `#242322`, primary text `#f3efe8` with lower-emphasis text as `rgba(243,239,232,.78 / .45 / .33)`, hairlines `rgba(255,255,255,.12)`, fills `rgba(255,255,255,.06)`, accent `#e8745f` / `#cf7b58`, danger `#ff6b5e`. Category colors are hues stored per category (`cats: {name: hue}`). Reuse the existing bottom-sheet, row, toggle, button and segmented-control patterns and the app font (`var(--appFont)`). Copy the exact style strings from the existing page, the way the Settings sheet and event sheet are built.

**Rules.**
- Do **not** edit `AI Calendar Web.dc.html` or any existing file. Add exactly one new page at the project root (the name is given below), plus any images it needs beside it. Publish it as the canvas instructions describe, sending `project/compat.json` unchanged as the `file_path`. If a publish is refused because someone else saved, read again and redo it once.
- Lay out each screen and state as its own 390×844 phone frame, side by side in a flow left to right. Put a short caption under each frame naming the screen and the state. Where iOS and Android differ meaningfully (system permission dialogs, back navigation, share sheets, widgets), show both.
- For every screen, design the states that matter: default, empty, loading or syncing, error, and offline where relevant.
- Use realistic sample data consistent with the existing page's categories and events. No lorem ipsum.
- Keep copy short and plain, in the same voice as the existing app.
- When done, reply with the page name and a list of the frames you made. Don't screenshot or re-verify.

Your task: design the native-app entry flow and account management. Today sign-in lives inside Settings → Sync (email code, "Continue with Apple", "Continue with Google"). In the mobile app it becomes the first thing a new user sees.

1. Welcome / sign-in screen. App icon (use `project/assets/app-icon.svg` or `calendar-logo-new.svg`), a one-line value prop, "Continue with Apple" (styled to Apple's HIG button rules), "Continue with Google", "Continue with email". On Android, show Google first and Apple below. Both variants as frames.
2. Email code flow. Enter email → "Check your email" with 6-digit code entry (auto-advance boxes, paste support hint, "Resend in 0:42", "Use a different email") → error state (wrong or expired code).
3. First-run setup (2–3 short steps, all skippable). Your name and time zone (pre-filled); "Bring your calendars": Connect Google / Use phone calendars / Not now; notification permission priming (event start reminders and the existing check-in feature) with the iOS and Android system dialogs.
4. Import from the web app. When the account already has data from the old web version (one JSON blob), show a one-time "Bringing over your calendar…" progress state and a done summary ("142 events, 6 goals, 9 categories"). Also the failure state with "Try again" / "Contact support".
5. Account screen (Settings → Account). Avatar/initials, name, email, sign-in method, "Sign out", and "Delete account". Delete must be a clear in-app flow (App Store requirement): explain what's deleted (events, goals, shared calendars you own, Google links), require typing DELETE or a re-auth step, then a final confirmation and a goodbye state.
6. Global states. Offline banner (non-blocking, "Offline · changes will sync"), a sync-conflict toast ("Updated on another device · Undo" — the app already has History/Undo), a session-expired re-sign-in sheet, and a force-update screen.
7. AI settings without keys. Rewrite the "Claude parsing" section of Settings without "Anthropic API key", "proxy", "Test key" or "Test network". Keep model selection, "Ask before scheduling", "Check in when I return" and Skills. Add a usage indicator ("Notes this month: 38") for the server-side AI.
8. Platform chrome. Show the main week view once on iOS (Dynamic Island, home indicator, safe areas) and once on Android (status bar, gesture nav bar, predictive back), so the build knows the insets and where the composer/FAB sits.
```

---

## Prompt 4: Home-screen widgets (agenda + goals)

Page to create: **`Widgets.dc.html`**

```
**Project.** The Calendar design canvas is https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT, a Claude Design project (Migrated Design type). Read `project/compat.json` first, then `project/AI Calendar Web.dc.html`, the current app (React-style `.dc.html` page with a 390×844 phone preview), and `artifact-type/reference/format.md` for the `.dc.html` rules. Skim `project/README.md` for how sync works today.

**Where this is going.** The app is being rebuilt as an Expo (React Native) app for iOS, Android and web, backed by Supabase (auth, Postgres, edge functions). The new screens you design are the spec the Expo build will follow, so they must be realistic native mobile UI, not desktop web.

**Visual language. Match the existing page exactly; don't invent a new style.** Dark UI: background `#171615`, raised surfaces `#221f1d` / `#242322`, primary text `#f3efe8` with lower-emphasis text as `rgba(243,239,232,.78 / .45 / .33)`, hairlines `rgba(255,255,255,.12)`, fills `rgba(255,255,255,.06)`, accent `#e8745f` / `#cf7b58`, danger `#ff6b5e`. Category colors are hues stored per category (`cats: {name: hue}`). Reuse the existing bottom-sheet, row, toggle, button and segmented-control patterns and the app font (`var(--appFont)`). Copy the exact style strings from the existing page, the way the Settings sheet and event sheet are built.

**Rules.**
- Do **not** edit `AI Calendar Web.dc.html` or any existing file. Add exactly one new page at the project root (the name is given below), plus any images it needs beside it. Publish it as the canvas instructions describe, sending `project/compat.json` unchanged as the `file_path`. If a publish is refused because someone else saved, read again and redo it once.
- Lay out each screen and state as its own 390×844 phone frame, side by side in a flow left to right. Put a short caption under each frame naming the screen and the state. Where iOS and Android differ meaningfully (system permission dialogs, back navigation, share sheets, widgets), show both.
- For every screen, design the states that matter: default, empty, loading or syncing, error, and offline where relevant.
- Use realistic sample data consistent with the existing page's categories and events. No lorem ipsum.
- Keep copy short and plain, in the same voice as the existing app.
- When done, reply with the page name and a list of the frames you made. Don't screenshot or re-verify.

Your task: design home-screen widgets that show the agenda plus goals. The user wants something as close to "the app on the home screen" as each OS allows. Read how goals are shown in the existing page (goal sheet, progress, hours done vs `hours`, `deadline`) and how events and categories are colored, then design:

Platform limits (design within them, and note them on the page):
- iOS WidgetKit: no scrolling, no text input, no arbitrary animation. Interactivity is limited to buttons and toggles (App Intents, iOS 17+) and tap-to-deep-link. Content updates on a timeline (plan entries at each event start/end). Largest iPhone size is Large (about 338×354 pt on a 390-wide iPhone, 364×382 pt on Pro Max); iPad also has Extra Large. Widgets must also render in the tinted/accented and clear home-screen styles.
- Android (react-native-android-widget / RemoteViews): resizable in cells from 4×2 up to full screen; lists can scroll; buttons and deep links allowed; system corner radius applies; optional Material You dynamic color.

Frames to make (place each widget on a realistic home-screen mock with wallpaper and app icons around it, at true scale):
1. iOS Large, primary. Header with today's date and a "now" marker; the next ~6 events as rows (category color bar, time, title, a done check button for tasks); a goals strip at the bottom (2–3 goals with progress bars, "12 / 40h", "due in 9 days"); a "+" button that deep-links to the note composer. Show: normal day, a day with an event in progress (live progress or "ends in 25 min"), an empty day ("Nothing scheduled. Add a note"), signed out, and the tinted/accented rendering mode.
2. iOS Medium and Small (secondary). Medium: next 3 events + 1 goal. Small: next event + time until it.
3. iPad Extra Large. Agenda list on the left, goals on the right, today/tomorrow split.
4. Android, full-screen resize. The "app on the home screen" version: scrollable agenda across today, tomorrow and the next few days with sticky day headers, goals section at the top or bottom, "+" and refresh buttons. Also show the same widget at 4×2 and 4×4 to show how it degrades.
5. Interaction annotations. Callouts for what each tap does: event row opens that event in the app, check marks the task done without opening the app, goal opens the goal sheet, "+" opens the composer. Note what data the widget needs offline (a snapshot the app writes to shared storage).
6. Stale and edge cases. "Last updated 3h ago" treatment, private vs public events (use the same glyph as the app), shared-calendar events from others (owner initials).
```

---

## Prompt 5: Integration and consistency pass (run after 1–4)

Page to create: **`Mobile - Index.dc.html`** (and edits to the four pages made by prompts 1–4)

```
**Project.** The Calendar design canvas is https://claude.ai/artifact/6VyaDwRC9HtXvPP8HTQ2nT, a Claude Design project (Migrated Design type). Read `project/compat.json` first, then `project/AI Calendar Web.dc.html`, the current app (React-style `.dc.html` page with a 390×844 phone preview), and `artifact-type/reference/format.md` for the `.dc.html` rules. Skim `project/README.md` for how sync works today.

**Where this is going.** The app is being rebuilt as an Expo (React Native) app for iOS, Android and web, backed by Supabase (auth, Postgres, edge functions). The new screens you design are the spec the Expo build will follow, so they must be realistic native mobile UI, not desktop web.

**Visual language. Match the existing page exactly; don't invent a new style.** Dark UI: background `#171615`, raised surfaces `#221f1d` / `#242322`, primary text `#f3efe8` with lower-emphasis text as `rgba(243,239,232,.78 / .45 / .33)`, hairlines `rgba(255,255,255,.12)`, fills `rgba(255,255,255,.06)`, accent `#e8745f` / `#cf7b58`, danger `#ff6b5e`. Category colors are hues stored per category (`cats: {name: hue}`). Reuse the existing bottom-sheet, row, toggle, button and segmented-control patterns and the app font (`var(--appFont)`). Copy the exact style strings from the existing page, the way the Settings sheet and event sheet are built.

**Rules.**
- Do **not** edit `AI Calendar Web.dc.html` or any existing file. Add exactly one new page at the project root (the name is given below), plus any images it needs beside it. Publish it as the canvas instructions describe, sending `project/compat.json` unchanged as the `file_path`. If a publish is refused because someone else saved, read again and redo it once.
- Lay out each screen and state as its own 390×844 phone frame, side by side in a flow left to right. Put a short caption under each frame naming the screen and the state. Where iOS and Android differ meaningfully (system permission dialogs, back navigation, share sheets, widgets), show both.
- For every screen, design the states that matter: default, empty, loading or syncing, error, and offline where relevant.
- Use realistic sample data consistent with the existing page's categories and events. No lorem ipsum.
- Keep copy short and plain, in the same voice as the existing app.
- When done, reply with the page name and a list of the frames you made. Don't screenshot or re-verify.

Exception to the rules above: you may edit these four pages, made by earlier agents: `Mobile - Event Visibility.dc.html`, `Mobile - Calendars & Accounts.dc.html`, `Mobile - Onboarding & Account.dc.html`, `Widgets.dc.html`. Still do not edit `AI Calendar Web.dc.html` or any other existing file.

Your task: make the four new pages read as one system, and add an index.

1. Read all four pages and `AI Calendar Web.dc.html`. List the inconsistencies between them: icons (lock/globe/sync glyphs), names ("Shared calendars" vs "Calendars"; "Public" vs "Shared"; "On this phone" vs "Device"), sheet header styles, toggle styles, status colors, avatar treatment, empty-state patterns.
2. Pick one answer for each and apply it across the four pages. Prefer whatever already exists in `AI Calendar Web.dc.html`.
3. Check every flow connects: event sheet → visibility picker → "Connect Google" shortcut → Connect Google flow → back to picker with targets available; invite email → invite acceptance → calendar appears in the Calendars screen and the layer toggle; sign-in → first-run → import → week view. Add any missing connecting frame.
4. Create `Mobile - Index.dc.html`: a single page listing every flow with a thumbnail-sized frame per screen in order, the fixed vocabulary (glossary of the terms chosen in step 2), the shared components (visibility row, target row with sync status, calendar row with eye toggle, account row, offline banner) shown once each as a reference sheet, and an "Open questions" list for anything you had to guess.
5. Reply with the list of changes you made per page and the open questions.
```
