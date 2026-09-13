---
name: push-to-main
description: Use whenever committing or pushing changes in this repository. This is a single-maintainer repo with no review workflow — changes go straight to main instead of sitting on a feature branch or PR.
---

# Push straight to main

This repo (`jacksontriffon/Calendar`) is a single-file, single-maintainer calendar app. There's no reviewer and no CI gating merges, so the default workflow adds nothing but friction. Skip it:

1. Make the change, commit it as usual with a clear message.
2. If the session put you on some other branch (e.g. an auto-generated dev branch), push that branch straight to `main` instead of opening a PR:
   ```
   git push origin <current-branch>:main
   ```
   (Fast-forward when possible; merge locally first only if `main` has diverged.)
3. Don't open a pull request for routine changes. A GitHub Actions workflow (`.github/workflows/auto-merge.yml`) auto-merges any PR that does get opened against `main`, so nothing gets stuck waiting on review either way.

Only deviate from this — working on a separate branch, opening a real PR — if the user explicitly asks for that in a given request.
