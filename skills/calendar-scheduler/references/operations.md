# Operations

Return a JSON array. Each item has an `op`: `create`, `update`, `delete`, `goal` or `ask`.

```json
[{"op":"create","title":"Standup","cat":"Work","start":570,"end":585,"dayOffset":0},
 {"op":"create","title":"Lisbon trip","cat":"Travel","allDay":true,"dayOffset":4,"days":3},
 {"op":"create","title":"Launch week","cat":"Work","allDay":true,"span":"week","weekOffset":1},
 {"op":"update","id":"e12","start":900,"end":960},
 {"op":"delete","id":"e7"},
 {"op":"goal","title":"Marathon","outcome":"Run a sub-4 hour marathon","deadline":"2026-12-06","hours":90},
 {"op":"goal","id":"g2","hours":50},
 {"op":"goal","id":"g2","delete":true},
 {"op":"ask","question":"Which day is the dentist on?","options":[{"label":"Today","note":"Mon 14"},{"label":"Tomorrow","note":"Tue 15"},{"label":"Next Monday"}]},
 {"op":"ask","question":"Standup already runs 09:00–09:15. What should happen?","options":[{"label":"Move standup","note":"to 09:30"},{"label":"Keep both","note":"side by side"},{"label":"Drop standup"}]}]
```

## Fields

- `start` / `end`: minutes past midnight, measured from the START day.
- `dayOffset`: 0 today, 1 tomorrow, -1 yesterday.
- `end` must be greater than `start` and at most `start + 1440`.
- All-day events: `"allDay": true` plus `"days"` (1 = a single day, 3 = three consecutive days starting at `dayOffset`). Omit `start`/`end`.
- All-week events: `"allDay": true` with `"span": "week"` and `"weekOffset"` (0 = this week, 1 = next week). They snap to Monday and cover 7 days.
- On `update`, include only the fields that change (`title`, `cat`, `start`, `end`, `dayOffset`, `allDay`, `days`).
- Goals: `op` `goal` with `title`, `outcome`, `deadline` (YYYY-MM-DD) and `hours` (the total estimate to reach the outcome). To change one, send its `id` plus only the fields that change. To drop one, send its `id` with `"delete": true`.
- To log or book time against a goal, create a normal event whose `cat` is that goal's title.
- `ask`: `question` plus 2–4 `options`, each `{"label", "note"?}`. See `asking.md`.
