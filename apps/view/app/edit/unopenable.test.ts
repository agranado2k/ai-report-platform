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
  it("carries the route's owner fallback into the read-only link", () => {
    const { unopenable } = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      // Exactly what degradeTargetFor returns for a served editor whose
      // gate verified an `oa` (query or arp_edit_oa cookie).
      readOnlyHref: "/abcdefghij?access=owner.token.value",
    });
    expect(unopenable.readOnlyHref).toBe("/abcdefghij?access=owner.token.value");
  });

  it("leaves the link bare for a write-grantee, who never has an owner fallback", () => {
    // `ownerOpenLocation` deliberately never mints an `oa` for a grantee, so
    // the gate's degrade target is the bare viewer — which is CORRECT for
    // them: they reach `/unlock/{slug}`, which recognises write access.
    const { unopenable } = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij",
    });
    expect(unopenable.readOnlyHref).toBe("/abcdefghij");
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
    expect(unopenable.readOnlyHref).toBe("/abcdefghij");
  });

  // The payload is serialized into the page. It must carry no EDIT capability:
  // the edit token is exactly what the editor render hands the client, and this
  // page is the branch where the editor did NOT render. The read-only owner
  // fallback in `readOnlyHref` is the ONE token this page may carry, and only
  // because the route already verified it and the user already holds it (it
  // arrived on their own request, in the query or the arp_edit_oa cookie).
  it("carries no capability at all when the route has no owner fallback", () => {
    const payload = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij",
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|access=|et=|oa=/i);
  });

  it("carries the read-only fallback and nothing else when it has one", () => {
    const payload = unopenableDocument({
      reason: "document-unsplittable",
      slug: "abcdefghij",
      docTitle: "T",
      readOnlyHref: "/abcdefghij?access=owner.token.value",
    });
    // The ONLY occurrence of a token anywhere in the payload is the one inside
    // the read-only href — nothing re-exports it as a separate field a client
    // script could read off more conveniently, and no edit token appears.
    const { readOnlyHref, ...rest } = payload.unopenable;
    expect(JSON.stringify({ ...payload, unopenable: rest })).not.toMatch(/token|access=|et=|oa=/i);
    expect(readOnlyHref).toContain("?access=");
  });
});
