// Self-tests for scripts/classify-claude-review.sh — the failure-classification
// logic behind the Claude `claude-review` check (ADR-030, issue #388).
//
// The bug this guards against is the SAME false-green #371 fixed for Gemini:
// `claude-code-review.yml` runs the review step under `continue-on-error: true`,
// which masks a failed Claude step so the `claude-review` check stayed GREEN even
// though no review ran — an Anthropic API rate limit (429), a missing/invalid
// CLAUDE_CODE_OAUTH_TOKEN (401), an overloaded upstream (529), or the action
// failing to run at all. This script is the pure decision function — given the
// step OUTCOME and the step's error text, it decides whether a review actually
// ran, classifies the reason if not, writes a job summary, and exits non-zero so
// the check goes RED rather than a false green.
//
// classify-claude-review.sh is a thin vendor shim over the shared classifier
// (scripts/classify-ai-review.sh, REVIEW_VENDOR=Claude); these tests exercise it
// end-to-end so a regression in either the shim or the shared core is caught.
//
// Same dependency-free node:test tier as scripts/test/behavior-delta.test.mjs.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(fileURLToPath(import.meta.url), "../../classify-claude-review.sh");

/**
 * Run the classifier with the given step outcome and error text.
 * Returns { code, token, summary } — the exit code, the stdout classification
 * token (trimmed), and the contents written to $GITHUB_STEP_SUMMARY.
 */
function run(outcome, errorText) {
  const dir = mkdtempSync(join(tmpdir(), "classify-claude-"));
  const summaryPath = join(dir, "summary.md");
  // create the summary file so the script appends to it, like Actions does
  execFileSync("sh", ["-c", `: > "${summaryPath}"`]);
  let code = 0;
  let token = "";
  try {
    token = execFileSync("sh", [SCRIPT, outcome], {
      input: errorText ?? "",
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    });
  } catch (e) {
    code = e.status ?? 1;
    token = (e.stdout ?? "").toString();
  }
  const summary = readFileSync(summaryPath, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { code, token: token.trim(), summary };
}

test("a successful step with a real review is green (RAN, exit 0)", () => {
  const r = run("success", "Posted a PR review with 4 inline comments.\n");
  assert.equal(r.token, "RAN");
  assert.equal(r.code, 0);
  assert.match(r.summary, /Claude/i);
  assert.match(r.summary, /ran|review posted|completed/i);
});

test("the real production green path — success outcome with no error output — is RAN, exit 0", () => {
  // The happy path may surface nothing on the error channel, so the classifier
  // reads empty stdin. Guards against a regression where empty stdin under
  // `set -eu` trips the script into a non-RAN token or a non-zero exit.
  const r = run("success", "");
  assert.equal(r.token, "RAN");
  assert.equal(r.code, 0);
});

test("an Anthropic 429 rate limit is RED and classified as QUOTA", () => {
  const err =
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your rate limit"}}\n';
  const r = run("failure", err);
  assert.equal(r.token, "QUOTA");
  assert.equal(r.code, 1);
  assert.match(r.summary, /quota|rate limit/i);
  // quota must be DISTINGUISHABLE from auth in the summary
  assert.doesNotMatch(r.summary, /authentication|invalid token|oauth/i);
});

test("a usage-limit / credit-exhaustion message is classified as QUOTA", () => {
  const r = run("failure", "Claude Code: Credit balance is too low to access the Anthropic API.\n");
  assert.equal(r.token, "QUOTA");
  assert.equal(r.code, 1);
});

test("a missing OAuth token is RED and classified as AUTH", () => {
  const r = run("failure", "Error: CLAUDE_CODE_OAUTH_TOKEN is required but was not provided.\n");
  assert.equal(r.token, "AUTH");
  assert.equal(r.code, 1);
  assert.match(r.summary, /auth/i);
  // auth must be DISTINGUISHABLE from quota in the summary
  assert.doesNotMatch(r.summary, /quota|rate limit/i);
});

test("an Anthropic 401 authentication_error is classified as AUTH", () => {
  const r = run(
    "failure",
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}\n',
  );
  assert.equal(r.token, "AUTH");
  assert.equal(r.code, 1);
});

test("an expired/invalid OAuth token is classified as AUTH", () => {
  const r = run("failure", "OAuth token expired or invalid. Please re-authenticate.\n");
  assert.equal(r.token, "AUTH");
  assert.equal(r.code, 1);
});

test("the action binary missing from the runner is RED and MISSING_CLI", () => {
  const r = run("failure", "claude: command not found\n");
  assert.equal(r.token, "MISSING_CLI");
  assert.equal(r.code, 1);
  assert.match(r.summary, /not found|install/i);
});

test("an Anthropic 529 overloaded is RED and classified as TRANSIENT", () => {
  const err =
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n';
  const r = run("failure", err);
  assert.equal(r.token, "TRANSIENT");
  assert.equal(r.code, 1);
  assert.match(r.summary, /transient|temporar|re-run|retry/i);
});

test("a 500 internal server error is classified as TRANSIENT", () => {
  const r = run(
    "failure",
    'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}\n',
  );
  assert.equal(r.token, "TRANSIENT");
  assert.equal(r.code, 1);
});

test("a failed step with an unrecognized reason is RED and UNKNOWN, never green", () => {
  const r = run("failure", "Something entirely unexpected went wrong.\n");
  assert.equal(r.token, "UNKNOWN");
  assert.equal(r.code, 1);
});

test("a step that exited 0 but logged a rate-limit error is still RED (belt and suspenders)", () => {
  // Guards the re-run/no-op case: the action swallows the error and exits 0, yet
  // no review was posted. Error markers win over a success outcome.
  const r = run(
    "success",
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"rate limit"}}\n',
  );
  assert.equal(r.token, "QUOTA");
  assert.equal(r.code, 1);
});

test("a missing outcome argument is treated as a non-success failure", () => {
  const r = run("", "");
  assert.equal(r.code, 1);
  assert.equal(r.token, "UNKNOWN");
});

test("the summary names the Claude vendor, not Gemini", () => {
  const r = run("failure", "Error: CLAUDE_CODE_OAUTH_TOKEN is required.\n");
  assert.match(r.summary, /Claude/i);
  assert.doesNotMatch(r.summary, /Gemini/i);
});
