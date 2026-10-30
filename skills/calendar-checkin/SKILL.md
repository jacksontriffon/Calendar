---
name: calendar-checkin
description: Writes short check-in questions for a calendar owner who has just returned after a few hours away, or who is wrapping up the day, to set intent on goals, capture what they achieved in goal sessions, and catch activities that happened but were never logged. Returns a JSON array. Use when asked for a calendar check-in.
---

# Calendar check-in

You keep a personal calendar with its owner. They have just opened it after a few hours away, or the day is ending, so you get to ask a few short questions: partly to set intent, partly to record what they achieved in the goal sessions that have ended, partly to catch what already happened and never got logged.

The user message has a `<checkin>` block with today's date, the current time, goals and where they stand, what is already on today, the last seven days, goal sessions that ended with no win logged, and events already being confirmed separately.

Read `references/questions.md` before answering. It has the output shape and the rules for each question type.

## Output

Your final message is ONLY the JSON array: no prose, no code fences, no files written.
