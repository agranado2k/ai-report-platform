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

# Edited (not added) test-tier files: an edit to an EXISTING assertion is by
# definition a behavior change; additions are new coverage, not a red flag.
edited_tests=$(printf '%s\n' "$modified" | grep -E '\.(test|spec)\.(ts|tsx|mjs)$|\.feature$' || true)

api=$(printf '%s\n' "$all" | grep -E '^docs/api/openapi\.yaml$' || true)
errors=$(printf '%s\n' "$all" | grep -E '^packages/http/' || true)
events=$(printf '%s\n' "$all" | grep -E '^docs/events\.md$' || true)
db=$(printf '%s\n' "$all" | grep -E '^packages/db/|^docs/db-design\.md$' || true)
env=$(printf '%s\n' "$all" | grep -E '^packages/env/' || true)
headers=$(printf '%s\n' "$all" | grep -E '^packages/headers/' || true)
mcp=$(printf '%s\n' "$all" | grep -E '^apps/mcp/(src/(instructions|prompts|tools)|skill/|packaging/)' || true)
# Process & agent surfaces: skills, hooks and the docs gate change how every
# future session behaves — that is behavior an operator wants on the list too
# (this script's own introducing PR would otherwise have reported "no deltas").
process=$(printf '%s\n' "$all" | grep -E '^\.claude/skills/|^\.husky/|^scripts/docs-conformance/' || true)

echo "# Behavior-delta candidates — $(git rev-parse --abbrev-ref HEAD) vs $base_ref (merge-base $(git rev-parse --short "$base"))"

section "Edited existing tests / features (assertion changes = behavior changes)" "$edited_tests"
section "API surface (docs/api/openapi.yaml)" "$api"
section "Error semantics (packages/http, RFC 9457 model — ADR-0040)" "$errors"
section "Domain events (docs/events.md)" "$events"
section "Persistence (packages/db, docs/db-design.md)" "$db"
section "Configuration (packages/env — ADR-0043)" "$env"
section "Security posture (packages/headers — CSP / Trusted Types)" "$headers"
section "Agent-facing prompt surfaces (apps/mcp — ADR-0072)" "$mcp"
section "Process & agent surfaces (.claude/skills, .husky, docs gate — ADR-026)" "$process"

if [ -z "$edited_tests$api$errors$events$db$env$headers$mcp$process" ]; then
  printf '\nNo contract-artifact deltas on this branch.\n'
fi
