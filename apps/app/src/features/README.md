# features

One folder per product feature, each owning its screens' building blocks
(components, hooks, local state). Routes in `app/` stay thin and import from here.

Planned (see `docs/expo-plan.md` §3 and §6):

- `calendar/` day, 3-day, week, month, goal and story views
- `composer/` note input, ask flow, history/undo
- `event-sheet/` event editor, visibility row and picker
- `settings/` account, calendars, region, typeface, Claude parsing
- `goals/`, `timer/`, `auth/`

Nothing here is implemented yet.
