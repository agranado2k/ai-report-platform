// THE MECHANICAL HALF OF ADR-0079's FIXTURE RULE — "a fixture may be smaller
// than a real report, never different IN KIND".
//
// That rule was written as prose and violated by the very commit that wrote
// it: `packages/report-html/src/fixtures/ai-readiness-report.html` (a verbatim
// generated report) styles `section { scroll-margin-top: 1rem }` and ships a
// `position: sticky; overflow-y: auto` sidebar, and the browser harness's
// fixture carried neither — so the browser tier was asserting a landing
// position production does not produce. Three rounds of anchor-scroll fixes
// have now been argued on top of a harness that differed from production in
// ways nobody had enumerated; prose is evidently not enough.
//
// So this test enumerates them. It scans the real report for every
// SCROLL-RELEVANT declaration and asserts each one is present in the harness's
// smooth fixture. It is deliberately a node-tier test rather than a browser
// one: it is a property of two files, needs no browser, and should fail in the
// fast gate.
//
// WHAT IT DOES NOT CLAIM. Presence of a declaration is not proof the harness
// reproduces production — the selectors, the DOM shape and the content lengths
// still differ, and a text scan cannot see any of that. It closes exactly one
// hole: a scroll-affecting rule that exists in a real report and is simply
// absent from the fixture.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const REAL_REPORT = join(
  repoRoot,
  "packages",
  "report-html",
  "src",
  "fixtures",
  "ai-readiness-report.html",
);
const HARNESS_FIXTURE = join(here, "report.html");

/** The properties whose presence changes where a programmatic scroll LANDS, or
 *  which box does the scrolling at all. `overflow-anchor` is here because
 *  prosemirror-view gates its scroll-position-restoring path on
 *  `view.dom.style.overflowAnchor` — an inline value on the editable root
 *  would switch that path on. */
const SCROLL_RELEVANT = /^(scroll-behavior|scroll-margin|scroll-padding|overflow|position)$/;

/** Every `<style>` block's text, concatenated. */
function styleText(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "").join("\n");
}

/**
 * Every scroll-relevant declaration in a stylesheet, normalized to
 * `property: value`.
 *
 * `position` is filtered down to `sticky`/`fixed`: those two are the values
 * that make `scrollRectIntoView` STOP walking up the ancestor chain
 * (prosemirror-view 1.42.0), and `position: relative` on a hundred selectors
 * would drown the signal without changing any scroll.
 */
function scrollDeclarations(css: string): readonly string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/gi)) {
    const property = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const base = property.replace(/^(scroll-margin|scroll-padding|overflow)-.*$/, "$1");
    if (!SCROLL_RELEVANT.test(base)) continue;
    if (property === "position" && !/^(sticky|fixed)$/.test(value)) continue;
    found.add(`${property}: ${value}`);
  }
  return [...found].sort();
}

describe("browser-harness fixture fidelity (ADR-0079)", () => {
  const realDeclarations = scrollDeclarations(styleText(readFileSync(REAL_REPORT, "utf8")));
  const harnessCss = styleText(readFileSync(HARNESS_FIXTURE, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();

  // A guard over an empty list is a guard over nothing. If the real report
  // ever stops carrying scroll-affecting CSS, this test must fail loudly
  // rather than pass vacuously.
  it("finds scroll-relevant CSS in the real report at all", () => {
    expect(realDeclarations.length).toBeGreaterThan(0);
  });

  it.each(realDeclarations)("the harness fixture also declares `%s`", (declaration) => {
    expect(harnessCss).toContain(declaration.replace(/\s+/g, " "));
  });
});
