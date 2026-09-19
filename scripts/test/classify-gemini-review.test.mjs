// Self-tests for scripts/classify-gemini-review.sh — the failure-classification
// logic behind the Gemini `review` check (ADR-030, issue #371).
//
// The bug this guards against: `continue-on-error: true` masked a failed Gemini
// step so the `review` check stayed GREEN even though no review ran (429 daily
// quota, missing auth, or the CLI absent). This script is the pure decision
// function — given the step OUTCOME and the step's error text, it decides
// whether a review actually ran, classifies the reason if not, writes a job
// summary, and exits non-zero so the check goes RED rather than a false green.
//
// Same dependency-free node:test tier as scripts/test/behavior-delta.test.mjs.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(fileURLToPath(import.meta.url), "../../classify-gemini-review.sh");

/**
 * Run the classifier with the given step outcome and error text.
 * Returns { code, token, summary } — the exit code, the stdout classification
 * token (trimmed), and the contents written to $GITHUB_STEP_SUMMARY.
 */
function run(outcome, errorText) {
  const dir = mkdtempSync(join(tmpdir(), "classify-gemini-"));
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
  const r = run("success", "Posted 3 review comments on the pull request.\n");
  assert.equal(r.token, "RAN");
  assert.equal(r.code, 0);
  assert.match(r.summary, /Gemini/i);
  assert.match(r.summary, /ran|review posted|completed/i);
});

test("the real production green path — success outcome with no error output — is RAN, exit 0", () => {
  // The live happy path posts nothing on stderr: `steps.gemini.outputs.error`
  // is empty, so the classifier reads empty stdin. Guards against a regression
  // where empty stdin under `set -eu` (the `err=$(cat || true)` read) trips the
  // script into a non-RAN token or a non-zero exit.
  const r = run("success", "");
  assert.equal(r.token, "RAN");
  assert.equal(r.code, 0);
});

test("429 daily-quota exhaustion is RED and classified as QUOTA", () => {
  const err =
    "ApiError: TerminalQuotaError: You have exhausted your daily quota on this model. [429]\n";
  const r = run("failure", err);
  assert.equal(r.token, "QUOTA");
  assert.equal(r.code, 1);
  assert.match(r.summary, /quota/i);
  // quota must be DISTINGUISHABLE from auth in the summary
  assert.doesNotMatch(r.summary, /authentication method|missing auth/i);
});

test("missing authentication is RED and classified as AUTH", () => {
  const r = run("failure", "Error: No authentication method provided.\n");
  assert.equal(r.token, "AUTH");
  assert.equal(r.code, 1);
  assert.match(r.summary, /auth/i);
  // auth must be DISTINGUISHABLE from quota in the summary
  assert.doesNotMatch(r.summary, /quota/i);
});

test("an invalid API key is classified as AUTH", () => {
  const r = run("failure", "GaxiosError: API key not valid. Please pass a valid API key. [400]\n");
  assert.equal(r.token, "AUTH");
  assert.equal(r.code, 1);
});

test("the CLI missing from PATH is RED and classified as MISSING_CLI", () => {
  const r = run("failure", "Gemini CLI not found in PATH\n");
  assert.equal(r.token, "MISSING_CLI");
  assert.equal(r.code, 1);
  assert.match(r.summary, /cli/i);
});

test("a transient upstream outage is RED and classified as TRANSIENT", () => {
  const r = run("failure", "ApiError: [503] The service is currently unavailable. UNAVAILABLE\n");
  assert.equal(r.token, "TRANSIENT");
  assert.equal(r.code, 1);
  assert.match(r.summary, /transient|temporar|re-run|retry/i);
});

test("a failed step with an unrecognized reason is RED and UNKNOWN, never green", () => {
  const r = run("failure", "Something entirely unexpected went wrong.\n");
  assert.equal(r.token, "UNKNOWN");
  assert.equal(r.code, 1);
});

test("a step that exited 0 but logged a quota error is still RED (belt and suspenders)", () => {
  // Guards the re-run case in the ticket: the action swallows the error and
  // exits 0, yet no review was posted. Error markers win over a success outcome.
  const r = run("success", "TerminalQuotaError: You have exhausted your daily quota. [429]\n");
  assert.equal(r.token, "QUOTA");
  assert.equal(r.code, 1);
});

test("a missing outcome argument is treated as a non-success failure", () => {
  const r = run("", "");
  assert.equal(r.code, 1);
  assert.equal(r.token, "UNKNOWN");
});
