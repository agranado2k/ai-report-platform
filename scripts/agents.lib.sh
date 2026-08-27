#!/bin/sh
# agents.lib.sh — THE capability-tier resolver. One implementation, many callers.
#
# Answers exactly one question: "which execution model does this tier run on?"
#
#   sh scripts/agents.lib.sh implementer          -> prints the mapped model id,
#                                                    or nothing if it is unmapped
#   sh scripts/agents.lib.sh implementer content  -> the same, for work whose
#                                                    MEDIUM has its own mapping
#   . scripts/agents.lib.sh; resolve_tier …       -> either, as a shell function
#
# Sourcing is side-effect-free in every shell, including zsh (see the bottom of
# the file). A sourcing caller must say where the config lives, though, because
# a sourced file cannot portably learn its own path:
#
#   AGENTS_CONFIG=scripts/agents.config.sh; . scripts/agents.lib.sh  # explicit
#   _agents_here=scripts; . scripts/agents.lib.sh                    # or by dir
#
# Two statements on purpose: a prefix assignment on `.` persists only in plain
# sh — bash and zsh drop it before the sourced code runs, and the recipe would
# quietly resolve UNMAPPED.
#
# With neither set, orders 2 and 3 below are both skipped and every tier reports
# UNMAPPED — deliberately, since the only other candidate is whatever repository
# the process happens to be standing in (see agents_load_config).
#
# WHY THE KIT NEVER NAMES A MODEL
# ---------------------------------------------------------------------------
# Model identifiers rot faster than any other constant a framework could carry:
# they are renamed, deprecated and repriced on someone else's schedule, and they
# differ per provider and per agent harness. A kit that shipped one would be
# shipping a lie with a timer on it, and the lie would be re-read by every
# session that loads the manual.
#
# So the kit ships the VOCABULARY and the MECHANISM, and your project supplies
# the mapping:
#
#   VOCABULARY   four tier names — planner, implementer, mechanical, reviewer —
#                defined in the manual layer (the root manual and the local
#                workflow article), because deciding which tier a piece of work
#                deserves is a human process rule, not a script's business.
#                Plus an OPEN second axis, the task DOMAIN, below.
#   MECHANISM    this file. Shared layer (see VERSION): copied verbatim, so a
#                fix to the resolution order reaches every project.
#   MAPPING      scripts/agents.config.sh. Yours, local, never overwritten by a
#                kit update — the same split, and the same reasoning, as
#                guards.lib.sh / guards.config.sh.
#
# THE UNCONFIGURED DEFAULT IS LOAD-BEARING
# ---------------------------------------------------------------------------
# An unmapped tier prints NOTHING and exits 0, after warning once. "Nothing" is
# a real answer: the caller passes no model parameter and the spawned agent
# inherits the session's own model, which is precisely the behaviour every
# project has today. A resolver that hard-failed on an unmapped tier would make
# a freshly bootstrapped project unable to spawn anything, and would be deleted
# on day one — and a deleted resolver resolves nothing.
#
# An UNKNOWN tier is the opposite case and does fail (exit 2). A typo is not a
# policy choice: silently running `implementor` on whatever the session happens
# to be is the exact cost blindness this seam exists to remove.
#
# THE SECOND AXIS: TASK DOMAIN
# ---------------------------------------------------------------------------
# A tier says how much JUDGEMENT the work is worth. It says nothing about what
# the work is made of — and "write the launch announcement" and "write the retry
# logic" are the same cost/benefit shape while being different enough that a
# project may well want different models on them. One axis cannot express that,
# so there is an optional second one: the DOMAIN, the medium of the work.
#
#   AGENT_TIER_IMPLEMENTER_CONTENT   set  -> `resolve_tier implementer content`
#   AGENT_TIER_IMPLEMENTER           set  -> everything else at that tier
#
# The two vocabularies are deliberately OPPOSITE, and the difference is the
# whole design:
#
#   TIER   CLOSED. Four names, fixed by the manual layer, shared word between a
#          ticket, a skill and this file. An unknown one is a caller bug.
#   DOMAIN OPEN. Whatever tokens a project finds worth distinguishing — `code`,
#          `content`, `sql`, `html-report`. It is pure local policy, invented in
#          the config and the tickets, so this file cannot hold a list of them
#          and does not try. An UNMAPPED domain is therefore a working state,
#          not a typo: it falls back to the plain tier mapping in silence,
#          because "no special opinion about this medium" is the ordinary case
#          and a warning for it would train people to ignore the one that
#          matters.
#
# What the domain does NOT get is a free pass on its SHAPE. It is interpolated
# into a variable name and expanded through `eval`, and unlike the tier it was
# never whitelisted against a fixed list — so the shape check IS its whitelist:
# `[a-z][a-z0-9-]*` and nothing else, checked before the token is allowed
# anywhere near the eval. Hyphens are legal in a token and illegal in a shell
# variable name, so they fold to underscores: `html-report` reads
# AGENT_TIER_<TIER>_HTML_REPORT.
#
# Omit the argument entirely and this file behaves exactly as it did before the
# axis existed — which is the point, because every caller that predates it (the
# skills, the adapter note, a consumer's own script) keeps working untouched.
#
# Config resolution order, first hit wins:
#   1. $AGENTS_CONFIG        — explicit. If it is set and does not exist, that
#                              is an ERROR (exit 2): the caller named a file, so
#                              falling back silently would run a mapping nobody
#                              asked for. Tests rely on this.
#   2. <root of the repo THIS FILE lives in>/scripts/agents.config.sh
#   3. <this file's directory>/agents.config.sh
#
# Orders 2 and 3 are anchored on this file, never on the caller's working
# directory: a config is sourced, and sourcing one out of whatever repo an
# operator happens to be standing in would execute a stranger's code.
#
# Variable resolution order, first NON-EMPTY hit wins:
#   1. AGENT_TIER_<TIER>_<DOMAIN>   only when a domain was given
#   2. AGENT_TIER_<TIER>
#
# Exit codes:  0 resolved (a value, or deliberately nothing) · 2 usage error,
#              unknown tier, malformed domain, or an explicit config that does
#              not exist.

# The closed vocabulary. Deliberately NOT configurable: the tier names are the
# shared word between a ticket, a skill and this resolver, and a project that
# renamed them would break every skill that says "implementer" while the docs
# gate stayed green. Add a MAPPING in the config; do not add a tier here.
AGENT_TIERS='planner implementer mechanical reviewer'

# The domain has no list here on purpose — see THE SECOND AXIS above. What it
# has instead is a SHAPE, and this is it, written once so the usage text and
# the error text below cannot drift apart. It does NOT also drive the case
# pattern that enforces the shape — that pattern spells out the alphabet
# instead of quoting this string, for the locale reason documented where it
# lives. So this string and that pattern CAN drift; keep them in sync by hand.
AGENT_DOMAIN_SHAPE='[a-z][a-z0-9-]*'

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
# It defaults to EMPTY, and that is deliberate rather than tidy: it used to
# default to `.`, which quietly made resolution order 3 mean "a config file in
# whatever directory the process is standing in" — a different and much wider
# rule than the one documented above, and the same trust problem order 2 had.
# Empty means orders 2 and 3 are both skipped, so a sourcing caller that has
# not said where it is gets $AGENTS_CONFIG or nothing.
#
# The other two globals are per-process memos: config loading and the unmapped
# warning both have to happen at most once no matter how many tiers a single
# process resolves.
_agents_here=${_agents_here:-}
_agents_config_loaded=0
_agents_config_tried=0
_agents_warned=0

agents_usage() {
	echo "usage: agents.lib.sh <tier> [domain]" >&2
	echo "  tier is one of: $AGENT_TIERS" >&2
	echo "  domain is an optional $AGENT_DOMAIN_SHAPE token naming the medium of the work." >&2
}

# agents_load_config — source the mapping, once per process.
#
# Returns 0 when a config was loaded, 1 when none exists anywhere (not an
# error — see the unconfigured default above), 2 when an explicitly named one
# is missing.
#
# The MISS is memoized too, not only the hit. An unconfigured project is the
# common case, and every resolve_tier call in it would otherwise re-run
# `git rev-parse` and two stat calls to reach the same "no" — a caller that
# resolves four tiers pays for that four times, for nothing.
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
	# are skipped and a caller gets $AGENTS_CONFIG or nothing. That is why it no
	# longer defaults to `.`: `.` silently meant "the process's current
	# directory", which is the same wider rule in its order-3 clothes.
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

# resolve_tier <tier> [domain] — print the mapped model id on stdout,
# diagnostics on stderr. Stdout carries the ANSWER and nothing else, so a caller
# can use it directly: `model=$(sh scripts/agents.lib.sh implementer content)`.
resolve_tier() {
	if [ $# -lt 1 ] || [ $# -gt 2 ] || [ -z "${1:-}" ]; then
		agents_usage
		return 2
	fi

	# The accept-check is a LITERAL `case`, not a loop over $AGENT_TIERS, for two
	# independent reasons.
	#
	# PORTABILITY, the one that was actually broken: `for t in $AGENT_TIERS`
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
	# rules. AGENT_TIERS survives as the single source for the MESSAGES; this
	# literal is the authority.
	_rt_tier=$1
	_rt_domain=${2:-}
	case "$_rt_tier" in
	planner | implementer | mechanical | reviewer) _rt_known=1 ;;
	*) _rt_known=0 ;;
	esac
	if [ "$_rt_known" = 0 ]; then
		echo "x agents: unknown capability tier '$_rt_tier'." >&2
		echo "  The vocabulary is closed: $AGENT_TIERS." >&2
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

	printf '%s\n' "$_rt_value"
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
