// A Playwright reporter that turns a SILENT SKIP in CI into a failed job.
//
// SILENCE IS NOT SUCCESS. The smoke suite guards its most valuable scenarios
// behind `test.skip(!process.env.X, …)` — `PLAYWRIGHT_VIEW_BASE_URL` for the
// cross-origin owner-open hand-off, `E2E_SCAN_DRAIN_SECRET` for the scan drain
// that makes a preview's upload servable at all. Those guards are RIGHT
// locally: on a dev box there is no preview to follow to, and a suite that
// exploded there would just get run less. In CI they are the opposite. Both
// variables are produced by `preview-isolation.yml` and threaded through
// `e2e.yml`; if either ever arrives empty — a renamed job output, a `secrets:`
// block that stopped inheriting, a workflow input quietly dropped — the
// scenario skips, the job reports GREEN, and the coverage that exists
// specifically because two production incidents shipped through that hop is
// gone with no signal whatsoever.
//
// So: in CI, a skipped test fails the run unless it says, in the feature file
// or in its own annotations, that skipping is a deliberate part of its
// contract.
//
// HOW TO ALLOWLIST A SKIP. Tag the scenario `@allow-skip` in its `.feature`
// (the tag is in docs-conformance's `featureTags.extra` vocabulary, so it is a
// reviewed decision, not a stray string), or — for a plain `@playwright/test`
// spec with no Gherkin tags, like the `setup` project — push an annotation:
//
//     test.info().annotations.push({ type: "allow-skip", description: "why" });
//
// Both are documented in tests/e2e/README.md. Prefer neither: a scenario that
// legitimately cannot run in CI is usually a scenario whose precondition should
// be fixed.
//
// The verdict itself is a pure function so `skip-guard.test.ts` can pin every
// branch in the fast node-tier gate; the reporter is the thin adapter over it.
import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

/** Gherkin tag that opts a scenario out of the guard. */
export const SKIP_ALLOW_TAG = "@allow-skip";

/** Annotation `type` that opts a non-BDD spec out of the guard. */
export const SKIP_ALLOW_ANNOTATION = "allow-skip";

/** The shape the verdict reasons over — a `TestCase` reduced to what matters. */
export type SkipGuardTest = {
  readonly titlePath: readonly string[];
  readonly tags: readonly string[];
  readonly annotations: readonly { readonly type: string; readonly description?: string }[];
  readonly outcome: "skipped" | "expected" | "unexpected" | "flaky";
};

export type SkipGuardVerdict = {
  readonly failed: boolean;
  /** Human-readable reason, or null when there is nothing to say. */
  readonly message: string | null;
};

function isSkipAllowed(test: SkipGuardTest): boolean {
  return (
    test.tags.includes(SKIP_ALLOW_TAG) ||
    test.annotations.some((a) => a.type === SKIP_ALLOW_ANNOTATION)
  );
}

/**
 * Decide whether this run's skips should fail the job.
 *
 * Outside CI: never. A dev box legitimately lacks the credentials and the
 * preview URLs, and the skips are how the suite stays runnable there.
 *
 * In CI: any skip that did not opt in fails, and so does a run that collected
 * nothing at all — the latter because a grep/grepInvert combination wide enough
 * to exclude the whole suite produces zero skipped tests and a green run over
 * zero coverage, which the per-test rule cannot see.
 */
export function skipGuardVerdict(tests: readonly SkipGuardTest[], isCI: boolean): SkipGuardVerdict {
  if (!isCI) return { failed: false, message: null };

  if (tests.length === 0) {
    return {
      failed: true,
      message:
        "skip guard: this CI run collected zero tests. A green run over no coverage is the loudest silent skip there is — check `grep`/`grepInvert` in playwright.config.ts and the credentials they key on.",
    };
  }

  const silent = tests.filter((t) => t.outcome === "skipped" && !isSkipAllowed(t));
  if (silent.length === 0) return { failed: false, message: null };

  const listed = silent.map((t) => `  ✗ ${t.titlePath.join(" › ")}`).join("\n");
  return {
    failed: true,
    message: [
      `skip guard: ${silent.length} scenario(s) SKIPPED in CI. In CI a skip is missing coverage, not a pass:`,
      listed,
      "",
      "A `test.skip(!process.env.X, …)` guard that fires in CI means X did not reach the runner — check that preview-isolation.yml still produces it and e2e.yml still threads it through.",
      `If skipping really is part of the scenario's contract, tag it ${SKIP_ALLOW_TAG} in its .feature (or push an { type: "${SKIP_ALLOW_ANNOTATION}" } annotation from a non-BDD spec) and say why.`,
    ].join("\n"),
  };
}

/** Reduce Playwright's `TestCase` to the shape the verdict reasons over. */
function toGuardTest(test: TestCase): SkipGuardTest {
  return {
    titlePath: test.titlePath().filter((part) => part !== ""),
    tags: test.tags,
    annotations: test.annotations,
    outcome: test.outcome(),
  };
}

/**
 * The reporter. Registered in `playwright.config.ts` for every run; it only
 * ever acts when `process.env.CI` is set, so a local run is untouched.
 */
export default class NoSilentSkipReporter implements Reporter {
  private rootSuite: Suite | undefined;

  onBegin(_config: unknown, suite: Suite): void {
    this.rootSuite = suite;
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] } | undefined> {
    const tests = (this.rootSuite?.allTests() ?? []).map(toGuardTest);
    const verdict = skipGuardVerdict(tests, Boolean(process.env.CI));
    if (!verdict.failed) return undefined;

    // `::error::` so GitHub surfaces it as an annotation on the job, next to
    // whatever the `github` reporter already wrote.
    process.stderr.write(`\n::error::${verdict.message?.split("\n")[0] ?? "skip guard failed"}\n`);
    process.stderr.write(`${verdict.message}\n\n`);
    // Never downgrade a run that already failed for a better reason.
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
