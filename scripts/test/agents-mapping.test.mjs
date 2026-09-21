// Self-tests for THIS REPO's capability-tier mapping (scripts/agents.config.sh),
// resolved through the shared resolver (scripts/agents.lib.sh) and dispatched
// through the shared dispatcher (scripts/agent-dispatch.sh). ADR-0084.
//
// The resolver and the dispatcher are shared-layer mechanism; what this pins is
// the LOCAL policy the kit deliberately leaves open. Since 2026-09-21 that
// policy has two halves, keyed on the AGENT HARNESS the session runs in:
//
//   session       planner        implementer     mechanical      reviewer
//   claude-code   fable          opus            haiku           codex:gpt-5.6-sol
//   codex         gpt-6-astra    gpt-5.6-luna    gpt-5.6-luna    claude-code:claude-fable-5-1
//
// Two seams have to hold in BOTH halves, and each is a mechanism here rather
// than a prose claim (shared invariant §8): the cost seam (mechanical is never
// the reviewer's model) and the independence seam (the reviewer is never the
// implementer's model — and, stronger, never the implementer's VENDOR: the
// reviewer tier always names the other agent harness).
//
// Runs the REAL resolver and dispatcher as an agent following a SKILL.md would
// (`sh scripts/agents.lib.sh <tier>` from the repo root), so it exercises the
// exact resolution path, not a fake. The session harness is selected the way
// the config selects it — through the AGENT_SESSION_HARNESS environment
// variable — so both halves are tested from one process. Dependency-free
// node:test tier, same as the sibling scripts/test/*.test.mjs files
// (`pnpm test:scripts`).

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const RESOLVER = resolve(REPO_ROOT, "scripts/agents.lib.sh");
const DISPATCHER = resolve(REPO_ROOT, "scripts/agent-dispatch.sh");
const TIERS = ["planner", "implementer", "mechanical", "reviewer"];
const SESSIONS = ["claude-code", "codex"];

/** Resolve a tier the way a SKILL.md does, in a session on the given agent
 *  harness: from the repo root, capturing only stdout (the resolver prints the
 *  answer to stdout, diagnostics to stderr). `what` is --model (default) or
 *  --harness. */
function resolveIn(session, tier, { domain, what = "--model" } = {}) {
  const args = domain ? [RESOLVER, what, tier, domain] : [RESOLVER, what, tier];
  return execFileSync("sh", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, AGENT_SESSION_HARNESS: session, AGENTS_TIER_QUIET: "1" },
  }).trim();
}

/** The Claude Code Agent tool's `model` parameter accepts exactly these and
 *  rejects a full model id with an input-validation error — so a value that
 *  runs IN a Claude Code session must be one of them. A value dispatched to
 *  another agent harness is whatever that harness's CLI takes. */
const CLAUDE_CODE_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

for (const session of SESSIONS) {
  for (const tier of TIERS) {
    test(`[${session}] tier '${tier}' resolves to a mapped model`, () => {
      assert.notEqual(
        resolveIn(session, tier),
        "",
        `tier '${tier}' resolved to nothing in a ${session} session — every tier is mapped in both halves of scripts/agents.config.sh (ADR-0084)`,
      );
    });
  }

  test(`[${session}] the cost seam holds: mechanical is not the reviewer model`, () => {
    assert.notEqual(
      resolveIn(session, "mechanical"),
      resolveIn(session, "reviewer"),
      "mechanical and reviewer resolved to the same model — the cost seam has collapsed (ADR-0084)",
    );
  });

  test(`[${session}] the independence seam holds: the reviewer is on the OTHER agent harness`, () => {
    // Kit 0.16.0's rule, "the reviewer is never the model that implemented",
    // taken to its vendor-level form (kit 0.18.0's third axis): the reviewer
    // tier names the agent harness the session is NOT running in, so no diff
    // is ever reviewed by its author's model family. A reviewer value that
    // loses its prefix silently becomes "this session's own harness" — the
    // resolver documents that fallback — and this is what catches it.
    const reviewerHarness = resolveIn(session, "reviewer", { what: "--harness" });
    assert.notEqual(
      reviewerHarness,
      "",
      "the reviewer tier names no agent harness — it would run on the author's",
    );
    assert.notEqual(
      reviewerHarness,
      session,
      `the reviewer tier runs on ${session}, the session's own harness`,
    );
    for (const tier of ["planner", "implementer", "mechanical"]) {
      assert.equal(
        resolveIn(session, tier, { what: "--harness" }),
        "",
        `tier '${tier}' names an agent harness — only the reviewer crosses; the rest run in the session (ADR-0084)`,
      );
    }
    assert.notEqual(
      resolveIn(session, "reviewer"),
      resolveIn(session, "implementer"),
      "reviewer and implementer resolved to the same model",
    );
  });

  test(`[${session}] a self-implemented review resolves to the cross-vendor reviewer`, () => {
    // With the reviewer on another vendor there is no self-implemented case
    // left to special-case: the domain falls back to the reviewer tier, and
    // that IS the independent one. Pinned so nobody re-adds a same-vendor
    // mapping for it.
    assert.equal(
      resolveIn(session, "reviewer", { domain: "self-implemented" }),
      resolveIn(session, "reviewer"),
    );
    assert.notEqual(
      resolveIn(session, "reviewer", { domain: "self-implemented" }),
      resolveIn(session, "implementer"),
    );
  });
}

test("[claude-code] every value that runs in-session is a Claude Code model alias, never a dated id", () => {
  for (const tier of ["planner", "implementer", "mechanical"]) {
    const value = resolveIn("claude-code", tier);
    assert.ok(
      CLAUDE_CODE_ALIASES.has(value),
      `'${value}' is not a Claude Code model alias (${[...CLAUDE_CODE_ALIASES].join("/")}) — a dated id here breaks the spawn call; record it in the comment table instead (ADR-0084)`,
    );
  }
});

test("[claude-code] the reviewer dispatches to codex with the mapped model — dry run, no tokens spent", () => {
  // The wiring, not the model: the dispatcher's --dry-run prints the command it
  // would run. A missing invocation template is exit 2; a tier with no agent
  // harness is exit 3 (not dispatched). Both would mean the map above is prose.
  const res = spawnSync("sh", [DISPATCHER, "reviewer", "--prompt", "x", "--dry-run"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, AGENT_SESSION_HARNESS: "claude-code", AGENTS_TIER_QUIET: "1" },
  });
  assert.equal(res.status, 0, `dry run failed (exit ${res.status}):\n${res.stderr}`);
  const out = res.stdout + res.stderr;
  assert.match(out, /codex exec/, "the codex invocation template did not reach the dispatcher");
  assert.match(out, /-m gpt-5\.6-sol/, "the mapped model did not reach the codex command line");
  assert.match(
    out,
    /-s read-only/,
    "a dispatched reviewer must run in the read-only sandbox (shared invariant §7)",
  );
});

test("[codex] the reviewer dispatches to claude-code with the mapped model — dry run", () => {
  const res = spawnSync("sh", [DISPATCHER, "reviewer", "--prompt", "x", "--dry-run"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, AGENT_SESSION_HARNESS: "codex", AGENTS_TIER_QUIET: "1" },
  });
  assert.equal(res.status, 0, `dry run failed (exit ${res.status}):\n${res.stderr}`);
  const out = res.stdout + res.stderr;
  assert.match(
    out,
    /claude -p/,
    "the claude-code invocation template did not reach the dispatcher",
  );
  assert.match(
    out,
    /--model claude-fable-5-1/,
    "the mapped model did not reach the claude command line",
  );
  assert.match(
    out,
    /--permission-mode plan/,
    "a dispatched reviewer must run without write permissions (shared invariant §7)",
  );
});

test("an unknown session harness falls back to the claude-code half, loudly", () => {
  // A plain operator shell, CI, or a harness that sets no marker: the config
  // cannot know, so it takes the repo's primary harness and says so once on
  // stderr rather than resolving nothing.
  const res = spawnSync("sh", [RESOLVER, "planner"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_SESSION_HARNESS: "",
      CLAUDECODE: "",
      CODEX_SANDBOX: "",
      CODEX_SANDBOX_NETWORK_DISABLED: "",
    },
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), resolveIn("claude-code", "planner"));
  assert.match(res.stderr, /assuming claude-code/, "the fallback must be audible");
});

test("an unmapped domain falls back to its tier, silently", () => {
  // The domain axis is optional and open (ADR-0084): a domain this repo has no
  // opinion about must resolve to the plain tier, not error.
  assert.equal(
    resolveIn("claude-code", "implementer", { domain: "no-such-domain" }),
    resolveIn("claude-code", "implementer"),
    "an unmapped domain must fall back to the plain tier",
  );
});

test("an unknown tier is a usage error (the vocabulary is closed)", () => {
  const res = spawnSync("sh", [RESOLVER, "wizard"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(res.status, 2, "an unknown tier must exit 2");
  assert.equal(res.stdout.trim(), "", "an unknown tier must print no model");
});
