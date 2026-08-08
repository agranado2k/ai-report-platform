import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The CI CALLER of the shared TDD pairing rule, as a seam:
// `scripts/tdd-pairing-guard-ci.sh` with BASE_SHA / HEAD_SHA / GITHUB_EVENT_PATH
// in the environment — exactly what `.github/workflows/tdd-pairing.yml` hands it.
//
// The caller exists so the two things CI adds on top of the rule — resolving the
// PR's MERGE-BASE range, and the `tdd-exempt` label escape hatch — are runnable
// and assertable off a GitHub runner. Without it they would live inline in YAML,
// where the only way to learn that the label path works is to open a PR and
// push at it. Here the label path is driven against a SIMULATED event payload:
// the same JSON shape GitHub writes to $GITHUB_EVENT_PATH.
//
// Repos are real and throwaway, with real commits and a real `git diff` (same
// stance as tdd-pairing-guard.test.ts): what is under test is a verdict about
// history, so faking the history would fake the test.

const GUARD_CI = fileURLToPath(new URL("./tdd-pairing-guard-ci.sh", import.meta.url));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** A fresh repo with one empty root commit, cleaned up after the test. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "tdd-pairing-guard-ci-"));
  dirs.push(dir);
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

/**
 * The `pull_request` event payload GitHub writes to $GITHUB_EVENT_PATH, reduced
 * to the one field this caller reads. Returns the path to write into the env.
 */
function eventPayload(dir: string, labels: string[], name = "event.json"): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({ pull_request: { number: 7, labels: labels.map((n) => ({ name: n })) } }),
  );
  return path;
}

function runGuardCi(dir: string, env: Record<string, string>) {
  const res = spawnSync("sh", [GUARD_CI], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, BASE_SHA: "", HEAD_SHA: "", GITHUB_EVENT_PATH: "", ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * A PR-shaped history: `main` forks, the PR branch commits `prFiles`, and then
 * `main` ADVANCES with `baseFiles`. That advance is what separates a merge-base
 * range from a plain base..head tree comparison.
 */
function prRepo(prFiles: Record<string, string>, baseFiles?: Record<string, string>) {
  const dir = initRepo();
  const fork = commit(dir, { "README.md": "fork\n" }, "fork point");
  git(dir, "checkout", "-q", "-b", "pr");
  const head = commit(dir, prFiles, "pr work");
  git(dir, "checkout", "-q", "main");
  const base = baseFiles ? commit(dir, baseFiles, "main moves on") : fork;
  return { dir, base, head };
}

describe("tdd-pairing-guard-ci.sh", () => {
  it("exits 2 with usage when the PR's base/head shas are not in the environment", () => {
    const dir = initRepo();
    const res = runGuardCi(dir, {});
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/BASE_SHA/);
  });

  it("exits 2 when the range cannot be resolved — a gate that cannot run is not green", () => {
    const { dir, head } = prRepo({ "docs/x.md": "x\n" });
    const res = runGuardCi(dir, {
      BASE_SHA: "0000000000000000000000000000000000000000",
      HEAD_SHA: head,
    });
    expect(res.status).toBe(2);
  });

  it("fails the PR whose source changes carry no test changes", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
    });
    const res = runGuardCi(dir, { BASE_SHA: base, HEAD_SHA: head });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("packages/domain/src/report.ts");
    expect(res.stderr).toContain("source changes with no test changes");
  });

  it("names the CI gate and the tdd-exempt label as the escape hatch in the failure", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
    });
    const res = runGuardCi(dir, { BASE_SHA: base, HEAD_SHA: head });
    expect(res.stderr).toContain("✗ ci:");
    expect(res.stderr).toContain("tdd-exempt");
  });

  it("passes the PR whose source changes are paired with a test change", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
      "packages/domain/src/report.test.ts": "test\n",
    });
    expect(runGuardCi(dir, { BASE_SHA: base, HEAD_SHA: head }).status).toBe(0);
  });

  it("judges the MERGE-BASE range — an unpaired commit on main is not the PR's fault", () => {
    // `main` advanced with an unpaired source change AFTER the fork. A plain
    // `git diff <main-head> <pr-head>` sees that file as modified (the PR's tree
    // still holds the fork version) and would fail a docs-only PR.
    const { dir, base, head } = prRepo(
      { "docs/diary.md": "log\n" },
      { "packages/domain/src/other.ts": "export const b = 2;\n" },
    );
    const res = runGuardCi(dir, { BASE_SHA: base, HEAD_SHA: head });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("other.ts");
  });

  it("goes green with a visible notice when the PR carries the tdd-exempt label", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
    });
    const res = runGuardCi(dir, {
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_EVENT_PATH: eventPayload(dir, ["ready-for-agent", "tdd-exempt"]),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("::notice");
    expect(res.stdout).toContain("tdd-exempt");
  });

  it("does not exempt a PR carrying only other labels", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
    });
    const res = runGuardCi(dir, {
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_EVENT_PATH: eventPayload(dir, ["ready-for-agent", "tdd-exempt-ish"]),
    });
    expect(res.status).toBe(1);
  });

  it("fails closed when the event payload is missing or unreadable", () => {
    const { dir, base, head } = prRepo({
      "packages/domain/src/report.ts": "export const a = 1;\n",
    });
    const absent = runGuardCi(dir, {
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_EVENT_PATH: join(dir, "no-such-event.json"),
    });
    expect(absent.status).toBe(1);

    const malformed = join(dir, "malformed.json");
    writeFileSync(malformed, "{ not json");
    const broken = runGuardCi(dir, {
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_EVENT_PATH: malformed,
    });
    expect(broken.status).toBe(1);
  });

  it("stays green on an exempt PR even when the range itself is fine", () => {
    const { dir, base, head } = prRepo({ "docs/diary.md": "log\n" });
    const res = runGuardCi(dir, {
      BASE_SHA: base,
      HEAD_SHA: head,
      GITHUB_EVENT_PATH: eventPayload(dir, ["tdd-exempt"]),
    });
    expect(res.status).toBe(0);
  });
});
