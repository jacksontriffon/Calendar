# Scheduler evals

Checks that a single note turns into the right calendar changes (create, update, delete, or a clarifying question).

Each case runs through the real `index.html` in headless Chromium, not a copy of its logic. The harness:
1. seeds the calendar from `cases/calendar.json` through localStorage,
2. pins the clock (Wed 23 Sep 2026, 09:00),
3. calls the app's own `askClaude()`, which runs the prompt builder, the scheduler skill, `checkOps()`, the verifier and `fromModel()`,
4. forwards the app's API requests to Anthropic unchanged, except for `--model` if given.

What gets graded is what the app would apply, both after the verifier (**Final**) and without it (**Scheduler only**). That shows how much the verifier helps, and when it breaks a correct answer.

## Run

```sh
cd evals
npm install
npm test                                        # grader + skills-sync checks, no API calls
ANTHROPIC_API_KEY=sk-... npm run eval           # 20 cases × 3 trials on the app default (Haiku 4.5)
ANTHROPIC_API_KEY=sk-... npm run eval -- --model claude-sonnet-5 --trials 5
ANTHROPIC_API_KEY=sk-... npm run eval -- --only ask,update-rename    # case ids or categories
```

Options:
- `--trials N`: runs per case (default 3). Output varies between runs, so the score is a pass rate, not a single pass/fail.
- `--model ID`: overrides the model in every request.
- `--transport inline|skills`: `inline` (default) sends the skills in the system prompt, as the app's fallback and host mode do. `skills` uploads them to your workspace once and uses the Skills API + code execution, as the app does with a real key.
- `--save-baseline`: writes `results/baseline.json`. Later runs are compared against it.

The run prints a table per case and per category, and writes every record (ops, grader reasons, raw token usage) to `results/runs/`.

## The standard

`standard.json` sets the bar. A run exits non-zero if any of these fail:
- the overall final pass rate is at least `minPassRate`,
- every category is at least `minCategoryPassRate`,
- no case drops more than `maxCaseDropVsBaseline` compared with the saved baseline.

## Adding a case

Append to `cases/scheduler.json`, or add another `cases/*.json` file holding an array:

```json
{
  "id": "update-move-lookalike",
  "category": "update",
  "note": "move the design review to friday at 2pm",
  "noAsk": false,
  "events": null,
  "expect": { "updates": [{ "id": "e3", "patch": { "day": "2026-09-25", "start": 840 } }] }
}
```

- `events`: optional. It replaces the calendar's events for this case only.
- `noAsk: true`: appends the app's "don't ask" suffix to the note.

`expect` is strict. Every change the model makes must be listed, and anything extra fails the case.
- `creates`: new events, matched in any order. Fields: `day` (`YYYY-MM-DD`); `start`, `end`, `days` (a number or `[min, max]`); `allDay`; `title` (case-insensitive regex); `cat` (a name or a list of names).
- `updates`: `{ "id": "e3" | ["e1","e4"], "patch": {…fields as above}, "keep": ["day", …] }`. `keep` fails the case if the update changes those fields.
- `deletes`: the exact set of ids.
- `asks: true`: must ask at least one question and change nothing.
- `safe: true`: must change nothing. Asking, or an empty reply, is fine.

A case also fails if the app's own `checkOps()` flags the final reply.

Times are minutes past midnight (`840` = 14:00). Event ids and dates are in `cases/calendar.json`.
