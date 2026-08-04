#!/usr/bin/env bash
# Prune merged feature worktrees and sync the root checkout (ADR-025, ADR-0077).
#
# For each worktree under worktree/<slug>, the worktree and its local branch are
# removed only when the branch is merged into origin/main AND the worktree has
# no uncommitted changes. Everything else is kept and reported — nothing is
# ever force-removed. The root checkout's main is fast-forwarded to
# origin/main (skipped if dirty or not on main) and dependencies reinstalled
# when it moves.
#
# Usage: scripts/worktree-cleanup.sh [--dry-run]
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# Resolve the root checkout even when invoked from inside a linked worktree.
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT="$(dirname "$COMMON_DIR")"
cd "$ROOT"

say() { printf '%s\n' "$*"; }
run() { if (( DRY_RUN )); then say "  [dry-run] $*"; else "$@"; fi; }

# Merged = ancestor of origin/main (merge commits) or, failing that, the head
# branch of a merged PR (covers squash merges, which rewrite the commits).
is_merged() {
  local branch="$1"
  git merge-base --is-ancestor "$branch" origin/main 2>/dev/null && return 0
  if command -v gh >/dev/null 2>&1; then
    local pr
    pr="$(gh pr list --head "$branch" --state merged --json number --jq '.[0].number' 2>/dev/null || true)"
    [[ -n "$pr" ]] && return 0
  fi
  return 1
}

say "==> git fetch --prune origin"
git fetch --prune origin

# --- 1. Fast-forward the root checkout's main --------------------------------
MAIN_MOVED=0
if [[ -n "$(git status --porcelain)" ]]; then
  say "!! Root checkout is dirty — skipping main fast-forward. Commit or stash first."
elif [[ "$(git branch --show-current)" != "main" ]]; then
  say "!! Root checkout is on '$(git branch --show-current)', not main — skipping fast-forward."
else
  BEFORE="$(git rev-parse HEAD)"
  AFTER="$(git rev-parse origin/main)"
  if [[ "$BEFORE" == "$AFTER" ]]; then
    say "==> main already up to date with origin/main ($(git rev-parse --short HEAD))"
  else
    say "==> Fast-forwarding main: $(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$AFTER")"
    run git merge --ff-only origin/main
    MAIN_MOVED=1
  fi
fi

# --- 2. Prune merged, clean worktrees ----------------------------------------
REMOVED=()
KEPT=()
while IFS= read -r wt_path; do
  [[ "$wt_path" == "$ROOT" ]] && continue
  case "$wt_path" in "$ROOT"/worktree/*) ;; *) KEPT+=("$wt_path — outside worktree/, skipped"); continue ;; esac

  branch="$(git -C "$wt_path" branch --show-current)"
  if [[ -z "$branch" ]]; then
    KEPT+=("$wt_path — detached HEAD, skipped")
  elif [[ -n "$(git -C "$wt_path" status --porcelain)" ]]; then
    KEPT+=("$wt_path ($branch) — uncommitted changes")
  elif is_merged "$branch"; then
    say "==> Removing merged worktree $wt_path ($branch)"
    run git worktree remove "$wt_path"
    run git branch -D "$branch"
    # GitHub deletes head branches on merge; catch any that survived.
    if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
      run git push origin --delete "$branch"
    fi
    REMOVED+=("$wt_path ($branch)")
  else
    KEPT+=("$wt_path ($branch) — not merged into origin/main")
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')

# --- 3. Reinstall deps if main moved -----------------------------------------
if (( MAIN_MOVED )); then
  say "==> main moved — reinstalling dependencies"
  run pnpm install
fi

# --- 4. Summary ---------------------------------------------------------------
say ""
say "== worktree-cleanup summary$( (( DRY_RUN )) && printf ' (dry-run — nothing was changed)' )"
say "main: $(git rev-parse --short HEAD) ($(git log -1 --format=%s HEAD | head -c 80))"
say "removed (${#REMOVED[@]}):"
for r in "${REMOVED[@]-}"; do [[ -n "$r" ]] && say "  - $r"; done
say "kept (${#KEPT[@]}):"
for k in "${KEPT[@]-}"; do [[ -n "$k" ]] && say "  - $k"; done
say ""
say "Reminder: refresh the 'Active worktrees' row in docs/diary.md (update protocol: remove merged worktrees from the active list)."
