import { describe, expect, it } from "vitest";
import type { DocumentDegradeReason } from "./load-document";
import { UNOPENABLE_EXPLANATION, UNOPENABLE_STATUS, unopenableDocument } from "./unopenable";

const REASONS: readonly DocumentDegradeReason[] = [
  "document-unreadable",
  "document-unsplittable",
  "document-unparsable",
];

describe("the /edit unopenable-document page", () => {
  // THE POINT OF THE WHOLE THING. A document failure fires AFTER the gate has
  // returned `serve` against a valid `arp_edit` cookie — the capability is
  // already proven. Redirecting to `/{slug}` from there hands a private
  // report's OWNER to the public viewer, which unlock-walls them: the
  // 2026-08-06 lockout. A rendered page has no `Location`, so that route to the
  // unlock wall does not exist at all — it is not "guarded against", it is
  // structurally absent.
  it("is a rendered page, never a redirect", () => {
    // Explicitly OUTSIDE the 3xx range — a redirect is the failure mode being
    // removed — and a 4xx rather than a 200, so monitoring can't read "the
    // editor opened" off a page that says it didn't.
    expect(UNOPENABLE_STATUS).toBeGreaterThanOrEqual(400);
    expect(UNOPENABLE_STATUS).toBeLessThan(500);
  });

  it.each(REASONS)("names %s in its own words, without leaking internals", (reason) => {
    const copy = UNOPENABLE_EXPLANATION[reason];
    expect(copy.length).toBeGreaterThan(0);
    // The reason CODE is a log field, not user copy — the page explains the
    // situation in plain language and never echoes the enum, a file path, a
    // blob key or a stack.
    expect(copy).not.toContain(reason);
    expect(copy).not.toMatch(/parseBody|splitShell|blob|prosemirror/i);
  });

  it("gives each reason DISTINCT copy — otherwise it explains nothing", () => {
    const distinct = new Set(REASONS.map((r) => UNOPENABLE_EXPLANATION[r]));
    expect(distinct.size).toBe(REASONS.length);
  });

  it("offers the read-only view of THIS report and nothing else", () => {
    const payload = unopenableDocument({
      reason: "document-unparsable",
      slug: "abcdefghij",
      docTitle: "Q3 report",
    });
    expect(payload.unopenable.readOnlyHref).toBe("/abcdefghij");
    expect(payload.docTitle).toBe("Q3 report");
    expect(payload.unopenable.reason).toBe("document-unparsable");
    expect(payload.unopenable.explanation).toBe(UNOPENABLE_EXPLANATION["document-unparsable"]);
  });

  // The read-only link is same-origin and built from the report's OWN slug, so
  // it cannot become an open redirect — but the slug arrives as a string on the
  // loader's `report.slug`, so pin the shape rather than assume it.
  it("never builds an absolute or protocol-relative read-only link", () => {
    const { unopenable } = unopenableDocument({
      reason: "document-unreadable",
      slug: "abcdefghij",
      docTitle: "T",
    });
    expect(unopenable.readOnlyHref.startsWith("/")).toBe(true);
    expect(unopenable.readOnlyHref.startsWith("//")).toBe(false);
  });

  // The payload is serialized into the page. It must carry NO capability: the
  // edit token is exactly what the editor render hands the client, and this
  // page is the branch where the editor did NOT render.
  it("carries no edit token and no capability of any kind", () => {
    const payload = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|access=|et=|oa=/i);
  });
});
