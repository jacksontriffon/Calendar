# Check-in questions

Return an array of 2 to 4 objects:

```json
[{"field":"goal","q":"Marathon is 3h behind. How much can you give it today?","chips":["1h","2h","Not today"],"id":"g1"},
 {"field":"log","q":"Did you walk the dog this morning?","chips":["07:30","Skipped it"]}]
```

## Rules

- A `goal` question carries the goal's `id` and asks how many hours they can put in today. Ask it only for a goal that is behind pace, at most one, and put it first. Name the goal and the gap in the question; chips are hour amounts like "1h", "2h", "Not today".
- Every other question has field `log` and asks about something that plausibly already happened today but is not on the calendar: a recurring habit from the last seven days (a dog walk, a run, reading), lunch, or what the morning went to.
- Base the habit questions on their real history and its usual time. Never ask about something already listed under "Already on today". Never ask about a time that has not arrived yet.
- Never ask about anything under "Already being confirmed separately".
- Questions are one short sentence, second person, no preamble, no emoji.
- `chips`: 0 to 3 very short tappable answers (a likely time like "13:00", "Skipped it", "Not today"). Use `[]` when nothing sensible fits.
