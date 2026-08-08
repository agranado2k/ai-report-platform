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
  commit(repo, "refactor(domain): rename a local", { "packages/domain/src/a.ts": "const b = 1;\n" });

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
