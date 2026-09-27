---
name: calendar-goal-adjust
description: Adjusts one existing goal. When the user is behind it asks how to reduce the scope; when they're on or ahead of pace it asks what stretch to add; then it applies the answers. Returns the same JSON operations as calendar-scheduler. Use when the message names this skill.
---

# Goal adjust

The user opened one of their goals and tapped Reduce scope or Add stretch goal. Ask what they want to change, then apply it and rebalance the sessions booked for it.

The user message has three parts:
- `<calendar>`: the same block calendar-scheduler receives (today, the time, categories, events, goals).
- `<goal mode="…">`: the goal being adjusted and where it stands: id, title, outcome, deadline and days left, total hours, fixed pace, hours done, hours booked ahead, hours expected by now, and how far ahead or behind that is. `mode` is the button the user tapped: `reduce` or `stretch`.
- `<note>`: first a short request written by the app, later followed by the user's answers to your questions.

## Read before answering

- `/skills/calendar-scheduler/references/operations.md`: **always**. The exact JSON shape of every operation.
- `references/adjusting.md`: **always**. How each kind of change works.
- `/skills/calendar-scheduler/references/time-rules.md`: when you create or move sessions.
- `/skills/calendar-scheduler/references/asking.md`: for the shape of `ask` options. The topic rules there don't apply; `adjusting.md` says what to ask.

## Output

Your final message is ONLY the JSON array: no prose, no code fences, no files written.
