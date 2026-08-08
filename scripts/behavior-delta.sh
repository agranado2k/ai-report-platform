#!/bin/sh
# behavior-delta.sh — deterministic candidate list for the Axis-2 Spec &
# Behavior reviewer (.claude/skills/review-pr, Agent 7; plan Phase 3.2).
#
# Inventories the branch's deltas in the CONTRACT ARTIFACTS — the places where
# behavior is externalized and therefore machine-visible. Grounded candidates
# for the reviewer to classify (✅ specified / ⚠️ unspecified / ❌ missing);
# this script judges nothing, it only lists.
#
# Usage: scripts/behavior-delta.sh [<base-ref>]   (default base: origin/main)

set -eu

base_ref=${1:-origin/main}
base=$(git merge-base "$base_ref" HEAD) || {
  echo "cannot resolve merge-base($base_ref, HEAD)" >&2
  exit 1
}

section() {
  # $1 title, $2 newline-separated file list (possibly empty)
  [ -z "$2" ] && return 0
  printf '\n## %s\n' "$1"
  printf '%s\n' "$2" | sed 's/^/  /'
}

# $NF, not $2: rename/copy rows are `R100\told\tnew` — the LAST field is the
# path that exists at HEAD ($2 would silently report the pre-rename path).
status=$(git diff --name-status "$base" HEAD)
all=$(printf '%s\n' "$status" | awk '{print $NF}')
modified=$(printf '%s\n' "$status" | awk '$1 ~ /^M/ {print $NF}')

# --- The contract artifacts, one pattern per surface -------------------------
# One home per surface: the sections below and (later) the per-commit separation
# check both read these, so a surface added here is picked up by every part of
# the script rather than by whichever copy the editor happened to notice.
re_tests='\.(test|spec)\.(ts|tsx|mjs)$|\.feature$'
re_features='\.feature$'
re_api='^docs/api/openapi\.yaml$'
re_errors='^packages/http/'
re_events='^docs/events\.md$'
re_db='^packages/db/|^docs/db-design\.md$'
re_env='^packages/env/'
re_headers='^packages/headers/'
re_mcp='^apps/mcp/(src/(instructions|prompts|tools)|skill/|packaging/)'
# Process & agent surfaces: skills, hooks, the docs gate and the constitution
# (root CLAUDE.md, its .claude/constitution/ articles, and nested per-package
# CLAUDE.md files) change how every future session behaves — that is behavior an
# operator wants on the list too (this script's own introducing PR would
# otherwise have reported "no deltas"). The constitution earns its place for the
# same reason ADR-0082 gave it a validator: a standing instruction edited without
# a spec reference is an unapproved policy change, not a docs tidy-up.
re_process='^\.claude/skills/|^\.claude/constitution/|^CLAUDE\.md$|/CLAUDE\.md$|^\.husky/|^scripts/docs-conformance/'

# Edited (not added) test-tier files: an edit to an EXISTING assertion is by
# definition a behavior change; additions are new coverage, not a red flag.
edited_tests=$(printf '%s\n' "$modified" | grep -E "$re_tests" || true)

api=$(printf '%s\n' "$all" | grep -E "$re_api" || true)
errors=$(printf '%s\n' "$all" | grep -E "$re_errors" || true)
events=$(printf '%s\n' "$all" | grep -E "$re_events" || true)
db=$(printf '%s\n' "$all" | grep -E "$re_db" || true)
env=$(printf '%s\n' "$all" | grep -E "$re_env" || true)
headers=$(printf '%s\n' "$all" | grep -E "$re_headers" || true)
mcp=$(printf '%s\n' "$all" | grep -E "$re_mcp" || true)
process=$(printf '%s\n' "$all" | grep -E "$re_process" || true)

# --- Commit separation (shared-invariants §10) -------------------------------
# §10: a refactor-only pass and a behavior change never share a commit. A commit
# whose Conventional Commit TYPE claims structure-only work (`refactor`, `style`)
# while its own diff touches a contract artifact is either that rule broken or a
# mislabelled commit — for a reviewer the two are the same problem: the diff a
# human must actually read is buried under renames, and a revert cannot be
# scoped. This is a per-COMMIT claim, so it is checked per commit; the sections
# above are branch-level and cannot see it.
#
# Deliberately narrow, because a false positive here teaches reviewers to skim:
#   - only `refactor` / `style`, the two types that assert "nothing behaves
#     differently". `feat`/`fix`/`perf` already announce behavior, and
#     `chore`/`docs`/`test` make no claim about the source's semantics.
#   - merge commits are skipped: a merge's first-parent diff is the whole merged
#     branch, not this commit's own work.
#   - pure renames and copies are skipped (`A`/`M`/`D` only) — a move is not a
#     behavior change, the same call .husky/pre-push's TDD guard makes with
#     `--diff-filter=ACM`. Note what that costs, deliberately: `--find-renames`
#     also reports a rename WITH edits as `R<score>` whenever the two files stay
#     similar enough, so a commit that moves a contract file and tweaks it in the
#     same breath is invisible here. Widening to `R` would instead fire on every
#     honest move, which is the failure mode this section is built to avoid — and
#     the pairing guard already accepts the identical trade. A refactor pass that
#     edits behavior while moving the file is mislabelled at the source; this
#     check is the second line, not the first.
#   - the unit test tier is skipped entirely: call-site churn in `*.test.ts` is
#     what a rename IS, so flagging it would fire on almost every honest
#     refactor. `.feature` files are kept, and only when EDITED: Gherkin is the
#     executable spec, so an edited scenario in a structure-only commit is
#     unambiguous, while a new one is just added coverage.
contract_re="$re_api|$re_errors|$re_events|$re_db|$re_env|$re_headers|$re_mcp|$re_process"

mixed=""
for sha in $(git rev-list --no-merges "$base..HEAD"); do
  subject=$(git log -1 --format=%s "$sha")
  # The Conventional Commit type, or empty when the subject is not one at all.
  type=$(printf '%s' "$subject" |
    sed -n 's/^\([a-z][a-z]*\)\((\([^)]*\))\)\{0,1\}!\{0,1\}:[[:space:]].*/\1/p')
  [ "$type" = refactor ] || [ "$type" = style ] || continue

  rows=$(git diff-tree --no-commit-id --name-status --find-renames -r "$sha")
  [ -z "$rows" ] && continue

  hits=$(
    {
      printf '%s\n' "$rows" | awk '$1 ~ /^[AMD]$/ {print $NF}' |
        grep -Ev "$re_tests" | grep -E "$contract_re" || true
      printf '%s\n' "$rows" | awk '$1 == "M" {print $NF}' |
        grep -E "$re_features" || true
    } | grep -v '^$' | sort -u
  )
  [ -z "$hits" ] && continue

  entry="$(git rev-parse --short "$sha") $subject
$(printf '%s\n' "$hits" | sed 's/^/  /')"
  if [ -z "$mixed" ]; then mixed=$entry; else mixed="$mixed
$entry"; fi
done

echo "# Behavior-delta candidates — $(git rev-parse --abbrev-ref HEAD) vs $base_ref (merge-base $(git rev-parse --short "$base"))"

section "Edited existing tests / features (assertion changes = behavior changes)" "$edited_tests"
section "API surface (docs/api/openapi.yaml)" "$api"
section "Error semantics (packages/http, RFC 9457 model — ADR-0040)" "$errors"
section "Domain events (docs/events.md)" "$events"
section "Persistence (packages/db, docs/db-design.md)" "$db"
section "Configuration (packages/env — ADR-0043)" "$env"
section "Security posture (packages/headers — CSP / Trusted Types)" "$headers"
section "Agent-facing prompt surfaces (apps/mcp — ADR-0072)" "$mcp"
section "Process & agent surfaces (.claude/skills, the constitution, .husky, docs gate — ADR-026/0082)" "$process"
section "Commit separation — refactor/style commits touching contract artifacts (shared-invariants §10)" "$mixed"

if [ -z "$edited_tests$api$errors$events$db$env$headers$mcp$process$mixed" ]; then
  printf '\nNo contract-artifact deltas on this branch.\n'
fi
