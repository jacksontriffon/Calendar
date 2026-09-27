# Checklist

## kind="scheduler"

Fit to the note
- Every distinct activity, change or cancellation in the note has exactly one operation.
- Nothing is created, changed or deleted that the note didn't refer to.
- Titles are short, capitalised and in the user's own words.

Days and times (`time-rules.md`)
- `dayOffset` matches the day the note means, counted from today in `<calendar>`.
- Bare hours land in waking hours unless the note says otherwise; times move forward in order.
- `end > start` and `end <= start + 1440`; overnight events use an `end` past 1440.
- Whole-day things are all-day events with `days`; named weeks use `span: "week"`.

Existing events
- Every `update` and `delete` id exists in `<calendar>` and is the event the user meant.
- Moves and renames use `update`, never delete plus create.
- `update` carries only the fields that change.
- Categories reuse existing ones when they fit.

Goals (`goals.md`)
- A new goal has `title`, `outcome`, `deadline` (YYYY-MM-DD, in the future) and `hours`, all taken from what the user said or picked, not guessed. If any is missing, the reply asks for it instead.
- The reply is at the right step of the goal conversation for what the note contains.
- Goal time is booked as events whose `cat` is the goal's title.

Asking (`asking.md`)
- At most three `ask` operations, each with 2–4 concrete options.
- Questions are only about the day, which event, or a clash. Never duration, category or wording.
- Replies that ask contain no create/update/delete, except inside the goal conversation.
- If the note says not to ask, there are no `ask` operations.

## kind="goal-adjust"

Rules are in `/skills/calendar-goal-adjust/references/adjusting.md`.

- Only the goal in `<goal>` and events in its category are touched.
- The `goal` op uses that goal's `id` and carries only the fields that change.
- A new `deadline` is YYYY-MM-DD and after today. New `hours` is not below the hours already done.
- If the note has no answers yet, the reply is only 1–2 `ask` operations, fitting `mode` (`reduce`: what gives way; `stretch`: what to push), with concrete options that each carry a pace `note`.
- Once answers are present, the changes match what the user picked.
- Booked sessions after a new deadline, or beyond a reduced total, are deleted. New sessions are in the goal's category, in free time and waking hours, 30–120 minutes each.
- At most two `ask` operations, 2–4 options each. None if the note says not to ask.

## kind="checkin"

- 2 to 4 objects, each with `field` ("goal" or "log") and `q`; `chips` has 0–3 items.
- At most one `goal` question; it comes first, its `id` exists, and that goal is behind pace.
- No question about anything under "Already on today" or "Already being confirmed separately".
- No question about a time that hasn't arrived yet.
- `log` questions come from real habits in the last seven days, lunch, or the morning.
- One short sentence each, second person, no preamble, no emoji.
