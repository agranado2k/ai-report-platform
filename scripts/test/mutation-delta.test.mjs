// Self-tests for the differential mutation diagnostic (ADR-0081 §1 follow-up):
//   scripts/mutation-delta.sh          — git scoping + the Stryker invocation
//   scripts/mutation-delta-report.mjs  — the review-consumable summary
//
// Two halves, tested two ways. The scoping half's whole job is reading git
// history, so — exactly as scripts/test/behavior-delta.test.mjs does — every
// case builds a REAL throwaway repository and runs the script against it, in
// `--list` mode so no Stryker (and no install) is needed. The reporting half is
// pure: it gets fixture JSON in the mutation-testing-report schema Stryker
// emits, captured from a real run.
//
// Same node:test tier as scripts/test/behavior-delta.test.mjs — dependency-free.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const SCRIPT = resolve(HERE, "../mutation-delta.sh");
const REPORTER = resolve(HERE, "../mutation-delta-report.mjs");

// Identity, no signing, no hooks: the fixture must not inherit the developer's
// global git config (a required GPG key or a husky hooksPath would fail these
// tests for reasons that have nothing to do with the script).
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

/** A repo on `main` carrying a domain package; the caller adds the branch. */
function makeRepo(baseFiles = {}) {
  const repo = mkdtempSync(join(tmpdir(), "mutation-delta-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["checkout", "--quiet", "-b", "main"]);
  write(repo, "README.md", "base\n");
  for (const [rel, content] of Object.entries(baseFiles)) write(repo, rel, content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "chore: base"]);
  return repo;
}

function commit(repo, subject, files = {}) {
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "--allow-empty", "-m", subject]);
}

/** Run the scoping script inside the fixture in list-only mode. */
function list(repo) {
  return execFileSync("sh", [SCRIPT, "--list", "main"], { cwd: repo, encoding: "utf8" });
}

/** The indented paths of the `## Scope` section, or [] when it was not printed. */
function scope(out) {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Scope"));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter(Boolean);
}

function cleanup(repo) {
  rmSync(repo, { recursive: true, force: true });
}

// --- Scoping: which files the run mutates ------------------------------------

const SKIPPED = /No domain source changed on this branch — mutation run skipped\./;

test("skips the run when the branch changed no domain source", () => {
  const repo = makeRepo({ "packages/domain/src/slug.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "chore/elsewhere"]);
  commit(repo, "test(domain): more coverage", {
    "packages/domain/src/slug.test.ts": "// added\n",
    "apps/app/app/routes/x.ts": "export const x = 1;\n",
  });

  const out = list(repo);
  assert.match(out, SKIPPED);
  assert.deepEqual(scope(out), []);
  cleanup(repo);
});

test("scopes the mutate list to the domain source files this branch changed", () => {
  const repo = makeRepo({
    "packages/domain/src/acl.ts": "export const a = 1;\n",
    "packages/domain/src/slug.ts": "export const s = 1;\n",
  });
  git(repo, ["checkout", "--quiet", "-b", "feat/acl"]);
  commit(repo, "feat(domain): widen the acl", {
    "packages/domain/src/acl.ts": "export const a = 2;\n",
  });

  const out = list(repo);
  assert.deepEqual(scope(out), ["src/acl.ts"]);
  assert.doesNotMatch(out, SKIPPED);
  cleanup(repo);
});

test("excludes the barrel and every test file from the mutate list", () => {
  // Mirrors stryker.config.mjs's `mutate` excludes: mutating a re-export or a
  // test file measures nothing.
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "feat/mixed"]);
  commit(repo, "feat(domain): a value object", {
    "packages/domain/src/anchor.ts": "export const a = 1;\n",
    "packages/domain/src/anchor.test.ts": "// example\n",
    "packages/domain/src/anchor.property.test.ts": "// property\n",
    "packages/domain/src/index.ts": "export * from './anchor';\n",
  });

  assert.deepEqual(scope(list(repo)), ["src/anchor.ts"]);
  cleanup(repo);
});

test("drops a deleted domain source file — there is nothing left to mutate", () => {
  const repo = makeRepo({
    "packages/domain/src/gone.ts": "export const g = 1;\n",
    "packages/domain/src/kept.ts": "export const k = 1;\n",
  });
  git(repo, ["checkout", "--quiet", "-b", "refactor/prune"]);
  git(repo, ["rm", "--quiet", "packages/domain/src/gone.ts"]);
  write(repo, "packages/domain/src/kept.ts", "export const k = 2;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--quiet", "-m", "refactor(domain): drop the dead vo"]);

  assert.deepEqual(scope(list(repo)), ["src/kept.ts"]);
  cleanup(repo);
});

test("skips the run when the branch only deleted domain source", () => {
  const repo = makeRepo({ "packages/domain/src/gone.ts": "export const g = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/prune-only"]);
  git(repo, ["rm", "--quiet", "packages/domain/src/gone.ts"]);
  git(repo, ["commit", "--quiet", "-m", "refactor(domain): drop the dead vo"]);

  assert.match(list(repo), SKIPPED);
  cleanup(repo);
});

test("reports the path that exists at HEAD for a renamed domain source file", () => {
  const repo = makeRepo({ "packages/domain/src/old.ts": "export const a = 1;\n" });
  git(repo, ["checkout", "--quiet", "-b", "refactor/move"]);
  git(repo, ["mv", "packages/domain/src/old.ts", "packages/domain/src/new.ts"]);
  git(repo, ["commit", "--quiet", "-m", "refactor(domain): rename the module"]);

  assert.deepEqual(scope(list(repo)), ["src/new.ts"]);
  cleanup(repo);
});

test("ignores source changed outside packages/domain/src", () => {
  // The calibration target is the domain package (ADR-0081 §2); an application
  // or adapter change is out of scope until it has its own cost calibration.
  const repo = makeRepo();
  git(repo, ["checkout", "--quiet", "-b", "feat/app"]);
  commit(repo, "feat(application): a use case", {
    "packages/application/src/upload.ts": "export const u = 1;\n",
    "packages/domain/README.md": "# domain\n",
  });

  assert.match(list(repo), SKIPPED);
  cleanup(repo);
});

// --- Reporting: the review-consumable summary --------------------------------

/** Write a mutation-testing-report JSON fixture and summarize it. */
function summarize(files) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-report-"));
  const path = join(dir, "mutation.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: "1.0", files }));
  try {
    return execFileSync("node", [REPORTER, path], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mutant(status, line, column, mutatorName, replacement) {
  return {
    id: `${line}-${column}`,
    mutatorName,
    replacement,
    status,
    location: { start: { line, column }, end: { line, column: column + 1 } },
  };
}

test("reports the score and every surviving mutant with file, line and mutator", () => {
  const out = summarize({
    "src/slug.ts": {
      mutants: [
        mutant("Killed", 12, 3, "ConditionalExpression", "true"),
        mutant("Survived", 19, 27, "StringLiteral", '""'),
      ],
    },
  });

  assert.match(out, /50\.00%/);
  assert.match(out, /src\/slug\.ts:19:27/);
  assert.match(out, /StringLiteral/);
  // The killed one is a number in the score, not an item on the reading list.
  assert.doesNotMatch(out, /src\/slug\.ts:12:3/);
});

test("counts a timeout as detected and lists a no-coverage mutant as a survivor", () => {
  const out = summarize({
    "src/acl.ts": {
      mutants: [
        mutant("Killed", 1, 1, "BooleanLiteral", "false"),
        mutant("Timeout", 2, 1, "ArithmeticOperator", "-"),
        mutant("NoCoverage", 3, 1, "BlockStatement", "{}"),
      ],
    },
  });

  // detected 2 / valid 3
  assert.match(out, /66\.67%/);
  assert.match(out, /NoCoverage\s+src\/acl\.ts:3:1/);
  assert.match(out, /Survivors \(1\)/);
});

test("says so plainly when every mutant in the scoped files was killed", () => {
  const out = summarize({
    "src/anchor.ts": { mutants: [mutant("Killed", 1, 1, "BooleanLiteral", "false")] },
  });

  assert.match(out, /100\.00%/);
  assert.match(out, /Survivors \(0\)/);
  assert.match(out, /every mutant in the scoped files was killed/);
});

test("lists survivors in source order so the reading list follows the file", () => {
  // Stryker emits mutants in generation order, which interleaves lines (a real
  // run put 44:32 before 43:7). A reviewer reads a file top-down.
  const out = summarize({
    "src/anchor.ts": {
      mutants: [
        mutant("Survived", 44, 32, "StringLiteral", '""'),
        mutant("Survived", 43, 7, "ConditionalExpression", "false"),
        mutant("Survived", 43, 38, "BlockStatement", "{}"),
      ],
    },
  });

  const wheres = out
    .split("\n")
    .filter((l) => l.includes("src/anchor.ts:"))
    .map((l) => l.trim().split(/\s+/)[1]);
  assert.deepEqual(wheres, ["src/anchor.ts:43:7", "src/anchor.ts:43:38", "src/anchor.ts:44:32"]);
});

test("collapses a multi-line replacement onto the mutant's one line", () => {
  // BlockStatement and ObjectLiteral mutants carry real source as their
  // replacement; an un-flattened one would break the one-mutant-per-line shape
  // the reviewer scans.
  const out = summarize({
    "src/report.ts": {
      mutants: [mutant("Survived", 8, 5, "BlockStatement", "{\n  return null;\n}")],
    },
  });

  const survivor = out.split("\n").find((l) => l.includes("src/report.ts:8:5"));
  assert.ok(survivor, "the survivor should be listed");
  assert.doesNotMatch(out, /\n\s+return null;/);
});
