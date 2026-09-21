#!/bin/sh
# agents.config.sh — the one place the kit learns which MODEL your provider
# gives each capability tier.
#
# This file is DATA, not mechanism. `scripts/agents.lib.sh` holds the resolver
# and the closed vocabulary; every provider-specific and price-specific fact
# lives here, in one reviewable file, so re-pointing a tier at a cheaper or
# newer model is a diff a human reads rather than an edit inside a script.
#
# It is read by:
#   scripts/agents.lib.sh   (`resolve_tier <tier>`), which /to-tickets and
#                            /implement call when deciding how to spawn.
#
# THIS FILE IS YOURS. It is not part of the shared layer (see VERSION), it is
# not overwritten by a kit update, and editing it is the intended workflow —
# the same arrangement as scripts/guards.config.sh, for the same reason: the
# kit owns mechanism, your repo owns policy.
#
# ---------------------------------------------------------------------------
# WHY THE KIT SHIPS THIS EMPTY, AND WILL KEEP SHIPPING IT EMPTY
# ---------------------------------------------------------------------------
# Model identifiers are the fastest-rotting constant a framework could carry.
# They are renamed, deprecated and repriced on a vendor's schedule, they differ
# per provider, and the cheap tier of one release is the expensive tier of the
# next. A kit that shipped one would be shipping a standing instruction with a
# timer on it — and shared invariant §8 is precisely about stale standing
# instructions being worse than absent ones.
#
# So: the kit names the FOUR TIERS and never a model. You name the models.
#
# UNSET IS A WORKING STATE. An unmapped tier resolves to nothing, the caller
# passes no model parameter, and the spawned agent inherits the session's own
# model — exactly what happens today without any of this. The resolver warns
# once per process so the gap is visible, and passes.
#
# ---------------------------------------------------------------------------
# THE VOCABULARY
# ---------------------------------------------------------------------------
# Defined in the manual layer (the root manual's "Capability tiers" section and
# the local workflow article), because choosing a tier is a human process rule.
# Repeated here only as the shape of the decision each variable encodes:
#
#   planner      Judgement over breadth. Decomposition, design, architecture,
#                triage of an ambiguous bug. Reads a lot, writes little, and a
#                wrong answer costs a whole wave of downstream work.
#   implementer  Judgement over depth. Building one ticket test-first through
#                seams it has to find. The default for real work.
#   mechanical   No judgement required, and a checkable definition of done. A
#                rename across call sites, a codemod, a dependency bump, the
#                contract half of an expand-migrate-contract. Cheap is correct
#                here: the test suite is the oracle, not the model.
#   reviewer     Judgement over a finished diff, in fresh context. Adversarial
#                reading rather than production. Undersizing this one is how a
#                review becomes a rubber stamp.
#
# Set each to whatever identifier YOUR agent harness expects in its spawn call.
# The adapter note for your harness says where that value goes — see
# `adapters/claude-code/README.md` for one worked example.
#
# Examples of the SHAPE (not real identifiers — deliberately):
#   AGENT_TIER_PLANNER='<your provider's strongest reasoning model>'
#   AGENT_TIER_MECHANICAL='<your provider's cheapest capable model>'
#
# ---------------------------------------------------------------------------
# OPTIONAL SECOND AXIS: TASK DOMAIN
# ---------------------------------------------------------------------------
# The four variables above answer "how much judgement is this work worth?".
# They do not answer "what is this work made OF?" — and "write the launch
# announcement" and "write the retry logic" are the same tier while being the
# kind of different that may deserve different models.
#
# So each tier takes an optional, more specific variable:
#
#   AGENT_TIER_<TIER>_<DOMAIN>='<the model for that medium at that tier>'
#
# and `sh scripts/agents.lib.sh <tier> <domain>` prefers it, falling back to the
# plain `AGENT_TIER_<TIER>` when it is unset or empty. A ticket carries the
# domain on an optional `Domain:` line, stamped by /to-tickets when the medium
# would change which model you would pick.
#
# THE DOMAIN VOCABULARY IS YOURS. Unlike the four tiers — which the kit fixes,
# because the skills say those words out loud — the domains are whatever
# distinctions your repo actually has. `code` and `content` is the common split;
# a repo whose hard part is queries might add `sql`. The token is
# `[a-z][a-z0-9-]*`, and a hyphen in it becomes an underscore in the variable
# name (`html-report` -> `..._HTML_REPORT`).
#
# A domain you never map is NOT an error and NOT a warning: it falls back to the
# tier, which is the right answer for every medium you have no opinion about.
# Map the two or three that pay for themselves and leave the rest alone.
#
# Examples of the SHAPE (still not real identifiers):
#   AGENT_TIER_IMPLEMENTER_CODE='<your provider's best coding model>'
#   AGENT_TIER_IMPLEMENTER_CONTENT='<your provider's best writing model>'
#   AGENT_TIER_REVIEWER_CONTENT='<the model you trust to review prose>'
#
# The kit ships none of these set, for the same reason it ships the four tiers
# empty: a mapping is a model identifier, and the kit never names one.
#
# ---------------------------------------------------------------------------
# THIRD AXIS: THE AGENT HARNESS
# ---------------------------------------------------------------------------
# The two axes above answer "how much judgement is this worth?" and "what is
# this work made OF?". Both assumed an answer to a third question without
# asking it: WHICH AGENT HARNESS runs the model — the CLI that holds the
# session, loads AGENTS.md and owns the tool calls. While every tier ran in the
# caller's own session that assumption was invisible and correct.
#
# It stops being either the moment you want a reviewer from a different VENDOR
# than the one that wrote the code — and you should want that, because a
# reviewer sharing the author's model family shares the author's blind spots.
# The kit has said so for a while; templates/workflows/ai-review.example.yml
# runs two vendors against one prompt and says in its header that the
# cross-provider leg "is unreachable from inside the authoring harness". This
# axis is what makes it reachable. ADR-0005 records why.
#
# DECLARE YOUR AGENT HARNESSES, then prefix a tier's value with one:
#
#   AGENT_HARNESSES='<token> <token> ...'
#   AGENT_TIER_REVIEWER='<token>:<model id>'
#
# A value with NO prefix keeps meaning exactly what it always meant: this
# tier's model, on whatever agent harness the caller is already running. That
# is still right for most tiers, and it is the only answer a project that
# declares none can give — which is why nothing below is prefixed, and why an
# unconfigured project is untouched by this whole section.
#
# WHY THE PREFIX IS CHECKED AGAINST THE DECLARATION rather than just split on
# the first colon: a colon is legal INSIDE a model identifier (the
# `<name>:<tag>` form some local runtimes use is one id, not two things). The
# resolver splits only on a prefix you declared, so an id that merely contains
# a colon survives intact. Declaring nothing splits nothing.
#
# A PREFIX WITH NO MODEL — `AGENT_TIER_REVIEWER='<token>:'` — is legal and
# means "that agent harness, on its own default model". The resolver warns once,
# because the tier is then still a decision about the work and no longer a
# decision about the cost.
#
# Read the two halves back with:
#   sh scripts/agents.lib.sh --harness reviewer
#   sh scripts/agents.lib.sh --model   reviewer
#
# Examples of the SHAPE. No real tokens and no real model ids — the kit names
# neither, and an agent harness token is yours because it is the name YOUR
# invocation template will be keyed on:
#   AGENT_HARNESSES='<the agent CLIs you actually have>'
#   AGENT_TIER_REVIEWER='<an agent harness other than your implementer's>:<model id>'
#
AGENT_HARNESSES='claude-code codex'

# EACH DECLARED AGENT HARNESS NEEDS AN INVOCATION before anything can be
# dispatched to it. This is the fact adapters/claude-code/README.md says cannot
# be written portably — where a model id goes, and how a prompt gets in:
#
#   AGENT_HARNESS_<TOKEN>_CMD='<command> {model_flag} < {prompt_file}'
#   AGENT_HARNESS_<TOKEN>_MODEL_FLAG='<the flag it wants> {model}'
#
# `{model_flag}` expands to the second template with `{model}` filled — and to
# NOTHING when the tier maps no model, so the flag is omitted entirely rather
# than passed empty. That is the same adapter note's rule ("do not pass an empty
# string as the model parameter... branch on emptiness"), made declarative.
# `{prompt_file}` is the assembled prompt, which always arrives on stdin.
#
# The token folds into the variable name the way a task domain does: a hyphen
# becomes an underscore, and the shape is the same `[a-z][a-z0-9-]*`.
#
# EVERYTHING ELSE IN THE COMMAND IS YOURS, and one part of it deserves saying
# out loud: the AUTONOMY FLAGS a headless worker runs under — approval modes,
# sandbox settings, tool allowlists — are a security posture with your blast
# radius, and the kit writes none of them for you. Shared invariant §7 still
# holds whatever you write: a worker does not push and does not merge.
#
# AN APPROVAL-GATED CLI NEEDS ITS POLICY WIRED before it can be dispatched to.
# Headless, there is nobody to approve a tool call: a reviewer told to run
# `git diff` under an approval mode waits forever. Either the invocation
# carries the CLI's own headless policy (its policy file, its allow-list — the
# kit names none), or the dispatch carries --timeout <seconds>, which kills
# the worker's process tree and exits 124. Both is the honest wiring.
#
# A DISPATCH INSIDE A DISPATCHED WORKER IS BOUNDED IN DEPTH. A worker may run
# the dispatcher itself, and one whose tier maps back to its own agent
# harness would nest until the host ran out of processes. This is the
# ceiling: a dispatch past it is refused, exit 4, before anything spawns.
# Empty means the kit default, 3 — a planner that dispatches implementers
# that dispatch reviewers, the deepest legitimate shape today. Raise it when
# a legitimate shape is deeper; it is a ceiling on runaway nesting, not a
# budget, and a worker that reaches it has usually gone wrong. How the depth
# travels and what a refusal says are agent-dispatch.sh's header.
AGENT_DISPATCH_MAX_DEPTH=''

# Check a wiring without spending a token:
#   sh scripts/agent-dispatch.sh reviewer --prompt 'x' --dry-run
#
# A prompt template's %%MARKER%% is filled with --set NAME=VALUE, or with
# --set-file NAME=path for a value too large for a command line — a diff a
# reviewer worker reads is the case it exists for.
#
# A DISPATCH LEAVES ITS SCRATCH BEHIND WHEN IT DIES BEFORE ITS TRAP — killed,
# over a budget, on a host out of tasks. The scratch is a directory named
# agent-dispatch.XXXXXX under $TMPDIR (or /tmp), so a leftover is dispatch
# scratch by name alone, and the next dispatch on the host sweeps any that
# is at least the SWEEP AGE old, saying on stderr how many went. Younger ones
# may be dispatches still running and are left alone; nothing without the
# prefix is ever touched. The age is in whole days, at least 1, and the
# dispatcher's own default — one day — already exceeds any --timeout a
# dispatch plausibly runs under. That relation is the guarantee for a TIMED
# dispatch, so the dispatcher refuses a --timeout that reaches the sweep age
# rather than let a later dispatch sweep a worker still running. An untimed
# dispatch is not bound by it: one that outlives the sweep age has its
# scratch removed under it, which is harmless — the worker took its prompt
# at exec and the untimed path never writes to scratch again. Raise the age
# here if you run longer timeouts; there is no value that disables the
# sweep, only one large enough that it never fires.
#
#   AGENT_DISPATCH_SWEEP_DAYS='<whole days, at least 1; empty is the default>'
AGENT_DISPATCH_SWEEP_DAYS=''

# A DISPATCHED WORKER RUNS INSIDE A BUDGET — a task ceiling and a memory
# ceiling on its whole process tree, derived from THIS host at dispatch time.
# Found live: a worker that forked without bound filled the login session's
# task ceiling in under three minutes, and from then on nothing of the
# operator's could fork — the shell, the agent harness, the SSH session. It
# read as the machine crashing. A budget keeps that inside the worker.
#
# The kit ships no number for it, for the reason it ships no model: the right
# ceiling on a 2 vCPU VM is wrong on a workstation and wrong again in a CI
# container. It ships PERCENTAGES and CLAMPS, and the host supplies the base:
#
#   AGENT_BUDGET_TASKS_PERCENT       of the task ceiling your own session runs
#                                    under — the smallest cgroup pids.max on
#                                    the path from your own cgroup up, where
#                                    cgroup v2 is present (the user slice's
#                                    TasksMax on a systemd host), else the
#                                    per-user process limit
#   AGENT_BUDGET_TASKS_FLOOR         raised to this, and said so, on a host too
#   AGENT_BUDGET_TASKS_CEILING       small; held to this on a host too big
#   AGENT_BUDGET_MEMORY_PERCENT      of MemAvailable, read at dispatch time
#   AGENT_BUDGET_MEMORY_FLOOR_MIB    the same two clamps, in MiB
#   AGENT_BUDGET_MEMORY_CEILING_MIB
#
# EMPTY MEANS THE KIT DEFAULT: 25% of the tasks, between 256 and 4096; 50% of
# the memory, between 512 and 8192 MiB. On the host that found this, that is
# a quarter of the slice and half the free memory — the operator keeps the
# rest when a worker runs away. Set one to a whole number to override it, and
# read what it came to before a token is spent:
#   sh scripts/agent-dispatch.sh reviewer --prompt 'x' --dry-run
#
# One dispatch can replace the derived numbers with --budget-tasks <n> and
# --budget-memory <MiB>, or run with none at all under --no-budget — which the
# dispatcher says out loud every time, because a worker with no budget is the
# incident above waiting for a second run.
#
# HOW IT IS APPLIED is the host's to offer, not yours to configure: a
# transient scope under your user service manager where there is one (the
# budget is then a cgroup the worker's whole tree shares), rlimits in the
# worker's shell where there is not (weaker — per process, and the dry run
# says so), and a loud no-op where neither exists. A dispatch inside a
# dispatched worker inherits the outer budget and opens no second one.
# Whether the release you are on applies the budget or only shows it, the
# dry run's own budget line says.
AGENT_BUDGET_TASKS_PERCENT=''
AGENT_BUDGET_TASKS_FLOOR=''
AGENT_BUDGET_TASKS_CEILING=''
AGENT_BUDGET_MEMORY_PERCENT=''
AGENT_BUDGET_MEMORY_FLOOR_MIB=''
AGENT_BUDGET_MEMORY_CEILING_MIB=''

# ---------------------------------------------------------------------------
# THIS REPO FILLS IT IN (ADR-0084, amended 2026-09-21) — TWO HARNESSES, ONE MAP EACH
# ---------------------------------------------------------------------------
# The paragraphs above are the KIT's stance: it ships these empty because a
# framework has no provider. This file is local (see VERSION), so this repo
# names its models — and, since 2026-09-21, its AGENT HARNESSES. The operator
# runs this repo from two of them, Claude Code and Codex, and wants a
# different mix in each, with the REVIEWER ALWAYS ON THE OTHER VENDOR:
#
#   session       planner        implementer     mechanical      reviewer
#   claude-code   fable          opus            haiku           codex:gpt-5.6-sol
#   codex         gpt-6-astra    gpt-5.6-luna    gpt-5.6-luna    claude-code:claude-fable-5-1
#
# HOW THE MAP KNOWS WHICH SESSION IT IS IN. The kit's model is "a value with
# no prefix runs on the caller's own harness" — it never asks which harness
# that is, because one map served one harness. Two harnesses need the answer,
# so this file (sourced shell, i.e. CODE — the kit says a policy file may be)
# selects a half on AGENT_SESSION_HARNESS, resolved in this order:
#
#   1. AGENT_SESSION_HARNESS set in the environment  — the explicit answer;
#      a Codex session on Linux has no reliable marker of its own, so set it
#      there: `[shell_environment_policy] set = { AGENT_SESSION_HARNESS = "codex" }`
#      in ~/.codex/config.toml, or export it in the shell that starts codex.
#   2. CLAUDECODE set                                  — Claude Code exports it
#      into every shell it runs, so a Claude Code session needs nothing.
#   3. CODEX_SANDBOX / CODEX_SANDBOX_NETWORK_DISABLED  — Codex's own markers,
#      present only under its sandbox (macOS seatbelt, or network-off).
#   4. otherwise claude-code, said ONCE on stderr      — a plain operator
#      shell, CI, or an unmarked harness gets the repo's primary map rather
#      than nothing; scripts/test/agents-mapping.test.mjs holds the message.
#
# WHY THE VALUES HAVE THE SHAPES THEY HAVE.
#   - Unprefixed values in the claude-code half are Claude Code ALIASES
#     (opus | sonnet | haiku | fable), because that is what the Agent tool's
#     `model` parameter accepts — a full id there is an input-validation
#     error, not a pin. `fable` is the alias for Claude Fable 5.1.
#   - Unprefixed values in the codex half are what `codex -m` takes — the
#     operator's own model names for that harness (gpt-6-astra is also the
#     default model in ~/.codex/config.toml). Not verified against a vendor
#     reference here; they are the operator's policy data.
#   - The reviewer is PREFIXED with the OTHER harness, and its model is what
#     that harness's CLI takes on its command line: `codex -m gpt-5.6-sol`,
#     `claude --model claude-fable-5-1` (the CLI accepts full ids; the alias
#     would also work, the full id is the unambiguous one at a process seam).
#   - mechanical on codex is NOT an operator decision yet: the map named no
#     cheap Codex model, so it takes the coder's. Re-point it when there is a
#     cheaper capable one; the cost seam (mechanical != reviewer) still holds.
#   - AGENT_TIER_REVIEWER_SELF_IMPLEMENTED (kit 0.16.0) is deliberately GONE:
#     with the reviewer on the other vendor there is no self-implemented case
#     left to special-case — the domain falls back to the reviewer tier, and
#     that IS the independent one. The test pins that fallback.
#
# WHAT THE ALIASES MEAN TODAY (recorded, never stored as the value). For the
# reader who needs the dated id behind an alias, checked 2026-09-21 against
# the Claude API model reference; documentation that rots on the vendor's
# schedule, re-checked at each /housekeeping pass:
#
#   fable    claude-fable-5-1     sonnet   claude-sonnet-5
#   opus     claude-opus-5        haiku    claude-haiku-4-5
#
# WHAT A DISPATCH ACTUALLY RUNS is the two invocation templates below. Only
# the reviewer ever crosses, so each template is a READ-ONLY worker posture:
# codex in its read-only sandbox, claude in plan mode. Neither can write the
# tree, push, or merge (shared invariant §7). The prompt is
# .agents/prompts/review-worker.md, filled by the dispatcher:
#
#   sh scripts/agent-dispatch.sh reviewer --prompt-file .agents/prompts/review-worker.md \
#     --set BRANCH=<branch> --set BASE=origin/main --set-file SPEC=<ticket.md> --timeout 900
#
# Both CLIs are approval-gated when a command escapes their read-only posture,
# and headless there is nobody to approve — hence --timeout on every real
# dispatch (the kit's rule above). Check a wiring without spending a token:
#   sh scripts/agent-dispatch.sh reviewer --prompt x --dry-run

# --- which half? ---------------------------------------------------------
if [ -z "${AGENT_SESSION_HARNESS:-}" ]; then
	if [ -n "${CLAUDECODE:-}" ]; then
		AGENT_SESSION_HARNESS=claude-code
	elif [ -n "${CODEX_SANDBOX:-}" ] || [ -n "${CODEX_SANDBOX_NETWORK_DISABLED:-}" ]; then
		AGENT_SESSION_HARNESS=codex
	else
		AGENT_SESSION_HARNESS=claude-code
		printf '%s\n' "agents.config: no session-harness marker found — assuming claude-code (set AGENT_SESSION_HARNESS to override)" >&2
	fi
fi

# --- the invocation each declared agent harness needs --------------------
# codex exec reads the prompt on stdin; -s read-only is the sandbox the
# reviewer runs in; --ephemeral keeps a worker's session out of the operator's
# history; -C anchors the worker in this checkout whatever its cwd. The model
# flag is omitted entirely when the tier maps no model (kit rule).
AGENT_HARNESS_CODEX_CMD='codex exec -s read-only --ephemeral -C "$PWD" {model_flag} < {prompt_file}'
AGENT_HARNESS_CODEX_MODEL_FLAG='-m {model}'
# claude -p reads the prompt on stdin; plan mode is the read-only posture.
AGENT_HARNESS_CLAUDE_CODE_CMD='claude -p --permission-mode plan {model_flag} < {prompt_file}'
AGENT_HARNESS_CLAUDE_CODE_MODEL_FLAG='--model {model}'

# --- the map -------------------------------------------------------------
case "$AGENT_SESSION_HARNESS" in
codex)
	# 1. PLANNER — decomposition, design, triage
	AGENT_TIER_PLANNER='gpt-6-astra'
	# 2. IMPLEMENTER — one ticket, test-first, through the seams
	AGENT_TIER_IMPLEMENTER='gpt-5.6-luna'
	# 3. MECHANICAL — checkable definition of done (no cheap Codex model named yet; see above)
	AGENT_TIER_MECHANICAL='gpt-5.6-luna'
	# 4. REVIEWER — adversarial reading in fresh context, on the OTHER vendor
	AGENT_TIER_REVIEWER='claude-code:claude-fable-5-1'
	;;
*)
	# 1. PLANNER — decomposition, design, triage
	AGENT_TIER_PLANNER='fable'
	# 2. IMPLEMENTER — one ticket, test-first, through the seams
	AGENT_TIER_IMPLEMENTER='opus'
	# 3. MECHANICAL — checkable definition of done, no judgement required
	AGENT_TIER_MECHANICAL='haiku'
	# 4. REVIEWER — adversarial reading in fresh context, on the OTHER vendor
	AGENT_TIER_REVIEWER='codex:gpt-5.6-sol'
	;;
esac
