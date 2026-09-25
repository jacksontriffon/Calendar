---
name: push-to-main
description: Use whenever committing or pushing changes in this repository. This is a single-maintainer repo with no review workflow — changes go straight to main instead of sitting on a feature branch or PR.
---

# Push straight to main

This repo (`jacksontriffon/Calendar`) is a single-file, single-maintainer calendar app. There's no reviewer and no CI gating merges, so the default workflow adds nothing but friction. Skip it:

1. Make the change, commit it as usual with a clear message.
2. If the session put you on some other branch (e.g. an auto-generated dev branch), push straight to `main` — never publish that branch to the remote:
   ```
   git push origin <current-branch>:main
   ```
   (Fast-forward when possible; merge locally first only if `main` has diverged.) Do not also run `git push -u origin <current-branch>` — that creates a stray remote branch that just has to be cleaned up later. There should never be more than `main` on the remote.
3. If a local hook complains about "unpushed commits" on the dev branch after step 2, that's just the local branch missing an upstream — don't fix it by pushing the branch remotely. Instead point it at `main`:
   ```
   git fetch origin main && git branch --set-upstream-to=origin/main <current-branch>
   ```
4. Don't open a pull request for routine changes. A GitHub Actions workflow (`.github/workflows/auto-merge.yml`) auto-merges any PR that does get opened against `main`, so nothing gets stuck waiting on review either way.

Only deviate from this — working on a separate branch, opening a real PR, pushing a branch to the remote — if the user explicitly asks for that in a given request.
