#!/bin/sh
# tdd-pairing-guard.sh — THE TDD pairing rule. One implementation, many callers.
#
# Verdict on a ref range: if the range touches SOURCE files and no TEST file,
# that is a source change with no test change, and it fails. Nothing else.
#
# The rule lives here rather than inline in a hook so the CI counterpart runs
# the SAME rule instead of a hand-maintained copy of it — two copies of a rule
# are two rules, and they diverge on the first fix. `.githooks/pre-push` and
# `scripts/tdd-pairing-guard-ci.sh` are both thin callers: each resolves the ref
# range its own gate knows about, and adds its own escape hatch. This script
# judges a range and does not know what a hook or a pull request is.
#
# Usage:  scripts/tdd-pairing-guard.sh <base-ref> <head-ref> [--label <text>] [--hint <text>]
#
#   --label  prefix on the failure line (default "tdd-pairing-guard"); callers
#            use it to name the gate that is speaking ("pre-push", "ci").
#   --hint   remediation line printed under the file list; callers use it to
#            name their own escape hatch, which differs per gate.
#
# Exit codes:  0 paired, nothing to judge, or unconfigured · 1 unpaired source
#              change · 2 usage error / the range cannot be diffed.
#
# WHAT COUNTS AS SOURCE AND TEST lives in scripts/guards.config.sh, not here.
# This script holds no knowledge of your repo's layout. With no SOURCE patterns
# configured it warns once and passes: a guard that blocks every push in a repo
# nobody has configured yet is deleted on day one, and a deleted guard checks
# nothing. Set TDD_PAIRING_GUARD_QUIET=1 to suppress that warning (the pre-push
# hook does, after the first pushed ref, so one push warns once).
#
# Renames are excluded (--diff-filter=ACM): a pure move is not new behavior.
#
# The rule does NOT cover itself. This script is shell; unless your SOURCE
# pattern matches shell scripts, editing the guard trips no guard. That is
# deliberate rather than an oversight — what covers the guard is
# tests/tdd-pairing-guard.test.sh, and human review covers a diff that weakens
# it. This gate guards honest mistakes, not an adversary.

set -u

label=tdd-pairing-guard
hint="Write the failing test first."
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

here=$(dirname "$0")
# shellcheck source=./guards.lib.sh
. "$here/guards.lib.sh"
guards_load_config "$here" || true

source_re=${GUARD_SOURCE_RE:-}
source_exclude_re=${GUARD_SOURCE_EXCLUDE_RE:-}
test_re=${GUARD_TEST_RE:-}

# --- unconfigured: warn once, pass ------------------------------------------
if [ -z "$source_re" ]; then
	if [ "${TDD_PAIRING_GUARD_QUIET:-}" != "1" ]; then
		echo "!  $label: TDD pairing guard is INACTIVE — no source patterns configured." >&2
		echo "   Set GUARD_SOURCE_RE in scripts/guards.config.sh to turn it on." >&2
		echo "   Until then source changes can land with no test changes and nothing will say so." >&2
	fi
	exit 0
fi

if [ -z "$test_re" ]; then
	echo "x $label: GUARD_TEST_RE is empty in scripts/guards.config.sh." >&2
	echo "  With no way to recognise a test file the guard would fail every source change." >&2
	exit 2
fi

changed=$(git diff --name-only --diff-filter=ACM "$base" "$head" 2>/dev/null) || {
	echo "x $label: cannot diff $base..$head (TDD pairing guard)." >&2
	exit 2
}
[ -z "$changed" ] && exit 0

# A test file often matches the source pattern too (it usually sits beside the
# code). Tests are subtracted from source before anything else, so the pairing
# question is asked about production files only.
src=$(printf '%s\n' "$changed" | grep -E "$source_re" | grep -Ev "$test_re" || true)
if [ -n "$source_exclude_re" ]; then
	src=$(printf '%s\n' "$src" | grep -Ev "$source_exclude_re" || true)
fi
tests=$(printf '%s\n' "$changed" | grep -E "$test_re" || true)

if [ -n "$src" ] && [ -z "$tests" ]; then
	echo "" >&2
	echo "x $label: source changes with no test changes (TDD pairing guard):" >&2
	printf '%s\n' "$src" | sed 's/^/    /' >&2
	echo "  $hint" >&2
	exit 1
fi

exit 0
