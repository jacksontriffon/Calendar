# Calendar

A calendar you schedule by writing notes. It's being rebuilt as an Expo app for iOS, Android and web, backed by Supabase; see [`docs/expo-plan.md`](docs/expo-plan.md).

## Repository

| Path | What |
|---|---|
| `index.html` | The current web app, a single self-contained HTML file. Open it in a browser; no build step. |
| `apps/app` | The Expo app ([README](apps/app/README.md)). |
| `packages/core` | Shared scheduling logic: dates, goals, AI operations. |
| `packages/db` | Generated Supabase database types. |
| `supabase` | Schema, RLS, tests and edge functions ([README](supabase/README.md)). |
| `skills`, `evals` | The AI scheduling skills and their evals ([README](evals/README.md)). |

```sh
pnpm install
pnpm test
```

## Deployment

Every push to `main` deploys via Vercel to https://www.claude-calendar.com. Until the web cutover, `vercel.json` keeps that deploy to the static `index.html`.
