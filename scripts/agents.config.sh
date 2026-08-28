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
# THIS REPO FILLS IT IN (ADR-0084)
# ---------------------------------------------------------------------------
# The paragraphs above are the KIT's stance: it ships these empty because a
# framework has no provider. This file is local (see VERSION), so this repo does
# name its models — one harness (Claude Code), one provider. The values are
# harness ALIASES, not dated identifiers, because the alias is what a spawn call
# takes and it tracks its family across a version bump. The mapping is derived
# from choices this repo already made in skill prose, so adopting the seam
# changed no behaviour on day one:
#
#   planner      opus    (no named precedent — planner work runs in the
#                         operator's own session or spawns with no model named,
#                         i.e. the session's own, the top of the range)
#   implementer  opus    (/report-comments Phase 3, "one Opus 5 subagent")
#   mechanical   haiku   (/review-pr step 1, "Context Discovery (Haiku agent)")
#   reviewer     opus    (all seven /review-pr sub-agents; claude-code-review.yml)
#
# Three of four are `opus` today, and that is the honest reading of current
# practice, not a failure of the rubric — the VALUE is the seam: re-pointing is
# now a one-file diff a reviewer reads, `mechanical` is genuinely cheaper, and
# scripts/test/agents-mapping.test.mjs fails if any tier is emptied or if
# `mechanical` ever collapses onto the `reviewer` model.

# ---------------------------------------------------------------------------
# 1. PLANNER — decomposition, design, triage
# ---------------------------------------------------------------------------
AGENT_TIER_PLANNER='opus'

# ---------------------------------------------------------------------------
# 2. IMPLEMENTER — one ticket, test-first, through the seams
# ---------------------------------------------------------------------------
AGENT_TIER_IMPLEMENTER='opus'

# ---------------------------------------------------------------------------
# 3. MECHANICAL — checkable definition of done, no judgement required
# ---------------------------------------------------------------------------
AGENT_TIER_MECHANICAL='haiku'

# ---------------------------------------------------------------------------
# 4. REVIEWER — adversarial reading of a finished diff, in fresh context
# ---------------------------------------------------------------------------
AGENT_TIER_REVIEWER='opus'
