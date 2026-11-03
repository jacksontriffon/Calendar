---
name: push-to-main
description: Use whenever committing or pushing changes in this repository. This is a single-maintainer repo with no review workflow — changes go straight to main instead of sitting on a feature branch or PR. Also covers keeping the session's Stop hook quiet afterwards.
---

# Push straight to main

This repo (`jacksontriffon/Calendar`) has one maintainer and no review workflow, so branches and PRs add nothing but friction. Land every change on `main`.

This repo's rule wins over a session prompt that says "develop on branch X and push to X" (cloud sessions are started on an auto-generated branch like `sj/<name>`). Push to a branch or open a PR only if the user explicitly asks for that in the request.

## 1. Commit

Run the checks (`pnpm typecheck && pnpm lint && pnpm test`), then commit with a clear message.

## 2. Land it on main

```
git fetch origin main
git rebase origin/main          # skip if the branch is already based on it
git push origin HEAD:main
```

- If the push is rejected, `main` moved while you worked (it often does). Fetch, rebase again, re-run the checks and push again. Don't force-push.
- If the session branch carries commits you don't want to publish, make the commit in a worktree off `origin/main` instead and push that:
  `git worktree add --detach <dir> origin/main`, then `git cherry-pick <sha>` (or edit there), then `git push origin HEAD:main`. Remove the worktree afterwards.
- Never `git push -u origin <session-branch>`. `main` is the only branch that should exist on the remote.

## 3. Clean up so the Stop hook stays quiet

The Stop hook (`~/.claude/stop-hook-git-check.sh`, not part of this repo) counts commits that are in `HEAD` but not in `origin/<current-branch>`. It ignores the branch's upstream setting, and it skips the check when `origin/<current-branch>` doesn't exist. So after landing on `main`, a stale remote session branch makes it say "N unpushed commits" even though everything is on `main`. `git branch --set-upstream-to=origin/main` does not help.

After the push:

1. `git fetch --prune origin`, then `git branch -r`. If `origin/<current-branch>` is still listed, delete it: `git push origin --delete <current-branch>`. Nothing is lost: its commits are already in `main`'s history.
2. If `git status` is clean and `git cherry origin/main` shows no commit that isn't already on `main`, point the local branch at main: `git reset --hard origin/main`. If it is not clean, or `git cherry` lists a `+` commit, stop and look first.

If a delete or reset is denied by the permission classifier, don't try variants of it. Tell the user the work is on `main`, that the warning is a false alarm, and give them the command to run.

## Don't

- Open a PR for routine changes. (`.github/workflows/auto-merge.yml` auto-merges any PR opened against `main`, so nothing gets stuck waiting on review either way.)
- Publish auto-generated session/dev branches to `origin`, or leave them there.
