import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The TDD pairing rule as a SEAM: `scripts/tdd-pairing-guard.sh <base> <head>`.
// The rule used to live inline in `.husky/pre-push`, where it was unreachable
// from anywhere else — so the CI counterpart (issue #280) would have had to be
// a hand-maintained copy, i.e. two rules pretending to be one. These tests
// drive the script directly against throwaway git repositories: real commits,
// real `git diff`, no mocking of git itself, because what is being asserted IS
// the diff classification.

const GUARD = fileURLToPath(new URL("./tdd-pairing-guard.sh", import.meta.url));

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** A fresh repo with one empty root commit, cleaned up after the test. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "tdd-pairing-guard-"));
  repos.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "guard@example.test");
  git(dir, "config", "user.name", "Guard Test");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "commit", "-q", "--allow-empty", "-m", "root");
  return dir;
}

/** Write the given files (path → contents) and commit them. Returns the sha. */
function commit(dir: string, files: Record<string, string>, message = "change"): string {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

function runGuard(dir: string, args: string[]) {
  const res = spawnSync("sh", [GUARD, ...args], { cwd: dir, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Seed a base commit, then a head commit with `files`; guard base..head. */
function guardOverChange(files: Record<string, string>) {
  const dir = initRepo();
  const base = commit(dir, { "README.md": "base\n" }, "base");
  const head = commit(dir, files);
  return runGuard(dir, [base, head]);
}

describe("tdd-pairing-guard.sh", () => {
  it("exits 2 with usage when the ref range is not fully supplied", () => {
    const dir = initRepo();
    const missingBoth = runGuard(dir, []);
    expect(missingBoth.status).toBe(2);
    expect(missingBoth.stderr).toMatch(/usage/i);

    expect(runGuard(dir, ["HEAD"]).status).toBe(2);
  });

  it("exits 2 when the ref range cannot be diffed", () => {
    const dir = initRepo();
    const res = runGuard(dir, ["no-such-ref", "HEAD"]);
    expect(res.status).toBe(2);
  });

  it("blocks source changes that carry no test changes", () => {
    const res = guardOverChange({ "packages/domain/src/report.ts": "export const a = 1;\n" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("packages/domain/src/report.ts");
    expect(res.stderr).toContain("source changes with no test changes");
  });

  it("passes source changes paired with a test change", () => {
    const res = guardOverChange({
      "packages/domain/src/report.ts": "export const a = 1;\n",
      "packages/domain/src/report.test.ts": "test\n",
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  it("accepts a .feature file as the paired test change", () => {
    const res = guardOverChange({
      "packages/domain/src/report.ts": "export const a = 1;\n",
      "tests/e2e/features/thing.feature": "Feature: thing\n",
    });
    expect(res.status).toBe(0);
  });

  it("ignores changes outside the test-covered source trees", () => {
    const res = guardOverChange({
      "docs/diary.md": "log\n",
      "infra/terraform/main.tf": "resource {}\n",
      "apps/app/app/routes/index.tsx": "export default () => null;\n",
    });
    expect(res.status).toBe(0);
  });

  it("counts the node:test tree scripts/docs-conformance/ as source", () => {
    const res = guardOverChange({ "scripts/docs-conformance/validators/x.mjs": "export {};\n" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("scripts/docs-conformance/validators/x.mjs");
  });

  it("exempts docs-conformance/config.mjs — reviewable policy DATA (ADR-0041)", () => {
    const res = guardOverChange({ "scripts/docs-conformance/config.mjs": "export default {};\n" });
    expect(res.status).toBe(0);
  });

  it("ignores type declaration files", () => {
    const res = guardOverChange({ "packages/domain/src/globals.d.ts": "declare const x: 1;\n" });
    expect(res.status).toBe(0);
  });

  it("ignores a pure rename — a move is not new behavior", () => {
    const dir = initRepo();
    const base = commit(dir, { "packages/domain/src/report.ts": "export const a = 1;\n" }, "base");
    git(dir, "mv", "packages/domain/src/report.ts", "packages/domain/src/moved.ts");
    git(dir, "commit", "-q", "-m", "move");
    const head = git(dir, "rev-parse", "HEAD");
    expect(runGuard(dir, [base, head]).status).toBe(0);
  });

  it("passes an empty range", () => {
    const dir = initRepo();
    const head = git(dir, "rev-parse", "HEAD");
    expect(runGuard(dir, [head, head]).status).toBe(0);
  });

  it("labels the failure and prints the caller's remediation hint", () => {
    const dir = initRepo();
    const base = commit(dir, { "README.md": "base\n" }, "base");
    const head = commit(dir, { "packages/domain/src/report.ts": "export const a = 1;\n" });
    const res = runGuard(dir, [base, head, "--label", "pre-push", "--hint", "Bypass with FOO=1."]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("x pre-push: source changes with no test changes");
    expect(res.stderr).toContain("Bypass with FOO=1.");
  });
});
