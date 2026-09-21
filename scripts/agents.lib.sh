#!/bin/sh
# agents.lib.sh — THE capability-tier resolver. One implementation, many callers.
#
# Answers one question: "which execution model does this tier run on?"
#
#   sh scripts/agents.lib.sh [--model|--harness] <tier> [domain]
#       --model (the default) -> the mapped model id, or nothing when unmapped
#       --harness             -> the agent harness that runs it, or nothing,
#                                which means the caller's own
#   . scripts/agents.lib.sh; resolve_tier …    -> the same, as a shell function;
#      set AGENTS_CONFIG=<file> or _agents_here=<dir> BEFORE sourcing, on its
#      own line (bash and zsh drop a prefix assignment on `.`)
#
# tier    CLOSED: planner | implementer | mechanical | reviewer. Unknown: exit 2.
# domain  OPEN local policy, shape `[a-z][a-z0-9-]*`; hyphens fold to `_` in
#         the variable name. Unmapped: falls back to the tier, silently.
#
# Config resolution, first hit wins: 1. $AGENTS_CONFIG (set but missing is
# exit 2) · 2. <this file's repo root>/scripts/agents.config.sh · 3. <this
# file's dir>/agents.config.sh. Orders 2–3 anchor on THIS file, never on the
# caller's cwd; a sourcing caller that set neither variable gets nothing.
# Variable resolution, first NON-EMPTY wins: AGENT_TIER_<TIER>_<DOMAIN> (only
# with a domain) · AGENT_TIER_<TIER>.
#
# Exit: 0 resolved (a value, or deliberately nothing — an unmapped tier warns
# once per process, AGENTS_TIER_QUIET=1 silences it, the caller spawns with no
# model) · 2 usage error, unknown tier, bad domain, or a missing named config.
#
# Shared layer (see VERSION): this file is copied verbatim; the mapping in
# scripts/agents.config.sh is yours, never overwritten by an update; the kit
# names no model (the root manual's "Capability tiers" says why). History:
# the agentic-sdlc repository's diary, 2026-09-03.

# The domain's SHAPE, written once so the usage text and the error text cannot
# drift apart. It does NOT drive the case pattern that enforces the shape —
# that pattern spells out the alphabet, for the locale reason documented where
# it lives — so this string and that pattern are kept in sync by hand. The
# four tier names are likewise spelled at their three literal sites (the
# check, the usage text, the unknown-tier error) and move together: a sourced
# config could reassign a global, so there is no list variable to reassign.
AGENT_DOMAIN_SHAPE='[a-z][a-z0-9-]*'

# The AGENT HARNESS token's shape. Same alphabet as a task domain, and for the
# same reason: it is interpolated into the variable name carrying that agent
# harness's invocation template, so the shape is the whitelist standing in
# front of an eval. It is spelled out at its `case` site below rather than
# driven from this string, exactly as the domain's is.
#
# The VOCABULARY, unlike the tier's, is OPEN and declared by the project in
# AGENT_HARNESSES — because naming an agent harness is naming a vendor's tool,
# and the kit names none. An undeclared prefix is not an error: it means the
# value was never a prefixed one at all (a local runtime's `<name>:<tag>` is a
# single model id), so the whole string stays the model. That fallback is why
# the declaration has to exist.
AGENT_HARNESS_SHAPE='[a-z][a-z0-9-]*'

# MODULE GLOBALS, and why they diverge from guards.lib.sh's convention.
#
# guards.lib.sh takes its "directory of the calling script" as a PARAMETER,
# because it is only ever sourced by a script that knows where it lives. This
# file is also EXECUTED directly (`sh scripts/agents.lib.sh implementer` — the
# seam an agent following a SKILL.md actually uses), and in that case the only
# thing that knows the directory is `$0`, which is read at the bottom of the
# file, long after resolve_tier's signature is fixed at one argument: the tier.
# Threading the directory through as a second parameter would put a value the
# CALLER cannot supply into the caller's hands. So it is a global, set once by
# the direct-execution branch, and settable by a sourcing caller — which is the
# only way such a caller gets orders 2 and 3 at all.
#
# It defaults to EMPTY on purpose: empty means orders 2 and 3 are both
# skipped, so a sourcing caller that has not said where it is gets
# $AGENTS_CONFIG or nothing — never a config from whatever directory the
# process happens to be standing in.
#
# The other two globals are per-process memos: config loading and the unmapped
# warning both have to happen at most once no matter how many tiers a single
# process resolves.
_agents_here=${_agents_here:-}
_agents_config_loaded=0
_agents_config_tried=0
_agents_warned=0
_agents_undeclared_warned=0
_agents_nomodel_warned=0
_agents_dropped_warned=0

agents_usage() {
	echo "usage: agents.lib.sh [--model|--harness] <tier> [domain]" >&2
	echo "  tier is one of: planner implementer mechanical reviewer" >&2
	echo "  domain is an optional $AGENT_DOMAIN_SHAPE token naming the medium of the work." >&2
	echo "  --model    print the model id. The default, and what every caller got" >&2
	echo "             before the agent-harness axis existed." >&2
	echo "  --harness  print the agent harness token instead, or nothing when the" >&2
	echo "             tier is mapped to a bare model id — which means the caller's own." >&2
}

# agents_load_config — source the mapping, once per process.
#
# Returns 0 when a config was loaded, 1 when none exists anywhere (not an
# error — see the unconfigured default above), 2 when an explicitly named one
# is missing.
#
# The MISS is memoized too, not only the hit: an unconfigured project is the
# common case, and one process resolves several tiers.
#
# Only the genuine "no config anywhere" miss is remembered. An explicitly named
# AGENTS_CONFIG that does not exist keeps failing on every call, loudly: that is
# a caller error, and a caller error that reports itself once and then goes
# quiet is worse than one that keeps saying so.
agents_load_config() {
	[ "$_agents_config_loaded" = 1 ] && return 0
	[ "$_agents_config_tried" = 1 ] && return 1

	if [ -n "${AGENTS_CONFIG:-}" ]; then
		if [ ! -f "$AGENTS_CONFIG" ]; then
			echo "x agents: AGENTS_CONFIG=$AGENTS_CONFIG does not exist." >&2
			return 2
		fi
		. "$AGENTS_CONFIG"
		_agents_config_loaded=1
		return 0
	fi

	# Orders 2 and 3 are both anchored on $_agents_here — where the LIBRARY
	# lives — and never on the directory the caller happens to be standing in.
	#
	# A config file is SOURCED, which is to say EXECUTED, so this is a trust
	# question and not a convenience one. Order 2 used to ask `git rev-parse
	# --show-toplevel` about the process's CURRENT DIRECTORY: resolving a tier
	# with the cwd inside a cloned third-party repo therefore ran that clone's
	# scripts/agents.config.sh. The root manual's trust boundary names cloned
	# third-party repos as untrusted content, and untrusted content is data,
	# never code to run. Asking git about $_agents_here takes the cwd out of
	# the trust path altogether rather than validating it, and it keeps working
	# when the cwd is in no repository at all.
	#
	# When $_agents_here is EMPTY there is nothing to anchor on, so both orders
	# are skipped and a caller gets $AGENTS_CONFIG or nothing — never the
	# process's current directory in order-3 clothes.
	if [ -n "$_agents_here" ]; then
		_al_root=$(git -C "$_agents_here" rev-parse --show-toplevel 2>/dev/null) || _al_root=
		if [ -n "$_al_root" ] && [ -f "$_al_root/scripts/agents.config.sh" ]; then
			. "$_al_root/scripts/agents.config.sh"
			_agents_config_loaded=1
			return 0
		fi

		if [ -f "$_agents_here/agents.config.sh" ]; then
			. "$_agents_here/agents.config.sh"
			_agents_config_loaded=1
			return 0
		fi
	fi

	_agents_config_tried=1
	return 1
}

# agents_split_harness <value> — take a mapped tier value apart into the AGENT
# HARNESS that runs it and the model it runs. Sets _ah_harness and _ah_model.
#
# A value is either `<agent harness>:<model id>` or a bare `<model id>`. The
# bare form is the ONLY form that existed before this axis, and it still means
# what it meant: this tier's model, on whatever agent harness the caller is
# already running. So a bare value leaves _ah_harness empty, and empty keeps
# meaning "no parameter, inherit" — one more layer of the same
# unset-is-a-working-state contract the rest of this file is built on.
#
# WHY THE PREFIX IS CHECKED AGAINST A DECLARATION rather than just split on the
# first colon. A colon is legal INSIDE a model identifier — a local runtime's
# `<name>:<tag>` is one id, not an agent harness and a model — so splitting
# unconditionally would invent an agent harness and spawn on a fragment. The
# project's AGENT_HARNESSES declaration is what makes the split decidable: a
# prefix that was declared is an agent harness, and one that was not is part of
# the id.
#
# A project that declared NOTHING is the pre-axis world exactly: every value is
# bare, nothing is ever split, and this function costs one `case`.
agents_split_harness() {
	_ah_harness=
	_ah_model=$1

	# No colon, nothing to decide. The common case, and the fast one.
	case $1 in
	*:*) ;;
	*) return 0 ;;
	esac

	_ah_prefix=${1%%:*}

	# The prefix's SHAPE. The alphabet is spelled out rather than written
	# `[!a-z]` for the same locale reason the domain check spells its own: under
	# en_US.UTF-8 a bracket RANGE collates case-insensitively, so `[!a-z]*`
	# would accept an upper-case prefix, and a check whose meaning moves with
	# $LANG is not a check.
	#
	# A failure here does NOT return early, and that is the whole point. It used
	# to: `AGENT_TIER_REVIEWER='Alpha:some-model'` with `alpha` declared then
	# resolved to no agent harness and a model id of `Alpha:some-model`, in
	# total silence — a capitalisation typo in the policy file spawning on the
	# caller's own agent harness with nothing said anywhere. That is exactly the
	# silent wrong-harness spawn ADR-0005 clause 5 forbids. A malformed prefix
	# falls through to the same warning an undeclared one gets.
	_ah_shape=ok
	case $_ah_prefix in
	'' | [!abcdefghijklmnopqrstuvwxyz]* | *[!abcdefghijklmnopqrstuvwxyz0123456789-]*) _ah_shape=bad ;;
	esac

	# Declared? The membership test is a `case` against a padded string, NOT
	# `for h in $AGENT_HARNESSES`. An unquoted expansion is word-split by sh,
	# bash and ksh and NOT by zsh (SH_WORD_SPLIT is off by default) — the exact
	# portability bug the tier check one function down documents having been
	# bitten by. A `case` compares patterns and behaves identically in all four
	# shells. The declaration is normalised first so a project may write it
	# across lines and still mean the same set.
	_ah_list=$(printf '%s' "${AGENT_HARNESSES:-}" | tr '\t\n' '  ')
	if [ "$_ah_shape" = ok ]; then
		case " $_ah_list " in
		*" $_ah_prefix "*)
			_ah_harness=$_ah_prefix
			_ah_model=${1#*:}
			return 0
			;;
		esac
	fi

	# Undeclared prefix. The whole string stays the model, which is right for a
	# `<name>:<tag>` id and is also what a TYPO'd agent-harness name resolves
	# to — and a typo then fails at spawn time, loudly, because nothing accepts
	# a model called `alpah:some-id`. That is late, so say something now; but
	# only when the project declared any agent harness at all, since one that
	# declared none has simply written a model id with a colon in it and
	# deserves silence.
	if [ -n "$_ah_list" ] && [ "$_agents_undeclared_warned" = 0 ] && [ "${AGENTS_TIER_QUIET:-}" != "1" ]; then
		_agents_undeclared_warned=1
		if [ "$_ah_shape" = bad ]; then
			echo "!  agents: '$_ah_prefix' is not a well-formed agent harness token, so '$1'" >&2
			echo "   resolves as a MODEL ID. A token is a $AGENT_HARNESS_SHAPE — lower case." >&2
		else
			echo "!  agents: '$_ah_prefix' is not a declared agent harness, so '$1' resolves as a MODEL ID." >&2
		fi
		echo "   Declared: $_ah_list" >&2
		echo "   If that prefix was meant as an agent harness, fix it and add it to AGENT_HARNESSES." >&2
	fi
	return 0
}

# resolve_tier <tier> [domain] — print the mapped model id on stdout,
# diagnostics on stderr. Stdout carries the ANSWER and nothing else, so a caller
# can use it directly: `model=$(sh scripts/agents.lib.sh implementer content)`.
resolve_tier() {
	# The optional leading MODE flag, shifted off before the signature below is
	# checked — so that signature stays "one tier, one optional domain" and the
	# arity errors keep counting the arguments a caller actually thinks about.
	#
	# `default` and `model` both print the model, and they are still two modes:
	# `default` is a caller written before this axis existed, which does not know
	# an agent harness may be configured, so it is told when it drops one.
	# `--model` is a caller that asked for the model specifically, so it is not.
	#
	# The `--*` arm refuses an unknown flag rather than letting it fall through to
	# the tier check, where `--harnes` would be reported as an unknown capability
	# tier — an error message pointing at the wrong thing.
	_rt_mode=default
	case "${1:-}" in
	--model)
		_rt_mode=model
		shift
		;;
	--harness)
		_rt_mode=harness
		shift
		;;
	--*)
		echo "x agents: unknown option '$1'." >&2
		agents_usage
		return 2
		;;
	esac

	if [ $# -lt 1 ] || [ $# -gt 2 ] || [ -z "${1:-}" ]; then
		agents_usage
		return 2
	fi

	# The accept-check is a LITERAL `case`, not a loop over a variable holding
	# the list, for two independent reasons.
	#
	# PORTABILITY, the one that was actually broken: `for t in $list`
	# relies on the shell word-splitting an unquoted expansion, and zsh does not
	# (SH_WORD_SPLIT is off by default). Under `zsh scripts/agents.lib.sh
	# implementer` the loop saw ONE word — the whole string — so every real tier
	# name was rejected as unknown. A `case` compares patterns, never words, and
	# behaves identically in sh, bash, ksh and zsh.
	#
	# TRUST, a smaller share of it: a sourced config is trusted code — it
	# could redefine resolve_tier wholesale, so this literal is NOT a security
	# boundary against a hostile config. What it does buy: the accepted set
	# can no longer drift via a reassigned global or a shell's splitting
	# rules. The MESSAGES spell the same four names as literals too (no
	# global survives for a config to reassign), so check and diagnostics
	# cannot disagree — the four names are spelled at their three literal sites (see AGENT_DOMAIN_SHAPE's comment).
	_rt_tier=$1
	_rt_domain=${2:-}
	case "$_rt_tier" in
	planner | implementer | mechanical | reviewer) _rt_known=1 ;;
	*) _rt_known=0 ;;
	esac
	if [ "$_rt_known" = 0 ]; then
		echo "x agents: unknown capability tier '$_rt_tier'." >&2
		echo "  The vocabulary is closed: planner implementer mechanical reviewer." >&2
		echo "  It is defined in the manual layer; a ticket that needs another word needs a manual change first." >&2
		return 2
	fi

	# The domain's shape check, run only when one was actually passed. It is the
	# tier whitelist's counterpart: the tier is safe to interpolate because it is
	# one of four literals, and the domain is safe to interpolate because
	# NOTHING outside [a-z0-9-] gets past this case. Order matters — the tier is
	# checked first, so `implementor content` reports the typo that is actually
	# wrong rather than the argument that is fine.
	#
	# The alphabet is spelled out rather than written `[!a-z]`, and that is not
	# fussiness. A bracket RANGE in a shell pattern is resolved by the current
	# locale's collation, and in the en_US.UTF-8 that a developer's terminal
	# defaults to, `a-z` interleaves the cases — so `[!a-z]*` accepts `CONTENT`,
	# reads a variable nobody wrote, and silently falls back. The check that is
	# the whitelist for an `eval` cannot be one whose meaning moves with $LANG.
	if [ $# -eq 2 ]; then
		case $_rt_domain in
		'' | [!abcdefghijklmnopqrstuvwxyz]* | *[!abcdefghijklmnopqrstuvwxyz0123456789-]*)
			echo "x agents: malformed task domain '$_rt_domain'." >&2
			echo "  A domain is a $AGENT_DOMAIN_SHAPE token — e.g. code, content, html-report." >&2
			echo "  The vocabulary is open (it is your project's policy); the token's shape is not," >&2
			echo "  because it is interpolated into the variable name this resolver reads." >&2
			return 2
			;;
		esac
	fi

	# `|| _rt_load=$?` rather than a bare call, and it is load-bearing. Most
	# consumer scripts and hooks run `set -e`, under which a BARE call to a
	# function that returns 1 terminates the caller before its status can be
	# read — and 1 is agents_load_config's NORMAL "no config anywhere" answer,
	# the state every freshly bootstrapped project is in. A bare call therefore
	# killed the commonest caller in the commonest state, and killed it
	# silently: no value, no warning, no error. A command in an AND-OR list is
	# exempt from `set -e`, so here the status survives to be read.
	_rt_load=0
	agents_load_config || _rt_load=$?
	[ "$_rt_load" = 2 ] && return 2

	# Tier name -> variable name. The tier is already whitelisted above, so the
	# eval can only ever expand one of four literal variable names.
	_rt_upper=$(printf '%s' "$_rt_tier" | tr 'a-z' 'A-Z')

	# The domain-qualified variable first, when there is one. `tr` folds the
	# token's legal hyphens into the underscores a variable name needs, and the
	# shape check above guarantees there is nothing else left to fold.
	_rt_value=
	if [ -n "$_rt_domain" ]; then
		_rt_dupper=$(printf '%s' "$_rt_domain" | tr 'a-z-' 'A-Z_')
		eval "_rt_value=\${AGENT_TIER_${_rt_upper}_${_rt_dupper}:-}"
	fi

	# Unset or empty falls through to the tier — the same test for both, because
	# a project that mapped a domain to '' has said "no opinion here" just as
	# clearly as one that never named it.
	if [ -z "$_rt_value" ]; then
		eval "_rt_value=\${AGENT_TIER_${_rt_upper}:-}"
	fi

	if [ -z "$_rt_value" ]; then
		if [ "$_agents_warned" = 0 ] && [ "${AGENTS_TIER_QUIET:-}" != "1" ]; then
			_agents_warned=1
			echo "!  agents: capability tier '$_rt_tier' is UNMAPPED — no model configured." >&2
			echo "   Set AGENT_TIER_${_rt_upper} in scripts/agents.config.sh to map it." >&2
			echo "   Until then every tier runs on the session's own model, and the planner's" >&2
			echo "   cost/benefit decision has no effect on what anything actually costs." >&2
		fi
		return 0
	fi

	agents_split_harness "$_rt_value"

	if [ "$_rt_mode" = harness ]; then
		# Empty is a real answer and prints as one: a tier mapped to a bare model
		# id runs on the caller's own agent harness, which is what every tier did
		# before this axis existed. The caller branches on emptiness exactly as it
		# already branches on an unmapped model.
		[ -n "$_ah_harness" ] && printf '%s\n' "$_ah_harness"
		return 0
	fi

	# An agent harness named with NO model. Refusing here would make an error of
	# the one case the rest of this file treats as normal, so it resolves: that
	# agent harness, on its own default model. Said once, because the tier's
	# cost/benefit decision then has no effect on what the work actually costs —
	# which is the same blindness an unmapped tier has, at somebody else's prices.
	if [ -n "$_ah_harness" ] && [ -z "$_ah_model" ] &&
		[ "$_agents_nomodel_warned" = 0 ] && [ "${AGENTS_TIER_QUIET:-}" != "1" ]; then
		_agents_nomodel_warned=1
		echo "!  agents: agent harness '$_ah_harness' is named with no model, so this tier runs" >&2
		echo "   on that agent harness's OWN DEFAULT. The tier is still a decision about" >&2
		echo "   the work; it is no longer a decision about the cost." >&2
	fi

	# A caller written before this axis is about to spawn this model on its OWN
	# agent harness while the config says otherwise. It still gets the model —
	# breaking the old contract would break every consumer on the shared layer —
	# but the operator hears about it, once, on stderr where the value is not.
	if [ "$_rt_mode" = default ] && [ -n "$_ah_harness" ] &&
		[ "$_agents_dropped_warned" = 0 ] && [ "${AGENTS_TIER_QUIET:-}" != "1" ]; then
		_agents_dropped_warned=1
		echo "!  agents: this tier names agent harness '$_ah_harness', and the caller asked only" >&2
		echo "   for a model, so the agent harness is being DROPPED — the spawn will run wherever" >&2
		echo "   the caller already is. Ask for it with --harness." >&2
	fi

	[ -n "$_ah_model" ] && printf '%s\n' "$_ah_model"
	return 0
}

# Direct execution: the seam an agent following a SKILL.md actually uses, since
# an agent runs commands rather than sourcing shell libraries. Sourcing callers
# fall through with only the functions defined.
#
# THE $0 TEST ALONE IS NOT ENOUGH, and the shell it fails in is the shell most
# operators type into. zsh sets $0 to the SOURCED FILE'S path (FUNCTION_ARGZERO,
# on by default), so `source scripts/agents.lib.sh` matched the pattern below:
# the library ran resolve_tier against the SHELL'S own arguments and then
# `exit`ed, killing the interactive session that sourced it. sh, bash and ksh
# all leave $0 as the caller's own, so there the pattern already tells the truth.
#
# ZSH_EVAL_CONTEXT is zsh's own answer to the question. It is a colon-joined
# stack of what the shell is currently doing, and every file being sourced
# pushes a `file` component onto it — `cmdarg:file`, `toplevel:file`,
# `toplevel:shfunc:file`. zsh EXECUTING this script is plain `toplevel`, with no
# `file`. Nothing else sets the variable, so under sh/bash/ksh it is empty and
# this test costs one unmatched `case`.
_agents_sourced=0
case "${ZSH_EVAL_CONTEXT:-}" in
*:file | *:file:*) _agents_sourced=1 ;;
esac

if [ "$_agents_sourced" = 0 ]; then
	case "$0" in
	*/agents.lib.sh | agents.lib.sh)
		_agents_here=$(dirname "$0")
		resolve_tier "$@"
		exit $?
		;;
	esac
fi
