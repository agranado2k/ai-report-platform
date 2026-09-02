#!/bin/sh
# guards.config.sh — the one place the guards learn the shape of THIS repo.
#
# This file is DATA, not mechanism. The guards in this directory hold no
# knowledge of centaur-spec's layout; every project-specific pattern lives here,
# in one reviewable file, so a change of policy is a diff a human reads rather
# than an edit inside a script nobody re-reads.
#
# It is sourced by:
#   scripts/tdd-pairing-guard.sh   (and its CI twin)
#   scripts/behavior-delta.sh
#
# THIS FILE IS YOURS. It is not part of the shared layer (see VERSION), it is
# not overwritten by a kit update, and editing it is the intended workflow.
#
# The values below were extracted VERBATIM from centaur-spec's previous forked
# guards (the inline regexes that lived in scripts/tdd-pairing-guard.sh and
# scripts/behavior-delta.sh before v0.10.0's config-driven guards replaced
# them). Reproducing them byte-for-byte is deliberate: the two open PRs' TDD
# pairing and behavior-delta verdicts must not shift when the mechanism moved
# under them. If you change centaur-spec's layout, change these — that is what
# this file is for.

# ---------------------------------------------------------------------------
# 1. SOURCE — the production files whose change demands a test change
# ---------------------------------------------------------------------------
# The vitest-covered production trees PLUS the node:test tree
# scripts/docs-conformance/. KEEP IN SYNC with the `include` globs in
# vitest.config.ts (which carries the matching reminder) — a tree covered there
# but absent here is silently un-guarded.
GUARD_SOURCE_RE='^(packages/[^/]+/src/|apps/mcp/src/|apps/app/app/(server|theme)/|apps/view/app/(server|edit)/|scripts/docs-conformance/).*\.(ts|tsx|mjs)$'

# Paths that match SOURCE but must NOT count as source: the test files
# themselves, type declarations (no behaviour to test), and
# scripts/docs-conformance/config.mjs — reviewable policy DATA (ADR-0041,
# "validators hold no policy"), so editing it needs no test change.
GUARD_SOURCE_EXCLUDE_RE='\.(test|spec)\.(ts|tsx|mjs)$|\.d\.ts$|^scripts/docs-conformance/config\.mjs$'

# ---------------------------------------------------------------------------
# 2. TEST — what counts as the paired test change
# ---------------------------------------------------------------------------
# vitest/node:test suffixes plus Gherkin features.
GUARD_TEST_RE='\.(test|spec)\.(ts|tsx|mjs)$|\.feature$'

# ---------------------------------------------------------------------------
# 3. CONTRACT ARTIFACTS — the surfaces behavior-delta.sh inventories
# ---------------------------------------------------------------------------
# One record per line: a human-readable label, a pipe, an extended regex.
# behavior-delta.sh splits each record on the FIRST pipe, so a label carries no
# pipe of its own while a regex may. These reproduce, verbatim, the eight
# surfaces the forked behavior-delta.sh hard-coded (re_api … re_process) and
# their section titles, so scripts/test/behavior-delta.test.mjs and the two open
# PRs' verdicts are preserved. The process/agent surface deliberately keeps its
# OLD paths (`.claude/constitution/`, `CLAUDE.md`) even though this migration
# moves them, so the verdict on a PR forked before the move does not shift.
BEHAVIOR_DELTA_SURFACES='API surface (docs/api/openapi.yaml)|^docs/api/openapi\.yaml$
Error semantics (packages/http, RFC 9457 model — ADR-0040)|^packages/http/
Domain events (docs/events.md)|^docs/events\.md$
Persistence (packages/db, docs/db-design.md)|^packages/db/|^docs/db-design\.md$
Configuration (packages/env — ADR-0043)|^packages/env/
Security posture (packages/headers — CSP / Trusted Types)|^packages/headers/
Agent-facing prompt surfaces (apps/mcp — ADR-0072)|^apps/mcp/(src/(instructions|prompts|tools)|skill/|packaging/)
Process & agent surfaces (.claude/skills, the constitution, .husky, docs gate — ADR-026/0082)|^\.claude/skills/|^\.claude/constitution/|^CLAUDE\.md$|/CLAUDE\.md$|^\.husky/|^scripts/docs-conformance/'

# Executable specification files. behavior-delta flags these when EDITED inside a
# structure-only commit.
BEHAVIOR_DELTA_FEATURE_RE='\.feature$'
