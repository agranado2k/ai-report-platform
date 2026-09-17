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
    // #363: the owner view, not the bare viewer. It is the read-only surface
    // now — chrome above the byte-for-byte report — and it reaches the content
    // for EVERY principal, which the bare link did not.
    expect(payload.unopenable.readOnlyHref).toBe("/abcdefghij/view");
    expect(payload.docTitle).toBe("Q3 report");
    expect(payload.unopenable.reason).toBe("document-unparsable");
    expect(payload.unopenable.explanation).toBe(UNOPENABLE_EXPLANATION["document-unparsable"]);
  });

  // ---------------------------------------------------------------------
  // THE LAST HOP OF THE 2026-08-06 LOCKOUT (measured in production on
  // f83ed59). The page above shipped with a BARE `/{slug}` link. For a
  // PRIVATE report that link cannot work: the public viewer sees private +
  // no token, redirects to `${appOrigin}/unlock/{slug}`, whose owner-aware
  // page offers `/reports/{slug}/open` → `/edit` → this same 409 page →
  // the same bare link. A user-driven cycle that never reaches the content:
  // the owner could read a clear explanation of why they can't EDIT their
  // report and still could not READ it.
  //
  // The route already holds the answer — `degradeTargetFor(decision, slug)`,
  // whose `to` is `/{slug}?access=<oa>` when the gate verified an owner
  // fallback (`acceptOwnerFallback`: HMAC + this slug + unexpired +
  // `owner === true`) and `/{slug}` when it did not. This page simply
  // CARRIES it. Nothing is minted here: the view origin stays
  // credential-free (ADR-0056 keystone — the app authorizes, the viewer
  // verifies), and an unverified `oa` never becomes a `degradeTo` in the
  // first place.
  // ---------------------------------------------------------------------
  // #363 SUPERSEDES THE MECHANISM, KEEPS THE PROPERTY. Phase 5-H fixed the
  // cycle by carrying the gate's VERIFIED `oa` into the href as `?access=`.
  // With owner-open flipped, the route points this link at the OWNER VIEW
  // instead, and the cycle closes a better way: `/{slug}/view` holds no
  // capability under that Path, so it funnels to the app's ONE mint, which
  // re-checks `canWrite` LIVE and hands back a fresh capability. The property
  // Phase 5-H bought — the one forward action actually reaches the content —
  // is preserved for BOTH principals, and two things improve.
  it("points the read-only link at the owner view, carrying NO token at all", () => {
    const { unopenable } = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij/view",
    });
    expect(unopenable.readOnlyHref).toBe("/abcdefghij/view");
    // The 409 page no longer emits a 24h `owner:true` token into an anchor.
    // Phase 5-H called that href "the ONE token this page may carry"; after
    // the flip it carries none, because the capability is re-minted by the app
    // rather than forwarded by this page.
    expect(unopenable.readOnlyHref).not.toMatch(/access=|token/i);
  });

  it("gives a write-grantee the SAME working link, not a lesser one", () => {
    // Before, a grantee got the bare `/{slug}` because `ownerOpenLocation`
    // never mints them an `oa`. Now they get the owner view like everyone
    // else, and ADR-0091's Grantee read token is what makes the report
    // actually render inside its frame rather than an unlock wall.
    const { unopenable } = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij/view",
    });
    expect(unopenable.readOnlyHref).toBe("/abcdefghij/view");
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

  // The href is now supplied by the caller, so the invariant this file's type
  // documents ("ALWAYS a root-relative path") has to be ENFORCED rather than
  // assumed. Today's only caller passes `degradeTargetFor`'s output, which is
  // built from a validated Slug — but a future caller passing anything else
  // must not be able to turn this anchor into an off-site jump.
  it.each([
    ["absolute", "https://evil.example/steal"],
    ["protocol-relative", "//evil.example/steal"],
    ["backslash-relative", "/\\evil.example/steal"],
    ["scheme-relative javascript", "javascript:alert(1)"],
    ["empty", ""],
  ])("falls back to this report's own path for a %s href", (_name, href) => {
    const { unopenable } = unopenableDocument({
      reason: "document-unreadable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: href,
    });
    expect(unopenable.readOnlyHref).toBe("/abcdefghij/view");
  });

  // The payload is serialized into the page. It must carry no EDIT capability:
  // the edit token is exactly what the editor render hands the client, and this
  // page is the branch where the editor did NOT render. The read-only owner
  // fallback in `readOnlyHref` is the ONE token this page may carry, and only
  // because the route already verified it and the user already holds it (it
  // arrived on their own request, in the query or the arp_edit_oa cookie).
  it("carries no capability at all — and since #363 that holds unconditionally", () => {
    // Stronger than it used to be. This assertion previously had a sibling
    // covering the case where the href DID carry a verified `oa`; after the
    // flip there is no such case, so the whole payload is capability-free on
    // every path through this page.
    const payload = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij/view",
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|access=|et=|oa=/i);
  });
});
