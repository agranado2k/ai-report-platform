// Self-tests for the CI half of the ADR-0081 differential mutation diagnostic:
//   scripts/mutation-delta-ci.sh        — the label gate + the one-comment upsert
//   .github/workflows/mutation-delta.yml — the trigger shape that never spends
//                                          money on an unlabelled push
//
// The script is the seam. Both collaborators are stubbed and both stubs RECORD:
// `gh` (so the test can read exactly which endpoint was called with which body)
// and the sibling `scripts/mutation-delta.sh` (whose own git/Stryker behaviour
// is already pinned by scripts/test/mutation-delta.test.mjs — re-running it here
// would test that script twice and this one not at all). What is left is exactly
// this script's logic: does the label rule fire, and is there ever more than one
// comment.
//
// Same node:test tier as scripts/test/mutation-delta.test.mjs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// The one non-builtin here, and it is already a root devDependency (the same
// parser the repo's own tooling has available). Reading the trigger shape as a
// regex over YAML text could not express "and NO other trigger", which is the
// half of this ticket that keeps the workflow off every push.
import { parse } from "yaml";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const SCRIPT = resolve(HERE, "../mutation-delta-ci.sh");
const REPO = resolve(HERE, "../..");
const WORKFLOW = resolve(REPO, ".github/workflows/mutation-delta.yml");

/** What the real scripts/mutation-delta.sh prints — shape copied from a real run. */
const DELTA = `# Mutation delta — feat/acl vs origin/main (merge-base 1a2b3c4)

## Scope (1 changed domain source file(s) in packages/domain)
  src/acl.ts

## Score
  83.56% total · 85.71% covered — 61 killed, 0 timeout, 12 survived, 0 no-coverage

## Survivors (1)
  Survived  src/acl.ts:44:32  StringLiteral → ""
`;

/**
 * A pull_request event payload, as GitHub writes it to $GITHUB_EVENT_PATH.
 * `label` is the one just added (`labeled` action only); `labels` is what the
 * PR carries afterwards.
 */
function payload({ action, label, labels = [], number = 77, baseSha = "ba5e5ha" }) {
  return {
    action,
    number,
    ...(label ? { label: { name: label } } : {}),
    pull_request: {
      number,
      labels: labels.map((name) => ({ name })),
      base: { ref: "main", sha: baseSha },
    },
  };
}

function stub(dir, name, body) {
  const path = join(dir, "bin", name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/**
 * Run the script against a simulated event, with `gh` and the differential
 * script replaced by recording stubs. `comments` is what the PR's comment list
 * endpoint returns.
 */
function runCi({ event, comments = [], delta = DELTA, expectFailure = false }) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-delta-ci-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "calls"));

  copyFileSync(SCRIPT, join(dir, "scripts/mutation-delta-ci.sh"));
  writeFileSync(join(dir, "delta.out"), delta);
  writeFileSync(join(dir, "comments.json"), JSON.stringify(comments));
  writeFileSync(join(dir, "event.json"), JSON.stringify(event));

  // The sibling the script shells out to: records its arguments, prints the
  // canned summary on stdout exactly as the real one does.
  writeFileSync(
    join(dir, "scripts/mutation-delta.sh"),
    `#!/bin/sh\nroot=$(cd "$(dirname "$0")/.." && pwd)\nfor a in "$@"; do printf '%s\\n' "$a"; done > "$root/calls/delta.args"\ncat "$root/delta.out"\n`,
  );
  chmodSync(join(dir, "scripts/mutation-delta.sh"), 0o755);

  // `gh`: every invocation is appended to calls/ as its argv plus its stdin.
  // A request carrying --method is a write (create/update) and answers with an
  // id; anything else is the comment listing.
  stub(
    dir,
    "gh",
    `#!/bin/sh
root=$(cd "$(dirname "$0")/.." && pwd)
n=1
while [ -e "$root/calls/gh-$n.args" ]; do n=$((n + 1)); done
for a in "$@"; do printf '%s\\n' "$a"; done > "$root/calls/gh-$n.args"
cat > "$root/calls/gh-$n.stdin"
case " $* " in
*" --method "*) printf '{"id":424242}\\n' ;;
*) cat "$root/comments.json" ;;
esac
`,
  );

  const run = spawnSync("sh", [join(dir, "scripts/mutation-delta-ci.sh")], {
    cwd: dir,
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: join(dir, "event.json"),
      GITHUB_REPOSITORY: "agranado2k/ai-report-platform",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "1234",
    },
  });
  if (!expectFailure) assert.equal(run.status, 0, `the script failed:\n${run.stderr}`);

  const calls = readdirSync(join(dir, "calls"))
    .filter((f) => f.endsWith(".args") && f.startsWith("gh-"))
    .sort()
    .map((f) => ({
      args: readFileSync(join(dir, "calls", f), "utf8")
        .split("\n")
        .filter(Boolean),
      stdin: readFileSync(join(dir, "calls", f.replace(".args", ".stdin")), "utf8"),
    }));

  let deltaArgs = null;
  try {
    deltaArgs = readFileSync(join(dir, "calls/delta.args"), "utf8").split("\n").filter(Boolean);
  } catch {
    /* the differential run was never reached */
  }

  rmSync(dir, { recursive: true, force: true });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls, deltaArgs };
}

/** The write call, with its request body decoded. */
function writes(calls) {
  return calls
    .filter((c) => c.args.includes("--method"))
    .map((c) => ({
      method: c.args[c.args.indexOf("--method") + 1],
      endpoint: c.args.find((a) => a.startsWith("repos/")),
      body: JSON.parse(c.stdin).body,
    }));
}

const MARKER = "<!-- mutation-delta -->";

test("posts the mutation delta as a PR comment when the mutation-check label is added", () => {
  const { calls, deltaArgs } = runCi({
    event: payload({ action: "labeled", label: "mutation-check", labels: ["mutation-check"] }),
  });

  // Scoped to the PR's own changes: the base commit the PR forked from.
  assert.deepEqual(deltaArgs, ["ba5e5ha"]);

  const written = writes(calls);
  assert.equal(written.length, 1);
  assert.equal(written[0].method, "POST");
  assert.equal(written[0].endpoint, "repos/agranado2k/ai-report-platform/issues/77/comments");
  assert.ok(written[0].body.startsWith(MARKER), "the body must carry the find-by-marker marker");
  assert.match(written[0].body, /Survived {2}src\/acl\.ts:44:32/);
  assert.match(written[0].body, /83\.56% total/);
});

test("the comment says what it is, and how to stop it", () => {
  const { calls } = runCi({
    event: payload({ action: "labeled", label: "mutation-check", labels: ["mutation-check"] }),
  });

  const { body } = writes(calls)[0];
  // A reviewer who has never seen this comment before must not read a score of
  // 83.56% as a failed gate (ADR-0081 §1), and must be able to turn it off.
  assert.match(body, /never a gate/i);
  assert.match(body, /ADR-0081/);
  assert.match(body, /mutation-check/, "the label that produced it, so it can be removed");
});

test("re-reports on a push to a PR that already carries the label", () => {
  // The `synchronize` half of the trigger: a labelled PR that gets new commits
  // gets a fresh measurement, otherwise the comment describes a diff that has
  // moved on.
  const { calls, deltaArgs } = runCi({
    event: payload({ action: "synchronize", labels: ["mutation-check", "ready-for-agent"] }),
  });

  assert.deepEqual(deltaArgs, ["ba5e5ha"]);
  assert.equal(writes(calls).length, 1);
});

test("spends nothing on a push to a PR that is not labelled", () => {
  const { calls, deltaArgs } = runCi({
    event: payload({ action: "synchronize", labels: ["ready-for-agent"] }),
  });

  assert.equal(deltaArgs, null, "the Stryker run must not start without the label");
  assert.deepEqual(calls, [], "an unlabelled PR gets no comment at all");
});

test("edits its own earlier comment in place instead of posting a second one", () => {
  const { calls } = runCi({
    event: payload({ action: "synchronize", labels: ["mutation-check"] }),
    comments: [
      { id: 1, body: "Looks good to me." },
      { id: 2, body: `${MARKER}\n## 🧬 Mutation delta\n\n(a previous run)\n` },
    ],
  });

  const written = writes(calls);
  assert.equal(written.length, 1, "one comment per PR, forever");
  assert.equal(written[0].method, "PATCH");
  assert.equal(written[0].endpoint, "repos/agranado2k/ai-report-platform/issues/comments/2");
  assert.match(written[0].body, /83\.56% total/, "the edit carries the NEW measurement");
});

test("leaves other people's comments alone and posts its first one", () => {
  // Find-by-marker, not find-by-author: another bot's report and a human review
  // must not be mistaken for this workflow's comment and overwritten.
  const { calls } = runCi({
    event: payload({ action: "labeled", label: "mutation-check", labels: ["mutation-check"] }),
    comments: [
      { id: 11, body: "## 🧬 Mutation delta\n\nposted by hand, no marker" },
      { id: 12, body: "gemini-code-assist: a review" },
    ],
  });

  const written = writes(calls);
  assert.equal(written.length, 1);
  assert.equal(written[0].method, "POST");
});

test("spends nothing when the label added is a different one", () => {
  // A labelled PR keeps its label, so `labeled` fires again for every OTHER
  // label anyone adds. Re-measuring then would charge a mutation run to an
  // event that changed no code.
  const { calls, deltaArgs } = runCi({
    event: payload({
      action: "labeled",
      label: "ready-for-agent",
      labels: ["mutation-check", "ready-for-agent"],
    }),
  });

  assert.equal(deltaArgs, null);
  assert.deepEqual(calls, []);
});

test("fails loudly on an event payload that carries no pull request", () => {
  // A misconfigured trigger would otherwise reach the API with an empty PR
  // number and read as an ordinary 404 — the silent-no-op failure mode.
  const { status, stderr, calls, deltaArgs } = runCi({
    event: { action: "labeled", label: { name: "mutation-check" } },
    expectFailure: true,
  });

  assert.notEqual(status, 0);
  assert.match(stderr, /pull request/i);
  assert.equal(deltaArgs, null);
  assert.deepEqual(calls, []);
});

// --- The trigger shape: never per-push, never required -----------------------

const workflow = () => parse(readFileSync(WORKFLOW, "utf8"));

test("the workflow has exactly one trigger: a labelled or re-pushed pull request", () => {
  const wf = workflow();

  // The `on:` key, and no other. A `push:`, a `schedule:` or a bare
  // `pull_request` with the default types would put a Stryker run on work that
  // never asked for one — the cost ADR-0081 §1 refuses to pay.
  assert.deepEqual(Object.keys(wf.on), ["pull_request"]);
  assert.deepEqual(wf.on.pull_request.types, ["labeled", "synchronize"]);

  // `pull_request`, never `pull_request_target`: this job holds a
  // `pull-requests: write` token and runs code from the branch it is measuring.
  assert.ok(!("pull_request_target" in wf.on));
});

test("the job cannot start unless the mutation-check label is what brought it here", () => {
  const [job] = Object.values(workflow().jobs);
  const guard = job.if.replace(/\s+/g, " ");

  // The same two questions the script asks, in the one language that can stop a
  // runner from being allocated at all.
  assert.match(
    guard,
    /github\.event\.action == 'labeled' && github\.event\.label\.name == 'mutation-check'/,
  );
  assert.match(
    guard,
    /github\.event\.action != 'labeled' && contains\(github\.event\.pull_request\.labels\.\*\.name, 'mutation-check'\)/,
  );
});

test("the job holds only the permissions the one comment needs", () => {
  const wf = workflow();
  const [job] = Object.values(wf.jobs);

  assert.deepEqual(job.permissions, { contents: "read", "pull-requests": "write" });
});

test("the workflow calls the script rather than carrying the logic itself", () => {
  const [job] = Object.values(workflow().jobs);

  const checkout = job.steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout"));
  // mutation-delta.sh resolves a merge-base; a shallow clone has no such commit.
  assert.equal(checkout.with["fetch-depth"], 0);

  const run = job.steps
    .filter((s) => s.run)
    .map((s) => s.run)
    .join("\n");
  assert.match(run, /scripts\/mutation-delta-ci\.sh/);
  // No `gh api` and no comment-body assembly in the YAML: that logic lives in
  // the script, where these tests can reach it.
  assert.doesNotMatch(run, /gh api|gh pr comment/);
});

test("the mutation delta is not a required status check", () => {
  const [name, job] = Object.entries(workflow().jobs)[0];
  const terraform = readFileSync(resolve(REPO, "infra/terraform/envs/shared/main.tf"), "utf8");
  const required = terraform.slice(
    terraform.indexOf("required_status_checks = ["),
    terraform.indexOf("]", terraform.indexOf("required_status_checks = [")),
  );

  // ADR-0081 §1: a diagnostic, never a gate. Neither the job's display name nor
  // its key may appear in `main`'s protection contexts.
  assert.doesNotMatch(required, new RegExp(`"${job.name}"`));
  assert.doesNotMatch(required, new RegExp(`"${name}"`));
});
