# Calendar skills

Agent Skills used by the calendar's AI.

- `calendar-scheduler`: note → JSON operations (events, goals, questions)
- `calendar-checkin`: return check-in questions
- `calendar-verifier`: checks every reply from the two skills above and fixes it if needed

## How the app uses them

When you use your own API key or a proxy, the app uploads these skills to your workspace (`POST /v1/skills`) the first time it needs them, and saves the skill ids in the browser. It uploads a new version whenever `SKILLS_V` in the app changes. Requests go through the code execution tool with `container.skills`, and Claude opens the reference files it needs.

The built-in preview connection doesn't support skills. There, the same files are sent inline in the prompt.

Each request runs in two passes:
1. The scheduler or check-in skill produces JSON.
2. A code validator checks the JSON's shape, then the verifier skill checks it against the request and returns `{"ok":true}` or a corrected array. The fixed version is applied without telling the user. There is one fix round.

## Editing

The app embeds a copy of these files (`SKILL_FILES` in `AI Calendar Web.dc.html`). After you edit a file here, update the embedded copy and bump `SKILLS_V`.

Then run the evals in `../evals` (see its README). `npm test` fails if the embedded copy no longer matches these files, and `npm run eval` checks the scheduler against the standard.
