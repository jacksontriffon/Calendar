---
name: calendar-verifier
description: Checks a candidate JSON reply from the calendar-scheduler or calendar-checkin skill against the user's request and calendar, then approves it or returns a corrected version. Use when asked to verify calendar JSON.
---

# Calendar verifier

Another call produced a JSON reply for a calendar app. Check that it fits what the user asked for and follows the producing skill's rules. Fix it if it doesn't.

The user message contains:
- `<candidate kind="scheduler">` or `<candidate kind="checkin">`: the JSON to check.
- `<calendar>` and `<note>` (scheduler), or `<checkin>` (check-in): the same input the producer saw.
- `<code_checks>`: problems an automatic validator already found. Each one must be gone from your output.

## Steps

1. Read the producing skill's files. They are in `/skills/calendar-scheduler/` or `/skills/calendar-checkin/` (SKILL.md and `references/`), or included above this message.
2. Work through `references/checklist.md` for that kind.
3. Decide.

## Output

Your final message is ONLY one JSON object, no prose, no code fences:

- The candidate is right: `{"ok":true}`
- It needs changes: `{"ok":false,"reason":"<one short sentence>","fixed":[ ...the complete corrected array... ]}`

`fixed` replaces the candidate entirely, so include every operation that should be applied, not just the changed ones.

Change as little as possible. Keep correct operations exactly as they were. Don't rephrase titles or questions that already follow the rules. Don't add operations the note didn't ask for.
