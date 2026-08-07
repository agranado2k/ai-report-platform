// Unit coverage for the CI skip guard (tests/e2e/support/skip-guard.ts).
//
// THE FAILURE IT EXISTS TO STOP. `editor-auth.steps.ts` carries seven
// `test.skip(...)` guards keyed on `PLAYWRIGHT_VIEW_BASE_URL` and
// `E2E_SCAN_DRAIN_SECRET`. Locally, where neither is set, skipping is correct —
// there is no preview to follow to. In CI those two variables are the ONLY
// thing standing between "the cross-origin owner-open hand-off is exercised"
// and "it is not", and if one of them ever arrives empty — a renamed workflow
// output, a job that forgot `secrets: inherit` — the scenario skips, the run
// reports green, and precisely the coverage that caught two production
// incidents is gone with no signal at all.
//
// The verdict is a pure function over "what ran" so every branch is pinned
// here, in the fast gate, rather than discovered on a preview.
import { describe, expect, it } from "vitest";
import {
  SKIP_ALLOW_ANNOTATION,
  SKIP_ALLOW_TAG,
  type SkipGuardTest,
  skipGuardVerdict,
} from "./skip-guard";

function aTest(overrides: Partial<SkipGuardTest> = {}): SkipGuardTest {
  return {
    titlePath: ["chromium", "editor-auth.feature", "Opening the report"],
    tags: ["@smoke", "@auth"],
    annotations: [],
    outcome: "expected",
    ...overrides,
  };
}

describe("skipGuardVerdict", () => {
  it("stays silent outside CI, so a local `pnpm e2e` with no creds is still clean", () => {
    const verdict = skipGuardVerdict([aTest({ outcome: "skipped" })], false);

    expect(verdict.failed).toBe(false);
    expect(verdict.message).toBeNull();
  });

  it("passes in CI when everything that was collected actually ran", () => {
    const verdict = skipGuardVerdict([aTest(), aTest({ outcome: "flaky" })], true);

    expect(verdict.failed).toBe(false);
  });

  it("FAILS in CI on a skipped scenario, naming it and what it was", () => {
    const verdict = skipGuardVerdict(
      [
        aTest(),
        aTest({
          titlePath: ["chromium-auth", "editor-auth.feature", "Opening the report"],
          outcome: "skipped",
        }),
      ],
      true,
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain("chromium-auth › editor-auth.feature › Opening the report");
    expect(verdict.message).toContain(SKIP_ALLOW_TAG);
  });

  it("names EVERY skipped scenario, not just the first", () => {
    const verdict = skipGuardVerdict(
      [
        aTest({ titlePath: ["p", "one"], outcome: "skipped" }),
        aTest({ titlePath: ["p", "two"], outcome: "skipped" }),
      ],
      true,
    );

    expect(verdict.message).toContain("p › one");
    expect(verdict.message).toContain("p › two");
  });

  it("allows a skip a scenario opted into with the allowlist TAG", () => {
    const verdict = skipGuardVerdict(
      [aTest({ tags: ["@smoke", SKIP_ALLOW_TAG], outcome: "skipped" })],
      true,
    );

    expect(verdict.failed).toBe(false);
  });

  it("allows a skip a non-BDD spec opted into with the allowlist ANNOTATION", () => {
    // The `setup` project's clerk-auth.setup.ts is a plain @playwright/test
    // spec with no Gherkin tags at all, so annotations are its only way in.
    const verdict = skipGuardVerdict(
      [
        aTest({
          tags: [],
          annotations: [{ type: SKIP_ALLOW_ANNOTATION, description: "no creds configured" }],
          outcome: "skipped",
        }),
      ],
      true,
    );

    expect(verdict.failed).toBe(false);
  });

  it("still fails on an UNannotated skip sitting next to an allowlisted one", () => {
    const verdict = skipGuardVerdict(
      [
        aTest({ titlePath: ["p", "allowed"], tags: [SKIP_ALLOW_TAG], outcome: "skipped" }),
        aTest({ titlePath: ["p", "silent"], outcome: "skipped" }),
      ],
      true,
    );

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain("p › silent");
    expect(verdict.message).not.toContain("p › allowed");
  });

  it("FAILS in CI when the run collected nothing at all", () => {
    // The ultimate silent skip: a grep/grepInvert combination (or a missing
    // credential that widens `grepInvert`) that excludes the entire suite
    // reports a green run over zero coverage. No test is ever "skipped" in that
    // shape, so the per-test rule above cannot see it.
    const verdict = skipGuardVerdict([], true);

    expect(verdict.failed).toBe(true);
    expect(verdict.message).toContain("zero tests");
  });

  it("is silent about an empty run outside CI", () => {
    expect(skipGuardVerdict([], false).failed).toBe(false);
  });
});
