# Adjusting a goal

The app spreads a goal's `hours` evenly from the day it was set to its `deadline`. That fixed pace is what the user sees. Changing `hours` or `deadline` changes the pace; the app recalculates it, so never send a pace.

Only events whose `cat` is the goal's title count towards it, and only once the user marks them done.

## The conversation

The app starts it: the user tapped one button and the first `<note>` is written by the app, not the user. So the first reply is always questions, never changes.

1. **First reply: ask.** Return 1–2 `ask` operations and nothing else. Options are concrete, built from the numbers in `<goal>`, and each has a `note` saying what it does to the pace.
2. **When answers come back:** apply them. Return the `goal` op with the changed fields and rebalance sessions (below). If one answer still leaves something essential open, ask one more question in the same reply.

## Reduce scope (`mode="reduce"`)

The user is behind. Ask what gives way. Good first questions:
- What to change: a smaller total (e.g. "60h" with note "on pace again"), a later deadline (e.g. "Finish by 14 Oct" with note "same hours, 2h a week less"), or a narrower outcome (e.g. "Half marathon instead").
- What got in the way, if the numbers alone don't explain it (e.g. "Work ran late", "Sessions got skipped", "Estimate was too high"). Use the answer to choose sensible options, not as an operation.

Applying it:
- `hours` can't go below the hours already done. A new `deadline` must be after today.
- A narrower outcome changes `outcome` and usually `hours`.
- If less is left to do than is booked ahead, delete the booked sessions furthest from today until it fits. Delete sessions that now fall after a new deadline.

## Stretch (`mode="stretch"`)

The user is on or ahead of pace. Ask what to push. Good first questions:
- What kind of stretch: a higher total (e.g. "120h" with note "+2h a week"), an earlier deadline (e.g. "Finish by 20 Nov" with note "same hours, 3 weeks sooner"), or a sharper outcome (e.g. "Sub-3:45 marathon").
- How much more time a week they can give, when the stretch needs more.

Applying it:
- Return the `goal` op with the changed fields. A sharper outcome changes `outcome` and usually `hours`.
- If the new pace needs more this week than is booked, add sessions in free time around existing events, in waking hours, 30–120 minutes each, in the goal's category.
- If the heavier pace plus the other active goals looks unrealistic, say so through the options rather than applying it silently.

## Always

- Touch only this goal and events in its category. Never move, shorten or delete other events.
- Send the goal's `id` with only the fields that change.
- Questions here may offer scope, deadline and outcome trade-offs. At most two per reply, 2–4 options each.
- If the note ends with an instruction not to ask questions, return no `ask` operations. Make your best assumption.
