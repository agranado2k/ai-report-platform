#!/bin/sh
# guards.lib.sh — the one loader the guards share.
#
# Sourced, never executed. Its only job is finding and reading
# scripts/guards.config.sh so that three scripts do not carry three copies of
# the same resolution order (and drift).
#
# Resolution order, first hit wins:
#   1. $GUARDS_CONFIG        — explicit. If it is set and does not exist, that
#                              is an ERROR (exit 2): the caller named a file, so
#                              silently falling back would run a policy nobody
#                              asked for. Tests rely on this.
#   2. <repo root of the cwd>/scripts/guards.config.sh — the repo being
#      guarded. Sourced ONLY when that root is also the calling script's own
#      repo root: a config is sourced, i.e. CODE, and standing in a repository
#      must never be enough to run its code as you. (Discovery deliberately
#      stays cwd-based — the cwd repo IS the guard's subject, its config
#      describes the diff being classified — so the check verifies ownership
#      rather than re-anchoring discovery elsewhere.) On a mismatch the loader
#      says so on stderr and REFUSES: discovery ends there, unconfigured.
#      Crossing repos on purpose is what $GUARDS_CONFIG is for.
#   3. <calling script's directory>/guards.config.sh
#
# A missing config is NOT an error. Each guard decides what an unconfigured repo
# means for it; the pairing guard warns once and passes.
#
# Shared layer (see VERSION): copied verbatim, not edited downstream. Your
# policy goes in guards.config.sh.

# guards_load_config [<dir of the calling script>]
#
# The parameter is the anchor the mismatch check verifies against. Without it
# the check cannot run, so orders 2 and 3 are skipped entirely — an anchorless
# caller in an unconfigured state, exactly like a repo with no config file.
guards_load_config() {
	_gl_here=${1:-}

	if [ -z "$_gl_here" ] && [ -z "${GUARDS_CONFIG:-}" ]; then
		return 1
	fi

	if [ -n "${GUARDS_CONFIG:-}" ]; then
		if [ ! -f "$GUARDS_CONFIG" ]; then
			echo "guards: GUARDS_CONFIG=$GUARDS_CONFIG does not exist." >&2
			exit 2
		fi
		. "$GUARDS_CONFIG"
		return 0
	fi

	_gl_root=$(git rev-parse --show-toplevel 2>/dev/null) || _gl_root=
	if [ -n "$_gl_root" ] && [ -f "$_gl_root/scripts/guards.config.sh" ]; then
		# The anchor's rev-parse runs with inherited git identity scrubbed:
		# git exports GIT_DIR into hooks (linked worktrees especially), and a
		# pinned GIT_DIR makes rev-parse answer for the pinned repo — or for
		# the anchor directory itself — instead of for the anchor's own tree,
		# refusing a repo its own config on every worktree push.
		_gl_own=$( (unset GIT_DIR GIT_WORK_TREE && git -C "$_gl_here" rev-parse --show-toplevel) 2>/dev/null ) || _gl_own=
		if [ "$_gl_root" = "$_gl_own" ]; then
			. "$_gl_root/scripts/guards.config.sh"
			return 0
		fi
		echo "guards: refusing to source $_gl_root/scripts/guards.config.sh — it belongs to the repository this process is standing in, not to the guard's own (${_gl_own:-unknown}). A config is code; set GUARDS_CONFIG to cross repositories on purpose." >&2
		return 1
	fi

	if [ -f "$_gl_here/guards.config.sh" ]; then
		. "$_gl_here/guards.config.sh"
		return 0
	fi

	return 1
}
