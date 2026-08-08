// Self-tests for scripts/behavior-delta.sh — the deterministic Axis-2 candidate
// list (.claude/skills/review-pr, Agent 7).
//
// The script's whole job is reading git history, so a fake would test nothing:
// every case here builds a REAL throwaway repository in a temp dir, commits a
// synthetic branch into it, and runs the script against it. Same node:test
// tier as scripts/docs-conformance/test/ — dependency-free, no install needed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(fileURLToPath(import.meta.url), "../../behavior-delta.sh");

// Every invocation carries its own identity, no signing and no hooks: the
// fixture must not inherit the developer's global git config (a required GPG
// key or a husky hooksPath would make these tests fail for reasons that have
// nothing to do with the script).
const HERMETIC = [
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=.git/no-such-hooks",
];

function git(repo, args) {
  return execFileSync("git", [...HERMETIC, ...args], { cwd: repo, encoding: "utf8" });
}

function write(repo, rel, content) {
  const path = join(repo, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** A repo on `main` with one base commit; the caller adds the branch. */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "behavior-delta-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["checkout", "--quiet", "-b", "main"]);
  write(repo, "README.md", "base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "chore: base"]);
  return repo;
}

/** Write `{ 'rel/path': 'content' }`, stage everything, commit; return short sha. */
function commit(repo, subject, files = {}) {
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "--allow-empty", "-m", subject]);
  return git(repo, ["rev-parse", "--short", "HEAD"]).trim();
}

/** Run the script inside the fixture, scoped against the fixture's `main`. */
function run(repo) {
  return execFileSync("sh", [SCRIPT, "main"], { cwd: repo, encoding: "utf8" });
}

function cleanup(repo) {
  rmSync(repo, { recursive: true, force: true });
}

// --- Branch-level sections (the script's original contract) ------------------

test("reports no deltas when the branch touches nothing under contract", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "refactor/inert"]);
  commit(repo, "refactor(domain): rename a local", {
    "packages/domain/src/a.ts": "const b = 1;\n",
  });

  assert.match(run(repo), /No contract-artifact deltas on this branch\./);
  cleanup(repo);
});

test("lists an API-surface delta under its own section", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "feat/api"]);
  commit(repo, "feat(api): add a path", { "docs/api/openapi.yaml": "openapi: 3.1.0\n" });

  const out = run(repo);
  assert.match(out, /## API surface \(docs\/api\/openapi\.yaml\)/);
  assert.match(out, /docs\/api\/openapi\.yaml/);
  assert.doesNotMatch(out, /No contract-artifact deltas/);
  cleanup(repo);
});

test("lists an edited existing test but not a newly added one", () => {
  const repo = makeRepo();
  commit(repo, "test(domain): existing coverage", {
    "packages/domain/src/old.test.ts": "// v1\n",
  });
  git(repo, ["checkout", "--quiet", "-b", "chore/tests"]);
  commit(repo, "test(domain): touch both", {
    "packages/domain/src/old.test.ts": "// v2\n",
    "packages/domain/src/new.test.ts": "// added\n",
  });

  const out = run(repo);
  assert.match(out, /## Edited existing tests/);
  assert.match(out, /packages\/domain\/src\/old\.test\.ts/);
  assert.doesNotMatch(out, /packages\/domain\/src\/new\.test\.ts/);
  cleanup(repo);
});

test("reports the path that exists at HEAD for a renamed contract file", () => {
  const repo = makeRepo();
  commit(repo, "feat(env): a config module", { "packages/env/old.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/move"]);
  git(repo, ["mv", "packages/env/old.ts", "packages/env/new.ts"]);
  git(repo, ["commit", "--quiet", "-m", "refactor(env): move the module"]);

  const out = run(repo);
  assert.match(out, /packages\/env\/new\.ts/);
  assert.doesNotMatch(out, /packages\/env\/old\.ts/);
  cleanup(repo);
});

// --- Commit separation (shared-invariants §10) -------------------------------

const SEPARATION = /## Commit separation/;

/** The lines of the commit-separation section, or [] when it was not printed. */
function separationBlock(out) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => SEPARATION.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l.trim() !== "");
}

test("flags a refactor commit that also edits a contract artifact", () => {
  const repo = makeRepo();
  commit(repo, "feat(api): a path", { "docs/api/openapi.yaml": "openapi: 3.1.0\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/mixed"]);
  const sha = commit(repo, "refactor(api): tidy the handler", {
    "packages/domain/src/a.ts": "const a = 1;\n",
    "docs/api/openapi.yaml": "openapi: 3.1.0\npaths: {}\n",
  });

  const block = separationBlock(run(repo)).join("\n");
  assert.match(block, new RegExp(sha));
  assert.match(block, /refactor\(api\): tidy the handler/);
  assert.match(block, /docs\/api\/openapi\.yaml/);
  cleanup(repo);
});

test("flags a style commit on a contract artifact just as it flags a refactor one", () => {
  const repo = makeRepo();
  commit(repo, "feat(headers): a policy", { "packages/headers/csp.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "style/mixed"]);
  commit(repo, "style(headers): reformat", { "packages/headers/csp.ts": "export const a = 2;\n" });

  assert.match(separationBlock(run(repo)).join("\n"), /packages\/headers\/csp\.ts/);
  cleanup(repo);
});

test("prints no separation section when every commit is honest about its type", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "feat/honest"]);
  commit(repo, "refactor(domain): rename a local", {
    "packages/domain/src/a.ts": "const b = 1;\n",
  });
  commit(repo, "feat(api): add a path", { "docs/api/openapi.yaml": "openapi: 3.1.0\n" });

  const out = run(repo);
  assert.doesNotMatch(out, SEPARATION);
  // The behaviour-changing commit is still on the branch-level list — the new
  // section narrows the claim, it does not swallow the candidate.
  assert.match(out, /## API surface/);
  cleanup(repo);
});

test("does not flag a refactor commit that only renames a contract file", () => {
  const repo = makeRepo();
  commit(repo, "feat(env): a config module", { "packages/env/old.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/pure-move"]);
  git(repo, ["mv", "packages/env/old.ts", "packages/env/new.ts"]);
  git(repo, ["commit", "--quiet", "-m", "refactor(env): move the module"]);

  assert.doesNotMatch(run(repo), SEPARATION);
  cleanup(repo);
});

test("does not flag a refactor commit that only ADDS a test under a contract path", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "refactor/characterize"]);
  commit(repo, "refactor(db): pin the current shape first", {
    "packages/db/schema.test.ts": "// characterization\n",
  });

  assert.doesNotMatch(run(repo), SEPARATION);
  cleanup(repo);
});

test("does flag a refactor commit that edits an existing .feature scenario", () => {
  const repo = makeRepo();
  commit(repo, "feat(e2e): a scenario", { "tests/e2e/features/x.feature": "Feature: a\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/scenario"]);
  commit(repo, "refactor(e2e): tidy the scenario", {
    "tests/e2e/features/x.feature": "Feature: a\n  Scenario: b\n",
  });

  assert.match(separationBlock(run(repo)).join("\n"), /tests\/e2e\/features\/x\.feature/);
  cleanup(repo);
});

test("does not flag a refactor commit whose unit tests moved with a rename", () => {
  const repo = makeRepo();
  commit(repo, "feat(db): a query + its test", {
    "packages/db/query.ts": "export const oldName = () => 1;\n",
    "packages/db/query.test.ts": "// calls oldName\n",
  });
  git(repo, ["checkout", "--quiet", "-b", "refactor/rename-symbol"]);
  commit(repo, "refactor(db): rename oldName to newName", {
    "packages/db/query.ts": "export const newName = () => 1;\n",
    "packages/db/query.test.ts": "// calls newName\n",
  });

  // The SOURCE edit under packages/db is the finding; the co-moving unit test
  // must not add a second, noisier one — call-site churn is what a rename IS.
  const block = separationBlock(run(repo)).join("\n");
  assert.match(block, /packages\/db\/query\.ts/);
  assert.doesNotMatch(block, /packages\/db\/query\.test\.ts/);
  cleanup(repo);
});

test("ignores merge commits and subjects that are not Conventional Commits", () => {
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "chore/side"]);
  commit(repo, "refactor(env): a config module", { "packages/env/a.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "main"]);
  git(repo, ["checkout", "--quiet", "-b", "chore/merge-host"]);
  commit(repo, "wip: not conventional at all", {
    "packages/headers/csp.ts": "export const a = 1;\n",
  });
  git(repo, ["merge", "--quiet", "--no-ff", "-m", "Merge branch 'chore/side'", "chore/side"]);

  const out = run(repo);
  assert.doesNotMatch(out, /Merge branch/);
  assert.doesNotMatch(out, /wip: not conventional/);
  cleanup(repo);
});

// The ticket's demo, as a test: one clean refactor commit, one mixed commit,
// only the mixed one flagged.
test("flags only the mixed commit on a branch that also carries a clean refactor", () => {
  const repo = makeRepo();
  commit(repo, "feat(events): the doc", { "docs/events.md": "# Events\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/two-commits"]);
  const clean = commit(repo, "refactor(domain): extract a helper", {
    "packages/domain/src/a.ts": "export const helper = () => 1;\n",
  });
  const mixed = commit(repo, "refactor(events): rename the emitter", {
    "packages/domain/src/b.ts": "export const b = 1;\n",
    "docs/events.md": "# Events\n- report.published\n",
  });

  const block = separationBlock(run(repo)).join("\n");
  assert.match(block, new RegExp(mixed));
  assert.doesNotMatch(block, new RegExp(clean));
  assert.match(block, /docs\/events\.md/);
  assert.doesNotMatch(block, /packages\/domain\/src\/b\.ts/);
  cleanup(repo);
});
