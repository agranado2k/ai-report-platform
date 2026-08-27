#!/bin/sh
# behavior-delta.sh — a deterministic candidate list for the behavior axis of a
# two-axis review.
#
# Inventories the branch's deltas in the CONTRACT ARTIFACTS — the places where
# behavior is externalized and therefore machine-visible. It produces grounded
# candidates for a reviewer (human or agent) to classify: specified /
# unspecified / missing. THIS SCRIPT JUDGES NOTHING. It only lists, and it lists
# from git, so its output is reproducible and arguable.
#
# Usage:  scripts/behavior-delta.sh [<base-ref>]     (default base: origin/main)
#
# WHICH SURFACES COUNT is configuration, not code: BEHAVIOR_DELTA_SURFACES in
# scripts/guards.config.sh, one `label|extended-regex` record per line. One home
# per surface — the branch-level sections below and the per-commit separation
# check both read the same records, so a surface added there is picked up by
# every part of this script rather than by whichever copy the editor noticed.
#
# With no surfaces configured this prints its header and says so, rather than
# claiming a clean branch. A tool that reports "nothing found" when it was never
# told where to look is worse than one that reports nothing at all.

set -eu

here=$(dirname "$0")
# shellcheck source=./guards.lib.sh
. "$here/guards.lib.sh"
guards_load_config "$here" || true

surfaces=${BEHAVIOR_DELTA_SURFACES:-}
test_re=${GUARD_TEST_RE:-}
feature_re=${BEHAVIOR_DELTA_FEATURE_RE:-}

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

# $NF, not $2: rename/copy rows are `R100<tab>old<tab>new` — the LAST field is
# the path that exists at HEAD ($2 would silently report the pre-rename path).
status=$(git diff --name-status "$base" HEAD)
all=$(printf '%s\n' "$status" | awk '{print $NF}')
modified=$(printf '%s\n' "$status" | awk '$1 ~ /^M/ {print $NF}')

echo "# Behavior-delta candidates — $(git rev-parse --abbrev-ref HEAD) vs $base_ref (merge-base $(git rev-parse --short "$base"))"

if [ -z "$surfaces" ]; then
	printf '\nNo contract artifacts configured. Add surfaces to BEHAVIOR_DELTA_SURFACES\n'
	printf 'in scripts/guards.config.sh — until then this script cannot see anything,\n'
	printf 'which is not the same as there being nothing to see.\n'
	exit 0
fi

# --- Edited (not added) test-tier files --------------------------------------
# An edit to an EXISTING assertion is by definition a behavior change; additions
# are new coverage, not a red flag.
edited_tests=""
if [ -n "$test_re" ]; then
	edited_tests=$(printf '%s\n' "$modified" | grep -E "$test_re" || true)
fi
section "Edited existing tests / specs (assertion changes = behavior changes)" "$edited_tests"

# --- One section per configured surface --------------------------------------
# Records are `label|regex`, split on the FIRST pipe: a regex is allowed to (and
# usually does) contain pipes of its own.
contract_re=""
found_any=""
while IFS= read -r record; do
	case "$record" in
	'' | '#'*) continue ;;
	*'|'*) ;;
	*)
		echo "behavior-delta: ignoring malformed surface record (no '|'): $record" >&2
		continue
		;;
	esac
	label=${record%%|*}
	re=${record#*|}
	[ -n "$re" ] || continue

	if [ -z "$contract_re" ]; then contract_re=$re; else contract_re="$contract_re|$re"; fi

	hits=$(printf '%s\n' "$all" | grep -E "$re" || true)
	[ -n "$hits" ] && found_any=yes
	section "$label" "$hits"
done <<SURFACES
$surfaces
SURFACES

# --- Commit separation -------------------------------------------------------
# The shared invariant: a refactor-only pass and a behavior change never share a
# commit. A commit whose Conventional Commit TYPE claims structure-only work
# (`refactor`, `style`) while its own diff touches a contract artifact is either
# that rule broken or a mislabelled commit — for a reviewer the two are the same
# problem: the diff a human must actually read is buried under renames, and a
# revert cannot be scoped. This is a per-COMMIT claim, so it is checked per
# commit; the sections above are branch-level and cannot see it.
#
# Deliberately narrow, because a false positive here teaches reviewers to skim:
#   - only `refactor` / `style`, the two types that assert "nothing behaves
#     differently". `feat`/`fix`/`perf` already announce behavior, and
#     `chore`/`docs`/`test` make no claim about the source's semantics.
#   - merge commits are skipped: a merge's first-parent diff is the whole merged
#     branch, not this commit's own work.
#   - pure renames and copies are skipped (`A`/`M`/`D` only) — a move is not a
#     behavior change, the same call the TDD pairing guard makes with
#     `--diff-filter=ACM`. Note what that costs, deliberately: `--find-renames`
#     also reports a rename WITH edits as `R<score>` whenever the two files stay
#     similar enough, so a commit that moves a contract file and tweaks it in the
#     same breath is invisible here. Widening to `R` would instead fire on every
#     honest move, which is the failure mode this section is built to avoid.
#     A refactor pass that edits behavior while moving the file is mislabelled at
#     the source; this check is the second line, not the first.
#   - the unit test tier is skipped entirely: call-site churn in test files is
#     what a rename IS, so flagging it would fire on almost every honest
#     refactor. Executable specs (BEHAVIOR_DELTA_FEATURE_RE) are kept, and only
#     when EDITED: a scenario is the spec, so an edited one in a structure-only
#     commit is unambiguous, while a new one is just added coverage.
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
			non_test=$(printf '%s\n' "$rows" | awk '$1 ~ /^[AMD]$/ {print $NF}')
			[ -n "$test_re" ] && non_test=$(printf '%s\n' "$non_test" | grep -Ev "$test_re" || true)
			printf '%s\n' "$non_test" | grep -E "$contract_re" || true

			if [ -n "$feature_re" ]; then
				printf '%s\n' "$rows" | awk '$1 == "M" {print $NF}' |
					grep -E "$feature_re" || true
			fi
		} | grep -v '^$' | sort -u
	)
	[ -z "$hits" ] && continue

	entry="$(git rev-parse --short "$sha") $subject
$(printf '%s\n' "$hits" | sed 's/^/  /')"
	if [ -z "$mixed" ]; then mixed=$entry; else mixed="$mixed
$entry"; fi
done

section "Commit separation — refactor/style commits touching contract artifacts" "$mixed"

if [ -z "$edited_tests$found_any$mixed" ]; then
	printf '\nNo contract-artifact deltas on this branch.\n'
fi
