#!/bin/sh
# tdd-pairing-guard.sh — THE TDD pairing rule. One implementation, many callers.
#
# Verdict on a ref range: if the range touches test-covered SOURCE files and no
# test file, that is a source change with no test change, and it fails. The rule
# lived inline in `.husky/pre-push` until issue #278; it moved here so the CI
# counterpart (issue #280) can run the same rule instead of a hand-maintained
# copy of it. The hook is now a thin caller that resolves the range per pushed
# ref; this script judges the range and nothing else.
#
# Usage:  scripts/tdd-pairing-guard.sh <base-ref> <head-ref> [--label <text>] [--hint <text>]
#
#   --label  prefix on the failure line (default "tdd-pairing-guard"); callers
#            use it to name the gate that is speaking ("pre-push", "ci").
#   --hint   remediation line printed under the file list; callers use it to
#            name their own escape hatch, which differs per gate.
#
# Exit codes:  0 paired (or nothing to judge) · 1 unpaired source change ·
#              2 usage error / the range cannot be diffed.
#
# SOURCE = the vitest-covered production trees PLUS the node:test tree
# scripts/docs-conformance/. KEEP IN SYNC with the `include` globs in
# vitest.config.ts (which carries the matching reminder) — nothing ties them
# together mechanically yet, so a newly covered tree added there without a line
# here is silently un-guarded.
# docs-conformance/config.mjs is excluded: it is reviewable policy DATA
# (ADR-0041 — "validators hold no policy"), so editing it needs no test change.
# Renames are excluded (--diff-filter=ACM): a pure move is not new behavior.

set -u

label=tdd-pairing-guard
hint="Write the failing test first (/tdd)."
base=
head=

usage() {
  echo "usage: tdd-pairing-guard.sh <base-ref> <head-ref> [--label <text>] [--hint <text>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case $1 in
    --label)
      [ $# -ge 2 ] || usage
      label=$2
      shift 2
      ;;
    --hint)
      [ $# -ge 2 ] || usage
      hint=$2
      shift 2
      ;;
    -*) usage ;;
    *)
      if [ -z "$base" ]; then
        base=$1
      elif [ -z "$head" ]; then
        head=$1
      else
        usage
      fi
      shift
      ;;
  esac
done

[ -n "$base" ] && [ -n "$head" ] || usage

changed=$(git diff --name-only --diff-filter=ACM "$base" "$head" 2>/dev/null) || {
  echo "✗ $label: cannot diff $base..$head (TDD pairing guard)." >&2
  exit 2
}
[ -z "$changed" ] && exit 0

src=$(echo "$changed" | grep -E '^(packages/[^/]+/src/|apps/mcp/src/|apps/app/app/server/|apps/view/app/(server|edit)/|scripts/docs-conformance/).*\.(ts|tsx|mjs)$' | grep -Ev '\.(test|spec)\.(ts|tsx|mjs)$|\.d\.ts$|^scripts/docs-conformance/config\.mjs$' || true)
tests=$(echo "$changed" | grep -E '\.(test|spec)\.(ts|tsx|mjs)$|\.feature$' || true)

if [ -n "$src" ] && [ -z "$tests" ]; then
  echo "" >&2
  echo "✗ $label: source changes with no test changes (TDD pairing guard):" >&2
  echo "$src" | sed 's/^/    /' >&2
  echo "  $hint" >&2
  exit 1
fi

exit 0
