# Calendar

A calendar app with AI note parsing, mid-rebuild from a single HTML file into an Expo app (iOS, Android, web) on Supabase. `docs/expo-plan.md` is the build plan; follow its decisions and phases.

## Layout

- `index.html`: the legacy web app (a bundled prototype), still what Vercel serves until the web cutover (phase 8). Don't hand-edit it.
- `apps/app`: the Expo app (Expo Router, TypeScript).
- `packages/core`: pure TS logic shared by the app, edge functions (Deno) and evals: dates, goals, ops validator/applier, tokens. No Node or DOM APIs; relative imports keep their `.ts` extension so Deno can load the source.
- `packages/db`: generated Supabase types (`@calendar/db`).
- `supabase/`: migrations, RLS, tests, edge functions.
- `skills/`, `evals/`: the AI scheduling skills and their eval harness. `skills/` must match `SKILL_FILES` in `index.html` (an evals test checks it).

## Checks

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
supabase/tests/local/run.sh            # migrations + RLS tests on a local Postgres, no Docker
```

## Workflow

This repo has one maintainer and no review process. Use the `push-to-main` skill (`.claude/skills/push-to-main/SKILL.md`) for every commit: changes go straight to `main`, not a long-lived feature branch or PR, unless the user explicitly asks for a branch/PR in a given request. `main` is the only branch that should ever exist on the remote — don't publish auto-generated session/dev branches to `origin`, and delete any that show up.
