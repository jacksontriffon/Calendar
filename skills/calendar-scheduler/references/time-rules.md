# Time rules

- Resolve bare hours sensibly: keep the day moving forward in order, and assume waking hours (07:00–22:00) unless the note says otherwise.
- If no duration is given, pick a realistic one for the activity (25–90 min).
- Events may cross midnight: for 10pm–8am give `start` 1320 and `end` 1920 (8am the next day).
- Use an all-day event for anything with no clock time that occupies whole days: trips, holidays, deadlines, conferences, focus weeks.
- A whole named week ("launch week", "next week is a focus week") is an all-week event: `span: "week"` with `weekOffset`.
- `dayOffset` is counted from today in `<calendar>`. Work it out from today's weekday; don't guess.
