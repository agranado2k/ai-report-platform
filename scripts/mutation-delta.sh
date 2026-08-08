#!/bin/sh
# mutation-delta.sh — the DIFFERENTIAL mutation diagnostic promised by ADR-0081
# (§1: "differentially, scoped to the files a PR touched … which is what makes
# it affordable inside a review"; listed there as the first follow-up).
#
# `pnpm test:mutation` mutates the whole `arp-domain` package: ~1050 mutants,
# ~51 s. That is the right shape for a calibration run and the wrong shape for a
# review, which cares about ONE branch. This script narrows `mutate` to the pure
# domain source files the branch actually changed and prints a summary the
# reviewer reads instead of an HTML report they will not open:
#
#   - the mutation score over just those files;
#   - every surviving mutant, with file:line and the mutator, so it can be
#     opened and read;
#   - or, when the branch changed no domain source, a one-line skip.
#
# Consumers: `/review-pr` Agent 6 (Test Hygiene — cites survivors instead of
# offering an opinion) and Agent 7's Axis-2 confirm-list (the mutation-delta
# line). It is a DIAGNOSTIC, never a gate: it exits 0 whatever the score, the
# same call `thresholds.break: null` makes in stryker.config.mjs.
#
# Usage: scripts/mutation-delta.sh [--list] [<base-ref>]    (default: origin/main)
#   --list   print the resolved mutate scope and stop — no Stryker run. What the
#            script would measure, in the time it takes to run `git diff`.
#
# stdout is the summary and nothing else; Stryker's own chatter goes to stderr,
# so a caller can capture the review-consumable part with a plain `$(...)`.

set -eu

list_only=0
base_ref=origin/main
for arg in "$@"; do
  case $arg in
  --list) list_only=1 ;;
  -*)
    echo "unknown option: $arg" >&2
    exit 2
    ;;
  *) base_ref=$arg ;;
  esac
done

root=$(git rev-parse --show-toplevel) || {
  echo "not inside a git repository" >&2
  exit 1
}
base=$(git merge-base "$base_ref" HEAD) || {
  echo "cannot resolve merge-base($base_ref, HEAD)" >&2
  exit 1
}

# The calibration target is `packages/domain` and only that (ADR-0081 §2): ADR-024
# keeps it pure, which is why a mutant there costs a function call rather than a
# container. Extending the scope is a follow-up with its own cost calibration.
pkg_dir=packages/domain
pkg_name=arp-domain

# `--diff-filter=d` drops deletions: a file that no longer exists at HEAD cannot
# be mutated, and passing it to `--mutate` would make Stryker match nothing. The
# exclusions mirror stryker.config.mjs's own `mutate` list — the barrel is
# re-exports and a test file is not production code — so the differential run
# measures the same surface the full run does, just less of it.
changed=$(
  git diff --name-only --diff-filter=d "$base" HEAD -- "$pkg_dir/src" |
    grep -E '\.ts$' |
    grep -Ev '\.test\.ts$' |
    grep -Ev "^$pkg_dir/src/index\.ts$" |
    sed "s|^$pkg_dir/||" |
    sort -u || true
)

echo "# Mutation delta — $(git rev-parse --abbrev-ref HEAD) vs $base_ref (merge-base $(git rev-parse --short "$base"))"

if [ -z "$changed" ]; then
  printf '\nNo domain source changed on this branch — mutation run skipped.\n'
  exit 0
fi

file_count=$(printf '%s\n' "$changed" | wc -l | tr -d ' ')
printf '\n## Scope (%s changed domain source file(s) in %s)\n' "$file_count" "$pkg_dir"
printf '%s\n' "$changed" | sed 's/^/  /'

[ "$list_only" -eq 1 ] && exit 0

# Stryker's `--mutate` takes a comma-separated list and OVERRIDES the config's,
# which is exactly the narrowing wanted here.
mutate=$(printf '%s\n' "$changed" | paste -sd, -)

# Only the `json` reporter: `clear-text` and `progress` would interleave with the
# summary this script's stdout is supposed to be. Everything Stryker says goes to
# stderr; the parsed answer comes back on stdout below.
report="$root/$pkg_dir/reports/mutation/mutation.json"
rm -f "$report"

printf '\n' >&2
status=0
pnpm --filter "$pkg_name" exec stryker run \
  --mutate "$mutate" \
  --reporters json \
  --allowEmpty >&2 2>&1 || status=$?

if [ ! -f "$report" ]; then
  printf '\nStryker produced no report (exit %s) — see the run output above.\n' "$status"
  exit 0 # diagnostic, never a gate: a failed run is reported, not raised
fi

printf '\n'
node "$root/scripts/mutation-delta-report.mjs" "$report"
