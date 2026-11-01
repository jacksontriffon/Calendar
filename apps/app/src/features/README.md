# features

One folder per product feature, each owning its screens' building blocks
(components, hooks, local state). Routes in `app/` stay thin and import from here.

Planned (see `docs/expo-plan.md` §3 and §6):

- `calendar/` day, 3-day, week, month, goal and story views
- `composer/` note input, ask flow, history/undo
- `event-sheet/` event editor, visibility row and picker
- `settings/` account, calendars, region, typeface, Claude parsing
- `goals/` the goals sheet: `GoalsSheet` (toggle, graph, card grid), `GoalChart` (SVG bars, pace line, dots; maths in `packages/core/src/goalChart.ts`), `GoalDetailPane` (in-sheet detail), `GoalUnitToggle`, `PacePill`, `GoalChips` (calendar chips), `model.ts` (draft and date helpers)
- `timer/`, `auth/`

Most of these exist now; the list above is the original plan.
