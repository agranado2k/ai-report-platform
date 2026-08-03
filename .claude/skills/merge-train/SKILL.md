---
name: merge-train
description: Serially land a batch of green PRs as signed web-flow merge commits — migration-aware ordering, GitHub update-branch for stale PRs, wait for prod migrate/release between merges, then run /worktree-cleanup. Invoke as `/merge-train` (discover all green PRs) or `/merge-train <PR#> [<PR#>…]` (explicit batch). Operator-invoked only; complements /pr-iterate, which never merges.
---

# /merge-train — serialized landing of a green PR batch

## What this does

Parallel worktree agents (ADR-025) produce batches of PRs that each go green in isolation. Landing them is where the manual toil and the risk concentrate: the operator clicks "Create a merge commit" N times, each merge instantly makes the surviving PRs stale against `main`, and every merge auto-applies Drizzle migrations to prod (`migrate-db.yml`), so **order matters**.

This skill is the operator-side merge train (ADR-0077): it merges a batch **one PR at a time through GitHub's own API**, re-validating between merges. It is the explicit, operator-delegated counterpart to `/pr-iterate`'s hard rule "you never merge" — that rule still stands; `/merge-train` is a separate skill the operator invokes when they've decided the batch should land.

Everything stays inside branch protection: `gh pr merge --merge` and the update-branch API both produce **GitHub web-flow-signed merge commits**, exactly like the UI button (ADR-0044). Nothing is bypassed, rebased, or force-pushed.

## Hard rules — do not break

1. **Only the operator starts a train.** Never invoke this from another skill, a loop, or on your own initiative.
2. **A PR boards the train only if**: all required checks are green, it is not a draft, and no human review requests changes. Bot reviews are advisory (ADR-030) and don't block.
3. **Merge method is `--merge`** (signed merge commit, ADR-0044). Never `--rebase` (GitHub can't sign it; disabled repo-side anyway). `--squash` only if the operator explicitly asks for that PR — and then the PR title must be Conventional-Commits-compliant (it becomes the commit subject driving semantic-release).
4. **Never** `--admin`, never touch branch protection, never force-push, never merge locally and push.
5. **Stale PRs are updated via GitHub's update-branch API only** — a local rebase would strip signatures (the exact failure ADR-0044 escaped).
6. **A failed prod migration stops the train dead.** If `migrate-db` fails on `main` after a merge, do not merge anything else; escalate immediately.
7. **When in doubt, stop the train and report.** A half-landed batch in a known state beats a fully-landed batch in an unknown one.

## Procedure

### 1 — Assemble the batch

If the operator gave PR numbers, use exactly those (still verify each is green — refuse red ones with a one-line reason). Otherwise discover:

```bash
gh pr list --state open --json number,title,isDraft,reviewDecision,mergeable,mergeStateStatus,headRefName
gh pr checks <N>          # per candidate — every required check green?
```

Drop: drafts, `reviewDecision == "CHANGES_REQUESTED"`, any red/pending required check, `mergeable == "CONFLICTING"` (send those to `/pr-iterate` instead).

### 2 — Order the batch (migration-aware)

```bash
gh pr view <N> --json files --jq '.files[].path'
```

- PRs touching `packages/db/drizzle/**` go **first**, one at a time — migration files and `drizzle/meta/_journal.json` are the sharpest cross-PR collision, and landing them early means siblings get updated against the new journal instead of colliding at the end.
- **Two or more PRs adding migrations in one batch → escalate before merging the second.** They almost certainly claim the same migration number; the later one needs regenerating, not a mechanical retry.
- Everything else: FIFO by ascending PR number.

### 3 — Present the plan

Before the first merge, show the ordered list (PR, title, why it's positioned there, which are migration-bearing). In auto-discovery mode, wait for the operator's go-ahead. When the operator passed explicit PR numbers, that message *is* the go-ahead — proceed.

### 4 — Land each PR, in order

```bash
# a. Stale against main? Update via GitHub (web-flow-signed merge commit).
gh pr view "$PR" --json mergeStateStatus --jq .mergeStateStatus   # BEHIND?
gh api -X PUT "repos/{owner}/{repo}/pulls/$PR/update-branch"

# b. Wait for checks to re-run and go green.
gh pr checks "$PR" --watch

# c. Merge — API merge commits are web-flow-signed, same as the UI button.
gh pr merge "$PR" --merge

# d. Wait for the post-merge main workflows before the next merge —
#    keeps prod migrations strictly ordered (their concurrency groups
#    queue, but the train should observe each result, not outrun it).
gh run list --branch main --workflow migrate-db.yml --limit 1 --json status,conclusion,databaseId
gh run list --branch main --workflow release.yml    --limit 1 --json status,conclusion,databaseId
gh run watch <databaseId>
```

**If checks go red after update-branch (4b)**: that's a real cross-PR interaction surfaced early — skip the PR, record it as a `/pr-iterate` candidate, continue the train.
**If the merge itself is rejected**: re-read state; if it's not a transient (e.g. checks re-queued), stop and report.
**If `migrate-db` fails (4d)**: hard rule 6 — stop the train, escalate with the run log.

### 5 — After the batch

Run **`/worktree-cleanup`** — the merged PRs' worktrees are now prunable, and the root checkout's `main` should fast-forward to include the batch.

## Output format

```
merge-train — <date>

Plan:      #A (db migration) -> #B -> #C
Landed:    #A <merge sha> · #B <merge sha>
Skipped:   #C — checks went red after update-branch (-> /pr-iterate #C)
main:      <sha before> -> <sha after> · migrate-db ✅ · release ✅ (vX.Y.Z)
Cleanup:   <worktrees removed> removed · <kept> kept
```

## Cross-references

- ADR-0077 (operator-side merge train) — the decision this skill implements, incl. why GitHub Merge Queue and the `claude-code-merge-queue` npm tool were rejected.
- ADR-0044 (signed merge commits) — why `--merge` via API is signature-safe and rebase is forbidden.
- ADR-0035 (superseded bot-merge) — the failure history; don't re-attempt protection bypasses.
- `/pr-iterate` — drives a PR to green; never merges. `/merge-train` is where merging was deliberately delegated.
- `/worktree-cleanup` — final step of every train.
