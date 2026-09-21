---
name: worktree-cleanup
description: Prune merged feature worktrees, fast-forward the root checkout's main from origin/main, reinstall deps, and refresh the "Active worktrees" row in docs/diary.md. Invoke as `/worktree-cleanup` (or `/worktree-cleanup --dry-run` to preview). Conservative — never removes dirty or unmerged worktrees.
---

# /worktree-cleanup — prune merged worktrees + sync the root checkout

## What this does

Closes the worktree lifecycle that ADR-025 opens: agents create `worktree/<slug>` per feature, but after the PR merges the worktree, its local branch, and the diary's "Active worktrees" row are left behind, and the root checkout's `main` goes stale (so the next worktree branches from an old base and pays a merge-reconciliation tax later).

The git mechanics live in `scripts/worktree-cleanup.sh`; this skill runs it and then does the one thing a script can't do well — update the diary.

## Hard rules

1. **Never force-remove.** The script already skips dirty or unmerged worktrees; do not override it with `git worktree remove --force` or `git branch -D` on a kept branch.
2. **Never touch uncommitted work in the root checkout.** If the script reports the root as dirty, surface that to the operator; don't stash or commit on their behalf.
3. **Diary edits follow the update protocol** (`docs/diary.md` header): refresh the **"Active worktrees"** row in the Current state block; don't rewrite or delete historical entries.

## Procedure

1. **Dry-run first** and show the operator what would happen:

   ```bash
   scripts/worktree-cleanup.sh --dry-run
   ```

2. **Run for real** (skip step 1's pause if the operator invoked the skill with a clear "clean up" intent — the script is conservative by design):

   ```bash
   scripts/worktree-cleanup.sh
   ```

3. **Update `docs/diary.md`**: set the "Active worktrees" row in the Current state table to the worktrees that remain (or "none — root checkout in sync with origin/main" if empty). If the row was stale before this run, say so in the next dated diary entry rather than silently fixing history.

4. **Report** the script's summary block plus the diary edit: main before → after, worktrees removed, worktrees kept and why.

## What "merged" means here

A branch is pruned when it is an ancestor of `origin/main` (normal signed merge commits, ADR-0044) **or** its PR is `merged` per `gh pr list --head <branch> --state merged` (covers squash merges, which rewrite commits so ancestry fails). Anything else is kept.

## Cross-references

- ADR-025 (worktree-per-feature mandate) — why the worktrees exist.
- ADR-0044 (signed merge commits) — why ancestry-based merge detection works for the default path.
- ADR-0077 (operator-side merge train) — `/merge-train` runs this skill as its final step.
