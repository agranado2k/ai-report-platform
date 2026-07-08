// Unit tests for the diff-mode decision extracted out of
// reports.$slug.diff.tsx (PR #156 review, Fix 2): a truncated/non-conforming
// _source.json sidecar must degrade to the labeled HTML fallback, not throw
// and 500 the whole page. The route itself isn't unit-tested (no route-level
// test convention in this repo — see the extracted-helper pattern in
// open-report.server.test.ts), so the branch decision is pulled out into this
// pure, synchronous helper instead.

import { STRUCTURAL_DIFF_UNAVAILABLE_LABEL } from "arp-report-html";
import { describe, expect, it } from "vitest";
import { computeReportDiff } from "./report-diff.server";

const encode = (s: string) => new TextEncoder().encode(s);

const OLD_DOC_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "The quick brown fox jumps." }] }],
});
const NEW_DOC_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "The quick brown fox leaps." }] }],
});

describe("computeReportDiff (PR #156 review, Fix 2 — corrupt sidecar degrades, not 500s)", () => {
  it("renders the structural diff when both sidecars parse and conform to the schema", () => {
    const result = computeReportDiff({
      fromBodyHtml: "<p>a</p>",
      toBodyHtml: "<p>b</p>",
      fromSidecarBytes: encode(OLD_DOC_JSON),
      toSidecarBytes: encode(NEW_DOC_JSON),
    });
    expect(result.mode).toBe("structural");
    expect(result.label).toBeNull();
    expect(result.html).toContain("leaps");
  });

  it("falls back to the labeled HTML diff when either sidecar is missing", () => {
    const result = computeReportDiff({
      fromBodyHtml: "<p>a</p>",
      toBodyHtml: "<p>b</p>",
      fromSidecarBytes: null,
      toSidecarBytes: encode(NEW_DOC_JSON),
    });
    expect(result.mode).toBe("fallback");
    expect(result.label).toBe(STRUCTURAL_DIFF_UNAVAILABLE_LABEL);
  });

  it("degrades to the fallback (not a 500) when a sidecar is truncated JSON", () => {
    const truncated = OLD_DOC_JSON.slice(0, -5); // snip the closing braces — invalid JSON
    const result = computeReportDiff({
      fromBodyHtml: "<p>a</p>",
      toBodyHtml: "<p>b</p>",
      fromSidecarBytes: encode(truncated),
      toSidecarBytes: encode(NEW_DOC_JSON),
    });
    expect(result.mode).toBe("fallback");
    expect(result.label).toBe(STRUCTURAL_DIFF_UNAVAILABLE_LABEL);
    expect(result.html).toBeTruthy();
  });

  it("degrades to the fallback when a sidecar is valid JSON but doesn't conform to reportSchema", () => {
    const nonConforming = JSON.stringify({ type: "doc", content: [{ type: "notARealNode" }] });
    const result = computeReportDiff({
      fromBodyHtml: "<p>a</p>",
      toBodyHtml: "<p>b</p>",
      fromSidecarBytes: encode(nonConforming),
      toSidecarBytes: encode(NEW_DOC_JSON),
    });
    expect(result.mode).toBe("fallback");
    expect(result.label).toBe(STRUCTURAL_DIFF_UNAVAILABLE_LABEL);
  });

  it("degrades to the fallback when both sidecars are missing", () => {
    const result = computeReportDiff({
      fromBodyHtml: "<p>a</p>",
      toBodyHtml: "<p>b</p>",
      fromSidecarBytes: null,
      toSidecarBytes: null,
    });
    expect(result.mode).toBe("fallback");
  });
});
