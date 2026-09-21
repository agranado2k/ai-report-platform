#!/bin/sh
# agent-dispatch.sh — run a capability tier on the AGENT HARNESS its mapping names.
#
#   sh scripts/agent-dispatch.sh <tier> [domain] --prompt-file <path> [--dry-run]
#   sh scripts/agent-dispatch.sh <tier> [domain] --prompt <text>      [--dry-run]
#
# THE ONE THING THIS ADDS. `scripts/agents.lib.sh` answers which agent harness
# and which model a tier runs on; it deliberately stops there, because where a
# model id goes at spawn time is specific to the agent harness
# (`adapters/claude-code/README.md` is the worked example). That was a complete
# answer while every tier ran in the caller's own session: a skill read the
# model and passed it to its own spawn call.
#
# It stops being complete the moment a tier names a DIFFERENT agent harness,
# because crossing to one means leaving the session, and no in-session spawn
# call can do that. `templates/workflows/ai-review.example.yml` says so in its
# own header: the cross-provider leg "is unreachable from inside the authoring
# harness", which is why the kit's only cross-vendor review runs in CI, where
# the secrets are. This file is that leg, reachable locally. ADR-0005 records
# the decision and why this script is shared layer.
#
# WHY THIS EXECUTES AND adapters/ DOES NOT. `adapters/README.md` is explicit
# that nothing under it is on an execution path — an adapter is reference prose
# a human reads while wiring the kit up. This is mechanism, so it lives in
# scripts/ beside the resolver it calls.
#
# EXIT STATUS, and why 3 is not a failure:
#   0  dispatched — stdout is the worker's own output
#   3  NOT dispatched, because this tier names no agent harness. stdout is the
#      model id (possibly empty, meaning "inherit"). The caller spawns it
#      itself, exactly as it did before this file existed. This is the DEFAULT
#      for an unconfigured project and it is a working state.
#   2  usage error, unknown tier, or an agent harness with no command template
#   4  NOT dispatched, because this dispatch would nest past the policy
#      maximum depth. A worker may run this script itself; one whose tier maps
#      back to its own agent harness is a fork bomb with a model in the loop,
#      and this is what stops it. Refused before the tier is resolved or the
#      prompt is read, so nothing spawns. AGENT_DISPATCH_MAX_DEPTH below.
# 124  the worker ran past --timeout and its process tree was killed
#  71  the worker exceeded its budget (ADR-0006, EX_OSERR — "can't fork"): a
#      task or memory ceiling on its whole process tree was hit. The verdict is
#      a flag the dispatcher writes from the scope's pids.events / memory.events
#      counters, never inferred from the worker's own status. On the weaker
#      rlimit rung a ceiling hit is not observable, so the worker's own status
#      passes through. A worker that both timed out and exceeded its budget
#      exits with whichever fired first; its tree is gone either way.
#   *  the worker's own exit status, passed through untouched
#
# CONFIGURATION lives in scripts/agents.config.sh beside the tier mapping:
#
#   AGENT_HARNESSES='<token> ...'
#   AGENT_HARNESS_<TOKEN>_CMD='<command> {model_flag} < {prompt_file}'
#   AGENT_HARNESS_<TOKEN>_MODEL_FLAG='<the flag> {model}'
#   AGENT_DISPATCH_MAX_DEPTH='<how deep a dispatch may nest>'   empty: 3
#   AGENT_DISPATCH_SWEEP_DAYS='<whole days>'   the sweep age; empty is the default
#
# THE DEPTH travels the way the other per-dispatch facts do — through the
# worker's environment. AGENT_DISPATCH_DEPTH is this dispatch's own depth,
# unset meaning a top-level dispatch at depth 1; the worker is spawned with it
# set one higher, so a dispatch the worker runs reads its own depth on entry.
# A worker may read it too. A dispatch AT the maximum still runs; one past it
# is exit 4. The ceiling is COOPERATIVE: a worker owns its own environment,
# so `env -u AGENT_DISPATCH_DEPTH` restarts the count at depth 1. It stops an
# accidental loop, not a worker that chooses to nest.
#
# `{model_flag}` expands to the MODEL_FLAG template with `{model}` filled when a
# model is mapped, and to NOTHING when one is not — which is
# `adapters/claude-code/README.md`'s "do not pass an empty string as the model
# parameter; branch on emptiness" rule, made declarative. `{prompt_file}` is the
# assembled prompt.
#
# Everything else in the template is yours — in particular the AUTONOMY FLAGS a
# headless worker needs (approval modes, sandbox settings, tool allowlists) are
# yours to choose, because their blast radius is yours to own. The kit writes
# none of them, for the same reason it names no model: a standing instruction
# about someone else's security posture is worse than none.
#
# THE TEMPLATE IS EVAL'D, which is safe for the same reason sourcing the policy
# file is: it is your file, and a file that can define shell variables can
# already define shell functions. It is not a boundary against a hostile config,
# and it is not one against a hostile MODEL ID either — hence the whitelist
# below, which is.
#
# WHAT A WORKER MAY NOT DO. Shared invariant §7 puts a human's name on the
# merge, and nothing here changes that: a dispatched worker writes to the
# working tree and says what it did. It does not push and it does not merge.
# That is a property of the prompt and of the flags in your template, not
# something this script can enforce — which is exactly why it is written here.

# SOURCED OR EXECUTED. tests/lib.sh sources this file for the budget alone —
# every suite runs inside the budget a worker gets (ADR-0006, #209), derived
# by THIS code so a suite and a worker cannot disagree about a number. Sourced,
# the file runs everything up to the "dispatch proper" line below and
# returns. What the sourcing shell receives, all of it:
#   - the three it came for: _budget_derive (sets BUDGET_MODE, BUDGET_TASKS,
#     BUDGET_TASKS_FROM, BUDGET_MEMORY, BUDGET_MEMORY_FROM, BUDGET_RUNG,
#     NPROC_FLAG and the six BUDGET_TASKS_PERCENT … BUDGET_MEMORY_CEILING
#     it read from the policy file), _budget_scope_props (sets SCOPE_PROPS)
#     and _budget_counters_text (prints the counters reader as text);
#   - the readers under them: _budget_session_tasks, _budget_mem_available_mib,
#     _budget_clamp, _budget_nproc_limit, _budget_nproc_flag, _budget_rung,
#     _budget_percent_below_100, _budget_floor_at_most_ceiling, and the
#     policy readers _read_policy, _read_policy_numbers, _whole_number;
#   - usage, and die — which EXITS the shell that called it, so a caller
#     that wants to survive a policy value it cannot budget sources this
#     file in a subshell, as tests/lib.sh does;
#   - the variables _dispatch_sourced, _here, LIB, _host, the six
#     BUDGET_DEFAULT_* values, and BUDGET_TASKS_FLAG, BUDGET_MEMORY_FLAG and
#     NO_BUDGET at their empty and 0 defaults.
# Not `set -u`: that is the dispatch's own, switched on below the seam, so a
# sourcing shell keeps its options. A sourcing caller sets
# _dispatch_here=<this directory> BEFORE sourcing, on its own line — the
# same seam, and the same reason, as scripts/agents.lib.sh's _agents_here:
# when sourced, $0 is the caller's, and the library beside this file cannot
# be found from it. The detection is agents.lib.sh's too, ZSH_EVAL_CONTEXT
# first: zsh sets $0 to the sourced file's own path, so the $0 test alone
# would run a dispatch out of a `source`.
_dispatch_sourced=0
case "${ZSH_EVAL_CONTEXT:-}" in
*:file | *:file:*) _dispatch_sourced=1 ;;
esac
if [ "$_dispatch_sourced" = 0 ]; then
	case "$0" in
	*/agent-dispatch.sh | agent-dispatch.sh) ;;
	*) _dispatch_sourced=1 ;;
	esac
fi
if [ "$_dispatch_sourced" = 1 ]; then
	_here=${_dispatch_here:-}
	# `return`, so a shell that sourced this by hand stays open with the
	# status; executed under another name there is no function to return
	# from, and the fallback exit is the same 2 — dash returns at top level
	# as if it had exited, bash refuses the return and takes the exit.
	[ -n "$_here" ] || {
		echo "x dispatch: sourced without _dispatch_here, or executed under a name other than agent-dispatch.sh — a sourcing caller sets _dispatch_here to this script's directory first; a copy runs under its own name" >&2
		return 2 2>/dev/null || exit 2
	}
else
	_here=$(dirname "$0")
fi
LIB="$_here/agents.lib.sh"
[ -f "$LIB" ] || {
	echo "x dispatch: cannot find agents.lib.sh in $_here" >&2
	exit 2
}
usage() {
	echo "usage: agent-dispatch.sh <tier> [domain] (--prompt-file <path> | --prompt <text>)" >&2
	echo "                          [--set NAME=VALUE ...] [--timeout <seconds>]" >&2
	echo "                          [--budget-tasks <n>] [--budget-memory <MiB>] [--no-budget]" >&2
	echo "                          [--dry-run]" >&2
	echo "  tier is one of: planner implementer mechanical reviewer" >&2
	echo "  --set      replace %%NAME%% in the prompt with VALUE. Repeatable." >&2
	echo "  --set-file replace %%NAME%% with the CONTENTS of a file. For a value" >&2
	echo "             too large for a command line — a diff, say. Repeatable." >&2
	echo "  --timeout  kill the worker after that many seconds and exit 124." >&2
	echo "  --budget-tasks, --budget-memory" >&2
	echo "             replace the budget derived from this host — the task and" >&2
	echo "             memory ceilings on the worker's whole process tree." >&2
	echo "  --no-budget" >&2
	echo "             run this one worker with no budget at all. Said out loud." >&2
	echo "  --dry-run  print the agent harness, the model, the expanded command," >&2
	echo "             the depth, the budget and the prompt; run nothing." >&2
}

die() {
	echo "x dispatch: $1" >&2
	exit 2
}

# The policy file is sourced in a SUBSHELL: this script must not inherit
# whatever else it defines, and needs exactly two strings out of it (the
# whole-number values have their own reader, _read_policy_numbers below). The
# assignments sit on their own lines because bash and zsh drop a prefix
# assignment on `.` — agents.lib.sh says so in its own header, and doing it the
# short way sources the library with AGENTS_CONFIG unset.
_read_policy() {
	(
		AGENTS_CONFIG=${AGENTS_CONFIG:-}
		export AGENTS_CONFIG
		_agents_here="$_here"
		. "$LIB"
		agents_load_config >/dev/null 2>&1 || true
		eval "printf '%s' \"\${$1:-}\""
	)
}

# _whole_number <what> <value> — a number this script compares or computes
# with, whether from a flag, the environment or the policy file, is a whole
# number from 1 and nothing else: 0 is not a budget any more than --timeout 0
# is a timeout or depth 0 a depth, and a leading zero is octal to $(( )) in
# every sh — 025 would derive 21%. ONE validator for every source, so the
# flag path and the policy path cannot disagree about what a number is.
_whole_number() {
	case "$2" in
	'' | *[!0123456789]*) die "$1 takes a whole number, got '$2'" ;;
	0) die "$1 takes a whole number from 1, and 0 is not one. Leave it out for the default." ;;
	0*) die "$1 takes a whole number with no leading zero, got '$2'" ;;
	esac
}

# _read_policy_numbers NAME=default ... — several whole-number policy values
# in ONE sourcing of the policy file: each the default when unset or empty,
# and refused when not a whole number, held to the same validator as the
# flags — a percentage spelled 'lots' is a mistake to report, not a value to
# fall back from. Prints the values space-separated, in argument order. The
# same subshell shape as _read_policy, for the same reason; a `die` inside
# it ends the subshell and not this script, so the caller checks the status.
_read_policy_numbers() {
	(
		AGENTS_CONFIG=${AGENTS_CONFIG:-}
		export AGENTS_CONFIG
		_agents_here="$_here"
		. "$LIB"
		agents_load_config >/dev/null 2>&1 || true
		for _rpn in "$@"; do
			_rpn_name=${_rpn%%=*} _rpn_default=${_rpn#*=}
			eval "_rpn_v=\"\${$_rpn_name:-}\""
			[ -n "$_rpn_v" ] || _rpn_v=$_rpn_default
			_whole_number "$_rpn_name in your agents config" "$_rpn_v"
			printf '%s ' "$_rpn_v"
		done
	)
}

# --- the budget -------------------------------------------------------------
# A task ceiling and a memory ceiling for the worker's WHOLE process tree,
# derived from this host now: a percentage of the task ceiling this session
# runs under and of the memory available at this moment, each clamped to a
# policy floor and ceiling. ADR-0006 is the decision. scripts/agents.config.sh
# carries the percentages and clamps, and empty there means the defaults
# below — a policy file from before the budget existed still gets one.
#
# THE BUDGET IS DERIVED BY _budget_derive AND APPLIED AT THE FOOT OF THIS FILE
# (ADR-0006, #208): the spawn wraps the worker in the strongest mechanism the
# host offers — a transient scope, else rlimits, else a loud no-op — and reads
# a verdict back. --dry-run still shows the numbers and the rung without
# running anything. Everything from here to the "dispatch proper" line is
# what a sourcing caller gets (see the top of this file).
#
# AGENT_DISPATCH_HOST_ROOT is TEST-ONLY. It is prefixed to the two host paths
# read below (/proc and /sys) so a suite can hand this script a fake host and
# assert the arithmetic against numbers it chose. Empty is the real host.
# Nothing else reads it — tests/lib.sh derives through this same code, so a
# suite run against a fake host is a suite budgeted from that fake host.
BUDGET_DEFAULT_TASKS_PERCENT=25
BUDGET_DEFAULT_TASKS_FLOOR=256
BUDGET_DEFAULT_TASKS_CEILING=4096
BUDGET_DEFAULT_MEMORY_PERCENT=50
BUDGET_DEFAULT_MEMORY_FLOOR_MIB=512
BUDGET_DEFAULT_MEMORY_CEILING_MIB=8192
_host=${AGENT_DISPATCH_HOST_ROOT:-}
# The per-dispatch flags the derivation reads; the argument parse below sets them.
BUDGET_TASKS_FLAG="" BUDGET_MEMORY_FLAG="" NO_BUDGET=0

# _budget_percent_below_100 <suffix> <value> — a percentage is 1–99 (ADR-0006
# clause 3): the budget sits BELOW the ceiling the session shares, and 100 or
# more would put it at or above, in silence.
_budget_percent_below_100() {
	[ "$2" -lt 100 ] ||
		die "AGENT_BUDGET_$1 must be below 100 — the budget sits below the ceiling the session shares (ADR-0006), got $2"
}

# _budget_floor_at_most_ceiling <floor suffix> <floor> <ceiling suffix> <ceiling>
# — a floor above its ceiling leaves the clamp with no answer.
_budget_floor_at_most_ceiling() {
	[ "$2" -le "$4" ] ||
		die "AGENT_BUDGET_$1 $2 is above AGENT_BUDGET_$3 $4 — a floor sits at or below its ceiling"
}

# _budget_session_tasks — the task ceiling this session runs under: the
# smallest numeric pids.max on the path from this process's own cgroup up to
# the root. On a systemd host that is the user slice's TasksMax — 33% of
# threads-max by default, and the ceiling the incident behind ADR-0006
# filled. Prints "<ceiling> <cgroup>"; fails when no cgroup on the path sets
# one, which is also what a host without cgroup v2 (no `0::` line) looks like.
_budget_session_tasks() {
	_bst_path=$(sed -n 's/^0:://p' "$_host/proc/self/cgroup" 2>/dev/null)
	[ -n "$_bst_path" ] || return 1
	_bst_best="" _bst_where=""
	while :; do
		_bst_v=$(cat "$_host/sys/fs/cgroup$_bst_path/pids.max" 2>/dev/null)
		case "$_bst_v" in
		'' | *[!0123456789]*) ;;
		*)
			if [ -z "$_bst_best" ] || [ "$_bst_v" -lt "$_bst_best" ]; then
				_bst_best=$_bst_v _bst_where=$_bst_path
			fi
			;;
		esac
		case "$_bst_path" in
		'' | /) break ;;
		esac
		_bst_path=${_bst_path%/*}
	done
	[ -n "$_bst_best" ] || return 1
	# The basename of the root is empty; a container with a private cgroup
	# namespace and a pids limit on it is exactly where the line matters.
	_bst_name=${_bst_where##*/}
	[ -n "$_bst_name" ] || _bst_name=/
	printf '%s %s\n' "$_bst_best" "$_bst_name"
}

# _budget_mem_available_mib — MemAvailable now, in MiB. What the host could
# give at this moment, not what it has installed.
_budget_mem_available_mib() {
	_bma_kb=$(awk '/^MemAvailable:/ { print $2; exit }' "$_host/proc/meminfo" 2>/dev/null)
	case "$_bma_kb" in
	'' | *[!0123456789]*) return 1 ;;
	esac
	printf '%s\n' $((_bma_kb / 1024))
}

# _budget_clamp <derived> <floor> <ceiling> — sets _bc_value and _bc_note.
# Below the floor is raised AND said: the operator hears that this host is
# smaller than the percentage assumes. Above the ceiling is held in silence,
# because more headroom buys a worker nothing.
_budget_clamp() {
	_bc_value=$1 _bc_note=""
	if [ "$1" -lt "$2" ]; then
		_bc_value=$2 _bc_note="$1 is below the floor $2 — raised to the floor"
	elif [ "$1" -gt "$3" ]; then
		_bc_value=$3 _bc_note="$1 is above the ceiling $3 — held to the ceiling"
	fi
}

# _budget_nproc_limit — the per-user process limit (RLIMIT_NPROC) this
# session runs under: the number `ulimit -u` prints, read from
# /proc/self/limits so it comes through the same host seam as the cgroup
# ceiling and a suite can choose it. Prints the soft limit — a number, or
# "unlimited"; fails when the file has no such line.
_budget_nproc_limit() {
	_bnl=$(awk '/^Max processes/ { print $3; exit }' "$_host/proc/self/limits" 2>/dev/null)
	[ -n "$_bnl" ] || return 1
	printf '%s\n' "$_bnl"
}

# _budget_nproc_flag — the ulimit option that sets the per-user process limit
# under THIS sh, for the rlimit rung: -u for bash, zsh and ksh; -p for dash, which
# spells the same limit differently (it has no -u, and bash's -p is the pipe
# size, which cannot be set — so the order below is safe both ways). Found by
# CI, whose sh is dash. Probed by setting the limit to itself in a subshell;
# a shell with neither prints nothing, and that is the ladder's third rung.
_budget_nproc_flag() {
	for _bnf in -u -p; do
		if (ulimit "$_bnf" "$(ulimit "$_bnf" 2>/dev/null)") >/dev/null 2>&1; then
			printf '%s' "$_bnf"
			return 0
		fi
	done
	return 1
}

# _budget_rung — the highest rung of ADR-0006's ladder this host offers,
# probed rather than configured: a policy file cannot know what host it is
# on. `scope` needs systemd-run, a user manager that answers, AND the pids
# and memory controllers delegated to it — read from cgroup.controllers on
# this process's own cgroup, because a manager that answers is reachable,
# not necessarily able to bound: without `memory`, -p MemoryMax= is accepted
# and applies nothing. `scope-tasks` is pids delegated and memory not — the
# scope still carries the task bound, which is the incident's. `rlimit`
# needs a shell whose ulimit can set the process count; `none` is neither.
_budget_rung() {
	if command -v systemd-run >/dev/null 2>&1 && systemctl --user show --property=Version >/dev/null 2>&1; then
		_br_own=$(sed -n 's/^0:://p' "$_host/proc/self/cgroup" 2>/dev/null)
		_br_ctl=" $(cat "$_host/sys/fs/cgroup$_br_own/cgroup.controllers" 2>/dev/null) "
		# Two separate word tests: one pattern for both would need the space
		# between them twice, and a single space cannot be consumed twice.
		_br_pids=0 _br_memory=0
		case "$_br_ctl" in *" pids "*) _br_pids=1 ;; esac
		case "$_br_ctl" in *" memory "*) _br_memory=1 ;; esac
		if [ "$_br_pids" = 1 ] && [ "$_br_memory" = 1 ]; then
			echo scope
			return 0
		elif [ "$_br_pids" = 1 ]; then
			echo scope-tasks
			return 0
		fi
	fi
	if [ -n "$NPROC_FLAG" ]; then
		echo rlimit
	else
		echo none
	fi
}

# The budget's three modes: disabled by flag, inherited from an outer
# dispatch, or derived here. An inner dispatch derives nothing (ADR-0006
# clause 7): a scope opened inside a scope is a sibling, not a child, and
# would escape the outer's ceiling — so the outer's numbers arrive by
# environment and are taken as given.
#
# Where a host fact is missing — the per-user limit is unlimited or unreadable,
# /proc/meminfo has no MemAvailable — there is nothing to take a percentage
# of, and the policy CEILING stands in on both sides (clause 2): the most the
# policy lets one worker have, so the worker is bounded by the policy rather
# than by nothing. Never the floor, which answers a host KNOWN to be small.
#
# _budget_derive — sets BUDGET_MODE (derived, inherited, disabled), the two
# ceilings, where each came from, the rung and NPROC_FLAG, from the flags
# (BUDGET_TASKS_FLAG, BUDGET_MEMORY_FLAG, NO_BUDGET — empty and 0 for a
# sourcing caller), the environment and this host. Exits 2 on a policy value
# that cannot be a budget.
_budget_derive() {
	BUDGET_MODE="" BUDGET_TASKS="" BUDGET_TASKS_FROM="" BUDGET_MEMORY="" BUDGET_MEMORY_FROM="" BUDGET_RUNG=""
	NPROC_FLAG=$(_budget_nproc_flag) || NPROC_FLAG=""
	# One sourcing for the six; the status is checked here, where it can be.
	_bp_all=$(_read_policy_numbers \
		"AGENT_BUDGET_TASKS_PERCENT=$BUDGET_DEFAULT_TASKS_PERCENT" \
		"AGENT_BUDGET_TASKS_FLOOR=$BUDGET_DEFAULT_TASKS_FLOOR" \
		"AGENT_BUDGET_TASKS_CEILING=$BUDGET_DEFAULT_TASKS_CEILING" \
		"AGENT_BUDGET_MEMORY_PERCENT=$BUDGET_DEFAULT_MEMORY_PERCENT" \
		"AGENT_BUDGET_MEMORY_FLOOR_MIB=$BUDGET_DEFAULT_MEMORY_FLOOR_MIB" \
		"AGENT_BUDGET_MEMORY_CEILING_MIB=$BUDGET_DEFAULT_MEMORY_CEILING_MIB") || exit 2
	BUDGET_TASKS_PERCENT=${_bp_all%% *} _bp_all=${_bp_all#* }
	BUDGET_TASKS_FLOOR=${_bp_all%% *} _bp_all=${_bp_all#* }
	BUDGET_TASKS_CEILING=${_bp_all%% *} _bp_all=${_bp_all#* }
	BUDGET_MEMORY_PERCENT=${_bp_all%% *} _bp_all=${_bp_all#* }
	BUDGET_MEMORY_FLOOR=${_bp_all%% *} _bp_all=${_bp_all#* }
	BUDGET_MEMORY_CEILING=${_bp_all%% *}
	_budget_percent_below_100 TASKS_PERCENT "$BUDGET_TASKS_PERCENT"
	_budget_percent_below_100 MEMORY_PERCENT "$BUDGET_MEMORY_PERCENT"
	_budget_floor_at_most_ceiling TASKS_FLOOR "$BUDGET_TASKS_FLOOR" TASKS_CEILING "$BUDGET_TASKS_CEILING"
	_budget_floor_at_most_ceiling MEMORY_FLOOR_MIB "$BUDGET_MEMORY_FLOOR" MEMORY_CEILING_MIB "$BUDGET_MEMORY_CEILING"
	# Inherited is checked before disabled: an inner dispatch is already inside
	# the outer scope's cgroup, and --no-budget on it cannot leave (clause 7).
	if [ -n "${AGENT_DISPATCH_BUDGET_TASKS:-}" ]; then
		BUDGET_MODE=inherited
		BUDGET_TASKS=$AGENT_DISPATCH_BUDGET_TASKS
		BUDGET_MEMORY=${AGENT_DISPATCH_BUDGET_MEMORY_MIB:-}
		# Taken from the outer dispatch, but not on trust: the next release hands
		# these to the mechanism, and an outer dispatch exports both or neither.
		_whole_number "AGENT_DISPATCH_BUDGET_TASKS, inherited from the outer dispatch," "$BUDGET_TASKS"
		[ -n "$BUDGET_MEMORY" ] ||
			die "AGENT_DISPATCH_BUDGET_TASKS is set and AGENT_DISPATCH_BUDGET_MEMORY_MIB is not — an outer dispatch exports both or neither"
		_whole_number "AGENT_DISPATCH_BUDGET_MEMORY_MIB, inherited from the outer dispatch," "$BUDGET_MEMORY"
	elif [ "$NO_BUDGET" = 1 ]; then
		BUDGET_MODE=disabled
	else
		BUDGET_MODE=derived
		if [ -n "$BUDGET_TASKS_FLAG" ]; then
			BUDGET_TASKS=$BUDGET_TASKS_FLAG BUDGET_TASKS_FROM="--budget-tasks"
			[ "$BUDGET_TASKS" -lt "$BUDGET_TASKS_FLOOR" ] &&
				BUDGET_TASKS_FROM="$BUDGET_TASKS_FROM; below the floor $BUDGET_TASKS_FLOOR, honoured as given"
		elif _bt=$(_budget_session_tasks); then
			_bt_base=${_bt%% *} _bt_where=${_bt#* }
			_budget_clamp $((_bt_base * BUDGET_TASKS_PERCENT / 100)) "$BUDGET_TASKS_FLOOR" "$BUDGET_TASKS_CEILING"
			BUDGET_TASKS=$_bc_value
			BUDGET_TASKS_FROM="$BUDGET_TASKS_PERCENT% of $_bt_base, the pids.max of cgroup $_bt_where${_bc_note:+: $_bc_note}"
		else
			_bt_base=$(_budget_nproc_limit) || _bt_base=""
			case "$_bt_base" in
			'' | *[!0123456789]*)
				BUDGET_TASKS=$BUDGET_TASKS_CEILING
				BUDGET_TASKS_FROM="the policy ceiling — no cgroup on this session sets a task ceiling and the per-user process limit is ${_bt_base:-unreadable}"
				;;
			*)
				_budget_clamp $((_bt_base * BUDGET_TASKS_PERCENT / 100)) "$BUDGET_TASKS_FLOOR" "$BUDGET_TASKS_CEILING"
				BUDGET_TASKS=$_bc_value
				BUDGET_TASKS_FROM="$BUDGET_TASKS_PERCENT% of $_bt_base, the per-user process limit (RLIMIT_NPROC — no cgroup on this session sets a task ceiling)${_bc_note:+: $_bc_note}"
				;;
			esac
		fi
		if [ -n "$BUDGET_MEMORY_FLAG" ]; then
			BUDGET_MEMORY=$BUDGET_MEMORY_FLAG BUDGET_MEMORY_FROM="--budget-memory"
			[ "$BUDGET_MEMORY" -lt "$BUDGET_MEMORY_FLOOR" ] &&
				BUDGET_MEMORY_FROM="$BUDGET_MEMORY_FROM; below the floor $BUDGET_MEMORY_FLOOR, honoured as given"
		elif _bm_base=$(_budget_mem_available_mib); then
			_budget_clamp $((_bm_base * BUDGET_MEMORY_PERCENT / 100)) "$BUDGET_MEMORY_FLOOR" "$BUDGET_MEMORY_CEILING"
			BUDGET_MEMORY=$_bc_value
			BUDGET_MEMORY_FROM="$BUDGET_MEMORY_PERCENT% of $_bm_base MiB MemAvailable${_bc_note:+: $_bc_note}"
		else
			BUDGET_MEMORY=$BUDGET_MEMORY_CEILING
			BUDGET_MEMORY_FROM="the policy ceiling — /proc/meminfo has no MemAvailable to derive from"
		fi
		BUDGET_RUNG=$(_budget_rung)
	fi
}

# _budget_counters_text — the text of _cg_counters <cgroup path>, which sets
# _pm (pids.events max) and _ok (memory.events oom_kill), each `-` when its
# file could not be read. Printed as TEXT because it runs in another shell:
# sourced by the wrapper inside the scope and by the watchdog outside it,
# and by the wrapper tests/lib.sh runs a suite under. Builtins only, because
# inside the scope at the task ceiling a fork of its own — an awk, a sed —
# would itself be rejected. "Could not read" and "no ceiling hit" must not
# look alike (driver 4), hence `-`, never 0.
_budget_counters_text() {
	cat <<'CNT'
_cg_counters() {
	_pm=- _ok=-
	[ -n "$1" ] || return 0
	{ while read -r _k _v _rest; do case "$_k" in max) _pm=$_v ;; esac; done; } 2>/dev/null <"/sys/fs/cgroup$1/pids.events" || _pm=-
	{ while read -r _k _v _rest; do case "$_k" in oom_kill) _ok=$_v ;; esac; done; } 2>/dev/null <"/sys/fs/cgroup$1/memory.events" || _ok=-
}
CNT
}

# _budget_scope_props <rung> — sets SCOPE_PROPS, the properties a scope carries
# on that rung; the pre-flight and the real spawn open a scope with the same.
#
# OOMPolicy=continue and MemorySwapMax=0 REFINE clause 5's bare
# `-p MemoryMax=<MiB>M` (ADR-0006 records why): without OOMPolicy=continue this
# host tore the whole scope down on the first OOM and the wrapper never ran to
# read the counter clause 6 needs; without MemorySwapMax=0 the runaway filled
# swap for seconds and could trip systemd-oomd's pressure kill of the scope
# before MemoryMax bit. With both, the kernel OOM-kills the worker inside the
# cgroup, the wrapper survives, and the memory ceiling is observable at once.
_budget_scope_props() {
	if [ "$1" = scope ]; then
		SCOPE_PROPS="-p TasksMax=$BUDGET_TASKS -p MemoryMax=${BUDGET_MEMORY}M -p MemorySwapMax=0 -p OOMPolicy=continue"
	else
		SCOPE_PROPS="-p TasksMax=$BUDGET_TASKS -p OOMPolicy=continue"
	fi
}

# --- the dispatch proper starts here ----------------------------------------
# A sourcing caller has what it came for: the derivation, the rung, the scope
# properties and the counters reader, one definition. Nothing above this line
# parses an argument, sweeps scratch, resolves a tier or reads a prompt.
[ "$_dispatch_sourced" = 0 ] || return 0

set -u

TIER="" DOMAIN="" PROMPT_FILE="" PROMPT_TEXT="" DRY_RUN=0 HAVE_PROMPT=0 SETS_N=0 TIMEOUT=""

# _record_set <name> <value> — one marker substitution, into its own numbered
# pair of exported variables for the single awk pass below. The obvious
# alternative — accumulating "NAME=VALUE" lines in one string and reading them
# back — is what this replaced, and it was broken twice over: a value with a
# newline was truncated at the first one, and any line inside a value that
# looked like NAME=VALUE was promoted to a substitution of its own. Ticket
# bodies are untrusted content (AGENTS.md's trust boundary) and `%%BODY%%` is
# exactly where one goes. --set and --set-file both come through here, so their
# NAME shape-check cannot drift.
_record_set() {
	case "$1" in
	'' | [!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_]* | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_]*)
		die "a marker NAME must match [A-Za-z_][A-Za-z0-9_]*, got '$1'" ;;
	esac
	# A NAME twice is a caller mistake, not a last-wins convenience: which value
	# reached the worker would depend on argument order, which is exactly the
	# kind of quiet ambiguity a reviewer worker reading an untrusted body should
	# not be subject to.
	_rs_j=1
	while [ "$_rs_j" -le "$SETS_N" ]; do
		if [ "$(eval "printf '%s' \"\$PD_K_$_rs_j\"")" = "$1" ]; then
			die "marker '$1' is set twice — a NAME may appear in one --set or --set-file only"
		fi
		_rs_j=$((_rs_j + 1))
	done
	SETS_N=$((SETS_N + 1))
	# PD_F is cleared for EVERY pair, not only set on a --set-file: an inherited
	# PD_F_n from this shell (a nested dispatch, a stale export) would otherwise
	# make a plain --set read a file. --set-file sets it after this returns.
	eval "PD_K_$SETS_N=\$1; PD_V_$SETS_N=\$2; PD_F_$SETS_N="
	eval "export PD_K_$SETS_N PD_V_$SETS_N PD_F_$SETS_N"
}

while [ $# -gt 0 ]; do
	case "$1" in
	--prompt-file)
		[ $# -ge 2 ] || die "--prompt-file needs a path"
		PROMPT_FILE=$2 HAVE_PROMPT=1
		shift 2
		;;
	--prompt)
		[ $# -ge 2 ] || die "--prompt needs a value"
		PROMPT_TEXT=$2 HAVE_PROMPT=1
		shift 2
		;;
	--set)
		[ $# -ge 2 ] || die "--set needs NAME=VALUE"
		case "$2" in
		*=*) ;;
		*) die "--set takes NAME=VALUE, got '$2'" ;;
		esac
		_record_set "${2%%=*}" "${2#*=}"
		shift 2
		;;
	--set-file)
		# The value too large for argv: a --set value is one argv element, so a
		# big diff hits the exec ceiling. The file's bytes become the value,
		# whole, read the same way the inline form's are — through the
		# environment into the one awk pass — so a newline, a %%marker%% or a
		# pipe inside a diff is as safe here as there.
		[ $# -ge 2 ] || die "--set-file needs NAME=path"
		case "$2" in
		*=*) ;;
		*) die "--set-file takes NAME=path, got '$2'" ;;
		esac
		_sf_path=${2#*=}
		[ -e "$_sf_path" ] || die "--set-file path does not exist: $_sf_path"
		[ -d "$_sf_path" ] && die "--set-file path is a directory: $_sf_path"
		[ -r "$_sf_path" ] || die "--set-file path is not readable: $_sf_path"
		# The PATH is recorded, not the file's bytes: a megabyte in an
		# environment variable hits ARG_MAX at the worker's own exec just as it
		# would on argv. awk reads the file itself in the pass below, so nothing
		# large ever crosses an exec boundary.
		_record_set "${2%%=*}" ""
		eval "PD_F_$SETS_N=\$_sf_path; export PD_F_$SETS_N"
		shift 2
		;;
	--timeout)
		[ $# -ge 2 ] || die "--timeout needs a number of seconds"
		case "$2" in
		'' | *[!0123456789]*) die "--timeout takes a whole number of seconds, got '$2'" ;;
		0 | 0*) die "--timeout 0 is not a timeout. Omit the flag to run without one." ;;
		esac
		TIMEOUT=$2
		shift 2
		;;
	--budget-tasks)
		[ $# -ge 2 ] || die "--budget-tasks needs a number of tasks"
		_whole_number --budget-tasks "$2"
		BUDGET_TASKS_FLAG=$2
		shift 2
		;;
	--budget-memory)
		[ $# -ge 2 ] || die "--budget-memory needs a number of MiB"
		_whole_number --budget-memory "$2"
		BUDGET_MEMORY_FLAG=$2
		shift 2
		;;
	--no-budget)
		NO_BUDGET=1
		shift
		;;
	--dry-run)
		DRY_RUN=1
		shift
		;;
	--*)
		echo "x dispatch: unknown option '$1'." >&2
		usage
		exit 2
		;;
	*)
		if [ -z "$TIER" ]; then TIER=$1
		elif [ -z "$DOMAIN" ]; then DOMAIN=$1
		else
			echo "x dispatch: unexpected argument '$1'." >&2
			usage
			exit 2
		fi
		shift
		;;
	esac
done

[ -n "$TIER" ] || {
	usage
	exit 2
}

# --- the depth ---------------------------------------------------------------
# Before the tier is resolved and before the prompt is read: a dispatch that
# may not nest has nothing else worth checking, and in the runaway case every
# process spent past this point is one the host has lost. The default is the
# deepest legitimate shape today: a planner that dispatches implementers that
# dispatch reviewers, three deep. It is a ceiling on runaway nesting, not a
# budget, and the policy file raises it.
DEPTH_DEFAULT_MAX=3
DEPTH=${AGENT_DISPATCH_DEPTH:-1}
_whole_number "AGENT_DISPATCH_DEPTH (set by the dispatcher that spawned this worker; unset or empty means depth 1)" "$DEPTH"
# The SWEEP AGE rides this sourcing: it is the other whole-number policy
# value needed before the budget's own read (the sweep below runs before the
# scratch is made, and the budget is derived after), and one sourcing through
# one validator is how the two cannot disagree about a leading zero. What it
# means is explained where it is used.
SWEEP_DAYS_DEFAULT=1
_pn=$(_read_policy_numbers "AGENT_DISPATCH_MAX_DEPTH=$DEPTH_DEFAULT_MAX" "AGENT_DISPATCH_SWEEP_DAYS=$SWEEP_DAYS_DEFAULT") || exit 2
MAX_DEPTH=${_pn%% *} _pn=${_pn#* }
SWEEP_DAYS=${_pn%% *}
# Both are whole numbers from 1 now; this bound is the depth's own. One
# `[ -gt ]` must be able to compare them: past the shell's integer range `[`
# errors instead of comparing, and an error there would fail OPEN — the
# refusal skipped, the worker run. Nine digits is under every shell's range,
# and no dispatcher produces a depth anywhere near it.
DEPTH_MAX_DIGITS=9
[ "${#DEPTH}" -le "$DEPTH_MAX_DIGITS" ] ||
	die "AGENT_DISPATCH_DEPTH is past what a depth can be (at most $DEPTH_MAX_DIGITS digits), got '$DEPTH'"
[ "${#MAX_DEPTH}" -le "$DEPTH_MAX_DIGITS" ] ||
	die "AGENT_DISPATCH_MAX_DEPTH is past what a depth can be (at most $DEPTH_MAX_DIGITS digits), got '$MAX_DEPTH'"
if [ "$DEPTH" -gt "$MAX_DEPTH" ]; then
	# Read, more often than not, by the refused WORKER — a model with tools —
	# so this says what a worker does with it and never how to lift the
	# ceiling. The maximum is named by its variable, not by a path: the policy
	# file is wherever AGENTS_CONFIG resolved it, which need not be the default.
	echo "x dispatch: refusing to nest — this dispatch would run at depth $DEPTH and the maximum is $MAX_DEPTH." >&2
	echo "   The maximum is AGENT_DISPATCH_MAX_DEPTH in the agents policy file, and it is the" >&2
	echo "   operator's to change. A worker that sees this must stop and report it." >&2
	exit 4
fi

[ "$HAVE_PROMPT" = 1 ] || die "no prompt — pass --prompt-file or --prompt"
[ -n "$PROMPT_FILE" ] && [ -n "$PROMPT_TEXT" ] && die "--prompt-file and --prompt are alternatives, not a pair"
[ -n "$PROMPT_FILE" ] && [ ! -f "$PROMPT_FILE" ] && die "prompt file does not exist: $PROMPT_FILE"
[ -n "$PROMPT_FILE" ] && [ ! -s "$PROMPT_FILE" ] && die "prompt file is empty: $PROMPT_FILE
   A worker given nothing to do will invent something to do."
[ "$NO_BUDGET" = 1 ] && [ -n "$BUDGET_TASKS_FLAG$BUDGET_MEMORY_FLAG" ] &&
	die "--no-budget and a --budget-* override contradict each other. Pick one."

# --- resolution -------------------------------------------------------------
# Two calls rather than one parse of a joined value: the resolver owns the
# split, and a caller that re-implemented it here would be the second place the
# `<name>:<tag>` rule has to be right.
# Two calls, so two processes, so the resolver's once-per-process warning memo
# cannot span them and an unconfigured project heard the UNMAPPED warning twice.
# The --harness call is silenced: it asks a question whose answer for such a
# project is "none", and the --model call that follows says everything the
# operator needs to hear, once.
if [ -n "$DOMAIN" ]; then
	HARNESS=$(AGENTS_TIER_QUIET=1 sh "$LIB" --harness "$TIER" "$DOMAIN") || exit $?
	MODEL=$(sh "$LIB" --model "$TIER" "$DOMAIN") || exit $?
else
	HARNESS=$(AGENTS_TIER_QUIET=1 sh "$LIB" --harness "$TIER") || exit $?
	MODEL=$(sh "$LIB" --model "$TIER") || exit $?
fi

# --- the in-session case, which is the default and not a failure ------------
if [ -z "$HARNESS" ]; then
	echo "i  dispatch: tier '$TIER' names no agent harness — spawn it in your own session, as before." >&2
	[ -n "$MODEL" ] && printf '%s\n' "$MODEL"
	exit 3
fi

# The token reached here through the resolver's shape check and the project's
# own declaration, so it is already a `[a-z][a-z0-9-]*` token — safe to fold
# into a variable name the way a task domain is.
H_UPPER=$(printf '%s' "$HARNESS" | tr 'a-z-' 'A-Z_')

CMD_TEMPLATE=$(_read_policy "AGENT_HARNESS_${H_UPPER}_CMD")
FLAG_TEMPLATE=$(_read_policy "AGENT_HARNESS_${H_UPPER}_MODEL_FLAG")

[ -n "$CMD_TEMPLATE" ] || die "agent harness '$HARNESS' has no AGENT_HARNESS_${H_UPPER}_CMD in your agents config.
   The tier mapping names an agent harness the config never says how to invoke.
   Add it beside the tier mapping, e.g.
     AGENT_HARNESS_${H_UPPER}_CMD='$HARNESS ... {model_flag} < {prompt_file}'"

# --- the model id whitelist -------------------------------------------------
# THIS one is a boundary. The template is eval'd and the model id is
# interpolated into it, so an id carrying a quote, a semicolon or a backtick
# would be executed rather than passed. Model identifiers are drawn from a
# narrow alphabet in practice — letters, digits, and `. _ - : /`, the last for
# the `provider/model` form some CLIs use — and anything outside it is refused
# rather than escaped: refusing is checkable, escaping is a claim.
#
# The alphabet is spelled out rather than written as a range for the locale
# reason agents.lib.sh documents at its own two `case` sites: under en_US.UTF-8
# a bracket range collates case-insensitively, and a whitelist whose meaning
# moves with $LANG is not a whitelist.
#
# An EMPTY model is not refused. It means "this agent harness, on its own
# default", and the flag is omitted entirely below.
_alnum='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
if [ -n "$MODEL" ]; then
	case "$MODEL" in
	[!$_alnum]* | *[!$_alnum._:/-]*)
		die "model id '$MODEL' contains a character this script will not interpolate.
   Allowed: letters, digits, and . _ - : /
   The command template is eval'd, so an id outside that set is refused rather
   than escaped." ;;
	esac
fi

# --- the model flag ---------------------------------------------------------
# Omitting a parameter and passing "" are not the same request, and an agent
# harness is within its rights to reject the second. So an unmapped model
# removes the WHOLE flag, not just its value.
if [ -n "$MODEL" ] && [ -n "$FLAG_TEMPLATE" ]; then
	MODEL_FLAG=$(printf '%s' "$FLAG_TEMPLATE" | sed "s|{model}|$MODEL|g")
elif [ -n "$MODEL" ]; then
	# A project that wired no MODEL_FLAG but mapped a model has said where the
	# model goes nowhere. Better to say so than to drop it silently.
	die "agent harness '$HARNESS' maps a model but has no AGENT_HARNESS_${H_UPPER}_MODEL_FLAG.
   Without it there is nowhere to put '$MODEL'. Add it beside the command, e.g.
     AGENT_HARNESS_${H_UPPER}_MODEL_FLAG='--model {model}'"
else
	MODEL_FLAG=""
fi

# --- the prompt -------------------------------------------------------------
# Always a FILE, even when the caller passed text: the template redirects from
# {prompt_file}, and a prompt is prose that will contain quotes, newlines and
# code fences. Putting it on the command line would put all three through the
# shell.
SCRATCH=""
cleanup() { [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM HUP

# The prompt is ALWAYS staged into a file this script created, even when the
# caller passed one. The caller's path is data — a branch name becomes a
# worktree slug becomes a directory, and `;` `$` `(` `&` `|` and spaces are all
# legal in a branch name — and this path is interpolated into the eval'd
# template. Passing it through directly executed it: a prompt file under a
# directory named `a;$(touch PWNED)b` created PWNED.
#
# Staging is not by itself the fix, because $TMPDIR is also somebody else's
# data. So the temp location is held to the same refuse-don't-escape rule as
# the model id — before the sweep below reads it, and before the staged path
# under it is single-quoted at the substitution on top of that. mktemp fills
# the XXXXXX from letters and digits, so a location that passes yields a
# staged path that passes.
TMP_ROOT=${TMPDIR:-/tmp}
case "$TMP_ROOT" in
*[!$_alnum._/-]*)
	die "the temp location '$TMP_ROOT' contains a character this script will not
   interpolate into a command. TMPDIR is the usual cause — point it somewhere
   made of letters, digits and . _ - / and run again." ;;
esac

# --- dispatch scratch, and the stale scratch of dispatches that died ---------
# The scratch names itself. A bare `mktemp -d` named it tmp.XXXXXX, and a
# dispatch that never reaches its trap — KILL, a budget exceeded, a host out
# of tasks — leaves that behind with nothing to attribute it to: 267 on one
# host. With the prefix a leftover is dispatch scratch by name alone, and the
# sweep can act on the name.
SCRATCH_PREFIX='agent-dispatch.'

# The SWEEP AGE, in whole days, from the policy file beside the tier mapping
# — read above with the depth maximum, through the same validator. A sibling
# carrying the prefix that is at least this old is removed before this
# dispatch makes its own; a younger one may be a dispatch still running and
# is left alone; anything without the prefix is never touched. Days rather
# than minutes because `find -mtime` is the age test POSIX has (`-mmin` and
# `-maxdepth` are not POSIX), and one day already exceeds any --timeout a
# dispatch plausibly runs under. That is the invariant the sweep rests on, so
# it is enforced where it lives: a --timeout that reaches the sweep age is
# refused rather than left for a later dispatch to sweep mid-run.
#
# The sweep sits here, after the depth refusal and the in-session exit, on
# purpose: a dispatch refused for nesting, or one that spawns nothing, sweeps
# nothing — in the runaway case every process spent past the refusal is one
# the host has lost, and a find over /tmp spawns several.
SECONDS_PER_DAY=86400
if [ -n "$TIMEOUT" ] && [ $((TIMEOUT / SECONDS_PER_DAY)) -ge "$SWEEP_DAYS" ]; then
	die "--timeout ${TIMEOUT}s reaches the sweep age of $SWEEP_DAYS day(s).
   A later dispatch on this host would sweep this one's scratch while its
   worker still runs. Raise AGENT_DISPATCH_SWEEP_DAYS in your agents config,
   or shorten the timeout."
fi

# A dry run runs nothing, and that includes the sweep.
if [ "$DRY_RUN" != 1 ]; then
	# POSIX find only: `dir/.` with `! -name . -prune` is the portable spelling
	# of depth one, and `-mtime +n` is true once the whole days elapsed exceed
	# n, so "at least N days old" is +(N-1). find hands each path to rm whole,
	# so a name with a space in it is never split into a second, relative
	# path; -print follows only a removal that succeeded, so the count is of
	# what actually went. Two defences against a shared /tmp are in the
	# predicates rather than beside them: find is PHYSICAL here — no -L, no
	# -H — so a planted `agent-dispatch.* -> ~` is a link, not a directory,
	# and `-type d` never hands it to rm; and a sibling owned by someone else
	# fails at rm on a sticky /tmp, so it goes uncounted rather than
	# half-removed. Dropping `-type d` or adding `-L` reopens the first.
	_swept=$(find "$TMP_ROOT/." ! -name . -prune -type d -name "${SCRATCH_PREFIX}*" \
		-mtime "+$((SWEEP_DAYS - 1))" -exec rm -rf {} \; -print 2>/dev/null | wc -l | tr -d ' ')
	if [ "$_swept" -gt 0 ]; then
		echo "i  dispatch: swept $_swept stale dispatch scratch under $TMP_ROOT — at least $SWEEP_DAYS day(s) old, left by dispatches that never reached their trap" >&2
	fi
fi

SCRATCH=$(mktemp -d "$TMP_ROOT/${SCRATCH_PREFIX}XXXXXX") || die "cannot create a scratch directory under $TMP_ROOT"
_staged="$SCRATCH/prompt.md"
if [ -n "$PROMPT_FILE" ]; then
	cat -- "$PROMPT_FILE" >"$_staged" || die "cannot read the prompt file: $PROMPT_FILE"
else
	printf '%s\n' "$PROMPT_TEXT" >"$_staged"
fi
PROMPT_FILE="$_staged"

# --- the editor's header ----------------------------------------------------
# A prompt template opens with an HTML comment addressed to whoever EDITS it:
# which markers exist, why the file is shaped the way it is. Every template in
# .agents/prompts/ ends that header with "everything below is sent to the model
# verbatim", and this step is what makes the sentence true.
#
# Stripping it is not cosmetic. The header documents the markers BY WRITING
# THEM, so substituting first rewrites the documentation into nonsense and
# sends it as the worker's opening instruction.
#
# Only a header at the very TOP goes, and only through the first `-->`. A
# comment further down is content: a prompt may legitimately show markup.
if [ "$(head -n 1 "$PROMPT_FILE" 2>/dev/null)" = "<!--" ]; then
	# The terminator is a line that IS `-->`, not a line that CONTAINS one.
	# Matching anywhere closed the header early on any `-->` inside it — a
	# fenced example, or prose — and the rest of the header was then filled and
	# sent as the worker's opening instruction, which is the exact outcome
	# stripping before substituting exists to prevent.
	#
	# An UNTERMINATED header is not stripped at all. Dropping to end-of-file
	# left a zero-byte prompt, and the emptiness check runs before this point,
	# so the worker was exec'd with nothing to do and exited 0.
	# awk's status is read on its OWN, not through a pipeline: the exit status
	# of `awk … | sed …` is SED's, so the unterminated-header branch below
	# never ran and the empty prompt went out anyway. Found by testing the
	# branch rather than by reading it.
	if awk 'NR==1 && $0=="<!--" { inhdr=1; next }
	        inhdr { if ($0 == "-->") { inhdr=0; seen=1 } ; next }
	        { print }
	        END { exit(seen ? 0 : 1) }' "$PROMPT_FILE" >"$SCRATCH/header-stripped.md"; then
		sed '/./,$!d' "$SCRATCH/header-stripped.md" >"$SCRATCH/stripped.md" &&
			mv "$SCRATCH/stripped.md" "$PROMPT_FILE"
		rm -f "$SCRATCH/header-stripped.md"
	else
		rm -f "$SCRATCH/header-stripped.md" "$SCRATCH/stripped.md"
		echo "!  dispatch: the prompt opens with '<!--' and never closes it on a line of" >&2
		echo "   its own. Leaving the header in rather than sending an empty prompt." >&2
	fi
	[ -s "$PROMPT_FILE" ] || die "the prompt is empty after its editor header was stripped.
   A worker given nothing to do will invent something to do."
fi

# --- marker substitution ----------------------------------------------------
# `%%NAME%%`, filled by --set. The syntax and the reasoning are
# templates/workflows/ai-review-prompt.md's, which explains why the markers are
# not any agent harness's own expression syntax: an expression inside a data
# file is never expanded, because it is evaluated by whatever READS the file.
# The reading step does the substitution — there, the workflow; here, this
# script.
#
# The prompt was already staged into a file this script created, so filling it
# in place cannot touch the caller's template. That matters: a template is read
# many times with different values, and a dispatcher that consumed its own
# input would work exactly once.
if [ "$SETS_N" -gt 0 ]; then
	# ONE pass over the file, scanning each line left to right and splicing the
	# first marker that matches at the current position. Two things follow from
	# that shape, and both were bugs in the per-pair version it replaced:
	#
	#   - a value is never re-scanned, so `--set 'A=[%%B%%]' --set B=bee` leaves
	#     `[%%B%%]` whatever order the pairs arrive in. A value is data, not a
	#     template, and reading it as one made the result order-dependent.
	#   - an inline value comes from the environment and a --set-file value is
	#     read from its file here, so a newline in either is just a character
	#     and a value too large for argv never crosses an exec.
	PD_N=$SETS_N
	export PD_N
	awk '
		BEGIN {
			n = ENVIRON["PD_N"] + 0
			for (i = 1; i <= n; i++) {
				k[i] = "%%" ENVIRON["PD_K_" i] "%%"
				kl[i] = length(k[i])
				path = ENVIRON["PD_F_" i]
				if (path != "") {
					# A --set-file value: read the file whole, here, so it never
					# crosses an exec. getline drops each line separator and this
					# rejoins with a newline, so a file with no trailing newline
					# gains one; a diff always ends with one, which is the case
					# this exists for.
					# A SCALAR accumulator, assigned to the array once at the
					# end: appending to an array element defeats the
					# in-place string-growth optimisation and made this
					# quadratic in the line count — 8 MiB took eighteen
					# seconds. A scalar does it in milliseconds.
					s = ""
					while ((getline ln < path) > 0) s = s ln "\n"
					close(path)
					v[i] = s
				} else {
					v[i] = ENVIRON["PD_V_" i]
				}
			}
		}
		{
			line = $0; out = ""; pos = 1; len = length(line)
			while (pos <= len) {
				hit = 0
				for (i = 1; i <= n; i++) {
					if (substr(line, pos, kl[i]) == k[i]) {
						out = out v[i]; pos += kl[i]; hit = 1; break
					}
				}
				if (!hit) { out = out substr(line, pos, 1); pos++ }
			}
			print out
		}
	' "$PROMPT_FILE" >"$PROMPT_FILE.tmp" ||
		die "substituting markers failed — a --set-file may be unreadable or too large for memory"
	mv "$PROMPT_FILE.tmp" "$PROMPT_FILE"
fi

# An unfilled marker is a caller that forgot one, and it reaches the worker as
# literal `%%TICKET%%` — which the worker will cheerfully reason about. Say so;
# do not refuse, because a prompt may legitimately discuss the syntax itself.
if grep -q '%%[A-Za-z_][A-Za-z0-9_]*%%' "$PROMPT_FILE" 2>/dev/null; then
	echo "!  dispatch: the prompt still carries unfilled markers:" >&2
	grep -o '%%[A-Za-z_][A-Za-z0-9_]*%%' "$PROMPT_FILE" | sort -u | sed 's/^/     /' >&2
fi

# --- expansion --------------------------------------------------------------
# `|` is the sed delimiter because it is excluded from the model whitelist above
# and from any path mktemp produces, so neither substitution can close the
# expression early.
# The path is single-quoted as well as whitelisted: the whitelist keeps the
# sed expression and the eval intact, and the quotes keep a path with a space
# in it one word to the redirect. Belt and braces, because this is the value
# that got it wrong once.
CMD=$(printf '%s' "$CMD_TEMPLATE" |
	sed -e "s|{model_flag}|$MODEL_FLAG|g" -e "s|{prompt_file}|'$PROMPT_FILE'|g")

# The command's own name, checked before anything runs, so an uninstalled agent
# harness reports itself rather than surfacing as a shell "not found" mixed into
# the worker's output, where a caller would read it as the worker's answer.
# The command's own name, checked before anything runs. Leading `VAR=value`
# words are skipped: a template that sets an environment variable for the
# worker is the natural way to write one, and taking the first word blindly
# reported `FOO=1` as a missing program.
CMD_REST=$CMD
while :; do
	CMD_BIN=${CMD_REST%% *}
	case "$CMD_BIN" in
	[!=]*=*)
		_next=${CMD_REST#* }
		[ "$_next" = "$CMD_REST" ] && break
		CMD_REST=$_next
		;;
	*) break ;;
	esac
done
command -v "$CMD_BIN" >/dev/null 2>&1 ||
	die "agent harness '$HARNESS' invokes '$CMD_BIN', which is not on PATH."

# --- the budget: derived here, applied at the foot of this file ------------
_budget_derive

# --- announce, once, on stderr — for a dry run and a real dispatch alike -----
# ADR-0006 clause 8: the floor note, the off switch, the inherited-no-escape
# note and the no-mechanism note are said on EVERY dispatch, not only the dry
# run. stdout stays the dry run's; this is the half an operator piping stdout
# still hears.
_budget_announce() {
	case "$BUDGET_MODE" in
	disabled)
		echo "!  dispatch: --no-budget — this worker has no budget of its own. A runaway worker" >&2
		echo "   then takes the session's whole task ceiling and memory with it." >&2
		;;
	inherited)
		if [ "$NO_BUDGET" = 1 ]; then
			echo "!  dispatch: --no-budget cannot escape the outer dispatch's budget — this dispatch is" >&2
			echo "   inside its cgroup, and no flag on an inner dispatch can leave it." >&2
		fi
		;;
	derived)
		case "$BUDGET_TASKS_FROM$BUDGET_MEMORY_FROM" in
		*"below the floor"*)
			echo "!  dispatch: a budget is below the floor — see the budget line. A worker" >&2
			echo "   that small cannot do useful work: a derived value was raised to the floor, and" >&2
			echo "   the host then leaves the session less margin than AGENT_BUDGET_*_PERCENT" >&2
			echo "   intends; an explicit --budget-* value is honoured as given." >&2
			;;
		esac
		if [ "$BUDGET_RUNG" = none ]; then
			echo "!  dispatch: no user service manager and no rlimit on this host — the budget is" >&2
			echo "   announced and not applied. The worker runs unbounded, as before." >&2
		fi
		;;
	esac
}

if [ "$DRY_RUN" = 1 ]; then
	printf 'tier:           %s%s\n' "$TIER" "${DOMAIN:+ (domain: $DOMAIN)}"
	printf 'agent harness:  %s\n' "$HARNESS"
	# The default text is a plain variable, not a ${VAR:-word} default: bash
	# treats an apostrophe inside ${...} as quoting even within double quotes,
	# so "harness's" there unbalanced every quote in the rest of the file. sh
	# and zsh parsed it happily, which is exactly why the three-shell check
	# exists.
	_shown_model=$MODEL
	[ -n "$_shown_model" ] || _shown_model="<the default model of that agent harness>"
	printf 'model:          %s\n' "$_shown_model"
	printf 'command:        %s\n' "$CMD"
	printf 'depth:          %s of %s\n' "$DEPTH" "$MAX_DEPTH"
	[ -n "$TIMEOUT" ] && printf 'timeout:        %ss\n' "$TIMEOUT"
	# The budget: the numbers, the rung, and that it IS enforced (ADR-0006
	# clause 8). The floor note and the off switch are said on stderr by
	# _budget_announce below, where an operator piping stdout still hears them.
	case "$BUDGET_MODE" in
	disabled)
		printf 'budget:         DISABLED by --no-budget — the worker runs under the session'"'"'s own ceilings\n'
		printf '                enforced: no — --no-budget was given\n'
		;;
	inherited)
		printf 'budget:         inherited from the outer dispatch — tasks %s, memory %s MiB; not opened again,\n' "$BUDGET_TASKS" "$BUDGET_MEMORY"
		printf '                a nested worker shares the outer ceiling\n'
		if [ "$NO_BUDGET" = 1 ]; then
			printf '                --no-budget cannot escape it: this dispatch is inside the outer dispatch'"'"'s cgroup\n'
		fi
		printf '                enforced: by the outer dispatch — this dispatch opens no scope of its own\n'
		;;
	derived)
		printf 'budget:         tasks %s — %s (floor %s, ceiling %s)\n' "$BUDGET_TASKS" "$BUDGET_TASKS_FROM" "$BUDGET_TASKS_FLOOR" "$BUDGET_TASKS_CEILING"
		printf '                memory %s MiB — %s (floor %s, ceiling %s)\n' "$BUDGET_MEMORY" "$BUDGET_MEMORY_FROM" "$BUDGET_MEMORY_FLOOR" "$BUDGET_MEMORY_CEILING"
		case "$BUDGET_RUNG" in
		scope) printf '                rung: a transient scope under the user service manager (systemd-run --user --scope,\n                TasksMax and MemoryMax on the worker'"'"'s own cgroup, shared by its whole tree)\n' ;;
		scope-tasks) printf '                rung: a transient scope under the user service manager for the task ceiling (systemd-run\n                --user --scope, TasksMax on the worker'"'"'s own cgroup); the memory controller is not delegated\n                to the user manager on this host, so the memory ceiling is announced and not applied\n' ;;
		rlimit) printf '                rung: rlimits in the worker'"'"'s shell (ulimit %s, ulimit -d) — weaker: no user service\n                manager answered, or it has no pids controller delegated; per process, and the task\n                count is the user'"'"'s, not the tree'"'"'s\n' "$NPROC_FLAG" ;;
		*) printf '                rung: NONE — no user service manager and no rlimit; the budget is announced and not applied\n' ;;
		esac
		case "$BUDGET_RUNG" in
		scope) printf '                enforced: yes — the worker runs inside the scope; a task or memory ceiling hit exits 71\n' ;;
		scope-tasks) printf '                enforced: the task ceiling yes (71 on a hit); the memory ceiling is announced only\n' ;;
		rlimit) printf '                enforced: best-effort via rlimits; a ceiling hit is not observable, so the worker'"'"'s own status passes through\n' ;;
		*) printf '                enforced: no — no mechanism on this host; the budget is announced only\n' ;;
		esac
		;;
	esac
	_budget_announce
	printf '\n--- prompt (%s bytes) ---\n' "$(wc -c <"$PROMPT_FILE" | tr -d ' ')"
	cat "$PROMPT_FILE"
	printf '\n--- end prompt ---\n'
	exit 0
fi

echo "i  dispatch: tier '$TIER' -> agent harness '$HARNESS', model '${MODEL:-<default>}'" >&2
# The worker runs one level deeper than this dispatch, and a dispatch it runs
# reads that on entry. Exported here, above both spawn paths, so the plain
# eval and the timed `sh -c` cannot disagree about it.
AGENT_DISPATCH_DEPTH=$((DEPTH + 1))
export AGENT_DISPATCH_DEPTH

# The budget travels to a nested dispatch the way the depth does — through the
# environment (ADR-0006 clause 7). A derived or an inherited budget is exported
# so an inner dispatch inherits it and opens NO second scope: a scope opened
# inside a scope is a sibling that escapes this one's cgroup. Both names or
# neither, held to the inherited validator on the way in. A disabled budget
# exports nothing, so an inner dispatch derives its own.
if [ "$BUDGET_MODE" = derived ] || [ "$BUDGET_MODE" = inherited ]; then
	AGENT_DISPATCH_BUDGET_TASKS=$BUDGET_TASKS
	AGENT_DISPATCH_BUDGET_MEMORY_MIB=$BUDGET_MEMORY
	export AGENT_DISPATCH_BUDGET_TASKS AGENT_DISPATCH_BUDGET_MEMORY_MIB
fi

_budget_announce

# --- how the worker is run, by rung -----------------------------------------
# The budget is applied by WRAPPING the worker command, so the plain path and
# the timed path run one string either way. Only a DERIVED budget wraps: an
# inherited one is already inside the outer scope's cgroup and opens nothing, a
# disabled one runs bare on purpose.
#
# SCOPE_STARTED / SCOPE_VERDICT are how the scope rung reports back. A wrapper
# inside the scope writes SCOPE_STARTED before it runs the worker — so a
# wrapper that never started (the scope torn down before its first line, or
# the scratch removed under an untimed dispatch older than the sweep age) is
# told from a worker that merely exited non-zero — and, after the worker exits
# and before the scope empties, writes the pids.events / memory.events counters
# to SCOPE_VERDICT. The verdict is that flag, never the worker's own status
# (clause 6). The wrapper does NO fork after the worker: it reads the cgroup
# files with shell builtins, because at the task ceiling a fork of its own —
# an awk, a sed — would itself be rejected and the verdict lost.
SCOPE_STARTED="$SCRATCH/scope-started"
SCOPE_VERDICT="$SCRATCH/scope-verdict"
# The scope is named after the scratch, so the dispatcher can reach the whole
# cgroup after the spawn — on a timeout, the ppid walk finds only the subtree
# still under the worker, and a child the worker double-forked has been
# re-parented out of it before the snapshot; the cgroup still holds it. The
# mktemp suffix is letters and digits, a valid unit name as it stands.
SCOPE_UNIT="agent-dispatch-${SCRATCH##*.}.scope"
SCOPE_COUNTERS="$SCRATCH/scope-counters.sh"
_budget_counters_text >"$SCOPE_COUNTERS"

# _budget_build_run_cmd <rung> — sets RUN_CMD, the command both spawn paths run.
# A scope rung also writes the wrapper it runs.
_budget_build_run_cmd() {
	case "$1" in
	scope | scope-tasks)
		# The wrapper takes its two paths and the worker command as arguments
		# — positional parameters are not inherited, so none of the three
		# reaches the worker's environment (the worker sees only the
		# AGENT_DISPATCH_* names the file documents). The command is
		# single-quoted into the string; the quote itself is the one character
		# that needs escaping inside single quotes.
		cat >"$SCRATCH/scope-wrapper.sh" <<'WRAP'
. "${0%/*}/scope-counters.sh"
_own=""
while IFS= read -r _l; do case "$_l" in 0::*) _own=${_l#0::} ;; esac; done </proc/self/cgroup 2>/dev/null
: >"$1"
eval "$3"
_st=$?
_cg_counters "$_own"
printf '%s %s %s\n' "$_pm" "$_ok" "$_st" >"$2"
exit "$_st"
WRAP
		_cmd_quoted=$(printf '%s\n' "$CMD" | sed "s/'/'\\\\''/g")
		_budget_scope_props "$1"
		RUN_CMD="systemd-run --user --scope --unit='${SCOPE_UNIT%.scope}' $SCOPE_PROPS --quiet sh '$SCRATCH/scope-wrapper.sh' '$SCOPE_STARTED' '$SCOPE_VERDICT' '$_cmd_quoted'"
		;;
	rlimit)
		# ulimit in the worker's shell, before the worker: -u/-p for the task
		# count, -d for the data segment (KiB). Weaker, per ADR-0006:
		# RLIMIT_NPROC counts the uid, and RLIMIT_DATA is per process. A ceiling
		# hit here is not observable, so the worker's own status passes through.
		# The string always runs under its own `sh` (both spawn paths), so the
		# limits die with the worker rather than binding this script — whose
		# cleanup would then be the fork that fails. The flag is chosen where the
		# ulimit runs, not where it was probed: the probe's shell is this one, the
		# string's is `sh`, and on a dash host the two spell it differently. A
		# refused ulimit is heard, and the worker still runs — the rung degrades
		# to the announced no-op for that ceiling, loudly.
		RUN_CMD="_nf=-u; ulimit -u >/dev/null 2>&1 || _nf=-p; ulimit \$_nf $BUDGET_TASKS || echo '!  dispatch: ulimit refused the task ceiling $BUDGET_TASKS — the rlimit rung applies no task bound' >&2; ulimit -d $((BUDGET_MEMORY * 1024)) || echo '!  dispatch: ulimit -d refused the memory ceiling $BUDGET_MEMORY MiB — the rlimit rung applies no memory bound' >&2; $CMD"
		;;
	*)
		RUN_CMD=$CMD
		;;
	esac
}

# The rung the worker actually runs under: a derived budget takes the probed
# rung; an inherited or disabled one runs bare, opening nothing.
if [ "$BUDGET_MODE" = derived ]; then
	RUN_RUNG=$BUDGET_RUNG
else
	RUN_RUNG=none
fi

# --- the scope rung is decided BEFORE the spawn -----------------------------
# systemd-run can refuse after the probe passed — the bus gone between probe
# and spawn, a manager that will not create scopes (ADR-0006 clause 5). So an
# empty scope with the real properties is opened and closed first, in
# milliseconds; a refusal there falls to the weaker rung, loudly, with
# systemd-run's own message. After the real spawn nothing is retried: the
# started marker is a file, and a file the worker's tree or a sweep can remove
# must never be what runs the worker a second time — a missing marker after
# the spawn is reported by _budget_verdict, never acted on.
_budget_scope_preflight() {
	_budget_scope_props "$1"
	# eval, as the spawn paths do: zsh does not split an unquoted expansion.
	_pf_err=$(eval "systemd-run --user --scope $SCOPE_PROPS --quiet true" 2>&1 >/dev/null) && return 0
	echo "!  dispatch: the transient scope cannot open — systemd-run refused after the probe passed:" >&2
	echo "   ${_pf_err:-(no message)}" >&2
	echo "   Running the worker under the weaker rlimit rung instead." >&2
	return 1
}
case "$RUN_RUNG" in
scope | scope-tasks)
	if ! _budget_scope_preflight "$RUN_RUNG"; then
		if [ -n "$NPROC_FLAG" ]; then
			RUN_RUNG=rlimit
		else
			RUN_RUNG=none
		fi
	fi
	;;
esac
_budget_build_run_cmd "$RUN_RUNG"

# --- the process-tree helpers (shared by the timed path) --------------------
# setsid would give one process group to signal but is not POSIX; walking
# `ps -A -o pid= -o ppid=` is.
_tree_of() {
	# Every descendant of $1, deepest last, then $1 itself — so TERM reaches
	# the leaves before their parents and a parent cannot respawn a child that
	# was already signalled.
	_to_kids=$(ps -A -o pid= -o ppid= 2>/dev/null | awk -v p="$1" '$2 == p { print $1 }')
	for _to_k in $_to_kids; do _tree_of "$_to_k"; done
	printf '%s\n' "$1"
}
_signal_list() {
	# $1 signal, rest pids. Failures are expected — a pid may be gone already.
	_sl_sig=$1
	shift
	for _sl_p in "$@"; do kill "-$_sl_sig" "$_sl_p" 2>/dev/null; done
}
# _scope_kill <signal> — the whole cgroup, orphans included; nothing to do off
# the scope rungs, and nothing to say when the scope is already gone.
_scope_kill() {
	case "$RUN_RUNG" in
	scope | scope-tasks) systemctl --user kill -s "$1" "$SCOPE_UNIT" >/dev/null 2>&1 ;;
	esac
}
# _scope_counters_now — on a scope rung, read the scope's counters from OUTSIDE
# it into SCOPE_VERDICT unless the wrapper already wrote them. For the watchdog,
# before it signals: once the scope empties its cgroup and the counters are
# gone, and a ceiling hit before the watchdog fired is the earlier event.
_scope_counters_now() {
	case "$RUN_RUNG" in
	scope | scope-tasks) ;;
	*) return 0 ;;
	esac
	[ -f "$SCOPE_VERDICT" ] && return 0
	_scn_cg=$(systemctl --user show -p ControlGroup --value "$SCOPE_UNIT" 2>/dev/null)
	[ -n "$_scn_cg" ] || return 0
	. "$SCOPE_COUNTERS"
	_cg_counters "$_scn_cg"
	printf '%s %s %s\n' "$_pm" "$_ok" 124 >"$SCOPE_VERDICT"
}
_down() {
	# Take the worker's tree and the watchdog down. Idempotent; safe to call
	# from the trap and from the normal path both.
	[ -n "${_worker:-}" ] && _signal_list TERM $(_tree_of "$_worker")
	[ -n "${_watchdog:-}" ] && _signal_list TERM $(_tree_of "$_watchdog")
	_scope_kill TERM
}

# _spawn_run — run RUN_CMD, untimed or under the watchdog. Sets _worker_status,
# and _timed_out=1 when the watchdog fired (the caller then exits 124). The
# budget verdict is the caller's, read from what the run left behind, so this
# does not exit on its own except on a signal to the dispatcher itself.
#
# Four things the first version of the timed path got wrong, each found by
# review:
#
#   1. The worker's process TREE is snapshotted ONCE, before any signal, and
#      that same list is signalled twice — TERM, a grace, then KILL. Walking
#      the tree after TERM found nothing, because a killed parent's children
#      are reparented to init and no longer under the worker's pid; a worker
#      that ignored TERM therefore ran to completion while this script said
#      "killed". An agent CLI is a node or python process under a shell, and
#      the shell dying is not the CLI dying.
#   2. The verdict is a FLAG the watchdog writes before it signals, not an
#      inference from the worker's exit status. Reading 143 as "timed out"
#      was wrong both ways: a worker that trapped TERM and exited 0 reported
#      success with "timed out" on stderr, and a worker that killed itself
#      reported a timeout with no message.
#   3. The watchdog is killed WITH its sleep. Killing the subshell alone left
#      `sleep N` holding this script's stdout, so any caller capturing output
#      waited the whole timeout after a worker that finished in a second.
#   4. This script traps its own INT/TERM/HUP and takes the worker and the
#      watchdog down with it. Backgrounded children of a non-interactive
#      shell start with SIGINT ignored, so a Ctrl-C on the dispatcher used to
#      leave the worker running with no timeout left.
_spawn_run() {
	_timed_out=0
	# The worker never inherits this script's stdin. Found live: an agent CLI
	# that reads stdin when it is not a tty blocked forever on the dispatcher's
	# own inherited pipe. The prompt reaches the worker by {prompt_file}; a
	# template that redirects `< {prompt_file}` still wins over this </dev/null.
	if [ -z "$TIMEOUT" ]; then
		if [ "$RUN_RUNG" = rlimit ]; then
			sh -c "$RUN_CMD" </dev/null
		else
			eval "$RUN_CMD" </dev/null
		fi
		_worker_status=$?
		return 0
	fi
	# Headless agent CLIs gate tool calls on approvals, and headless there is no
	# human: a reviewer told to run `git diff` in an approval-gated mode waits
	# forever. Found live; only an external timeout ended it.
	TIMED_OUT="$SCRATCH/timed-out"
	rm -f "$TIMED_OUT"
	trap '_down; cleanup; exit 130' INT
	trap '_down; cleanup; exit 143' TERM
	trap '_down; cleanup; exit 129' HUP
	sh -c "$RUN_CMD" </dev/null &
	_worker=$!
	(
		sleep "$TIMEOUT" &
		_wd_sleep=$!
		# The watchdog dies with its sleep: a TERM here forwards to the sleep, so
		# reaping the watchdog never leaves a sleeper holding the caller's stdout.
		trap 'kill "$_wd_sleep" 2>/dev/null; exit 0' TERM
		wait "$_wd_sleep" || exit 0
		# Verdict first, then the snapshot, then the signals — so a worker that
		# dies from TERM on line one of its handler still reads as a timeout, and
		# a child reparented by its parent's death is still on the list it is
		# about to be sent.
		: >"$TIMED_OUT"
		echo "!  dispatch: worker timed out after ${TIMEOUT}s — killing its process tree" >&2
		_scope_counters_now
		_wd_list=$(_tree_of "$_worker")
		_signal_list TERM $_wd_list
		sleep 1
		_signal_list KILL $_wd_list
		_scope_kill KILL
	) &
	_watchdog=$!
	wait "$_worker" 2>/dev/null
	_worker_status=$?
	if [ -f "$TIMED_OUT" ]; then
		# The watchdog fired: let it finish its KILL pass rather than racing it.
		wait "$_watchdog" 2>/dev/null
		_timed_out=1
		return 0
	fi
	# The worker finished in time. The watchdog and its sleep go together.
	kill -TERM "$_watchdog" 2>/dev/null
	wait "$_watchdog" 2>/dev/null
	return 0
}

# _budget_verdict — exit with the verdict for the run just finished. On a scope
# rung the flag is the cgroup counters the wrapper wrote: a task ceiling hit
# (pids.events max > 0) or, on the full scope rung, a memory ceiling hit
# (memory.events oom_kill > 0) exits 71 and names which was hit. On the rlimit
# and no-op rungs there is no counter, and the worker's own status passes
# through (ADR-0006 clause 6).
#
# A verdict that cannot be read is its own outcome, said on stderr, with the
# run's own status passed through — never a silent zero (driver 4): the marker
# missing (the wrapper never ran), the verdict file missing or malformed (the
# wrapper did not survive to write it — systemd-oomd's pressure kill takes
# every process in the cgroup, wrapper included; OOMPolicy=continue governs
# the unit afterwards and exempts nothing), or a counter the wrapper marked
# unreadable.
_budget_unread() {
	echo "!  dispatch: $1" >&2
	echo "   The budget verdict cannot be read; the run's own status ($_worker_status) passes through." >&2
	exit "$_worker_status"
}
# _budget_ceiling_hit — sets _hit to TASK, MEMORY or "" from a verdict file
# that reads cleanly; returns 1 with the reason in _unread when it does not.
_budget_ceiling_hit() {
	_hit="" _unread=""
	if [ ! -f "$SCOPE_STARTED" ]; then
		_unread="the scope's started marker is missing after the spawn — the scope was torn
   down before the worker started, or this dispatch's scratch was removed under it."
		return 1
	fi
	if [ ! -f "$SCOPE_VERDICT" ]; then
		_unread="the scope's verdict file is missing — the wrapper did not survive to write it
   (the scope was torn down, or a pressure kill took the wrapper with the worker)."
		return 1
	fi
	_v_pids="" _v_oom="" _v_rest=""
	read _v_pids _v_oom _v_rest <"$SCOPE_VERDICT" 2>/dev/null || true
	case "$_v_pids" in
	-) _unread="the pids.events counter could not be read inside the scope."; return 1 ;;
	'' | *[!0123456789]*) _unread="the scope's verdict file is malformed ('$_v_pids $_v_oom $_v_rest')."; return 1 ;;
	esac
	case "$_v_oom" in
	-)
		if [ "$RUN_RUNG" = scope ]; then
			_unread="the memory.events counter could not be read inside the scope."
			return 1
		fi
		;;
	'' | *[!0123456789]*) _unread="the scope's verdict file is malformed ('$_v_pids $_v_oom $_v_rest')."; return 1 ;;
	esac
	if [ "$_v_pids" -gt 0 ]; then
		_hit=TASK
	elif [ "$RUN_RUNG" = scope ] && [ "$_v_oom" -gt 0 ]; then
		_hit=MEMORY
	fi
	return 0
}
_budget_verdict() {
	case "$RUN_RUNG" in
	scope | scope-tasks) ;;
	*) exit "$_worker_status" ;;
	esac
	_budget_ceiling_hit || _budget_unread "$_unread"
	case "$_hit" in
	TASK) echo "x  dispatch: the worker hit its TASK ceiling ($BUDGET_TASKS) — its process tree could fork no further. Exit 71 (EX_OSERR)." >&2 ;;
	MEMORY) echo "x  dispatch: the worker hit its MEMORY ceiling (${BUDGET_MEMORY} MiB) — a process in its tree was OOM-killed inside its cgroup. Exit 71 (EX_OSERR)." >&2 ;;
	*) exit "$_worker_status" ;;
	esac
	exit 71
}

_spawn_run
if [ "$_timed_out" = 1 ]; then
	# Whichever fired first (ADR-0006 clause 6): the watchdog read the scope's
	# counters before it signalled, and a ceiling hit already on them happened
	# before the timeout did. A verdict that cannot be read here is not an
	# outcome of its own — the timeout is what was observed.
	case "$RUN_RUNG" in
	scope | scope-tasks)
		if _budget_ceiling_hit && [ -n "$_hit" ]; then
			echo "x  dispatch: the worker hit its $_hit ceiling before it timed out — the ceiling fired first. Exit 71 (EX_OSERR)." >&2
			exit 71
		fi
		;;
	esac
	exit 124
fi
_budget_verdict
