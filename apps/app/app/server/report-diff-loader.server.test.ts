// Unit tests for loadReportDiff (ADR-0063 API slice) — the server-layer
// helper behind GET /api/v1/reports/{slug}/diff?from=<version_id>&to=
// <version_id>. Exercises the load-by-version-id + auth + structural/
// fallback decision, AND the same end-to-end edit-token trust-boundary
// chain save-edited-version.server.test.ts proves (mint -> resolveEditTokenActor
// -> this helper), since the diff endpoint is edit-token-authenticatable too.

import type { UploadActor } from "arp-application";
import { uploadReport } from "arp-application";
import { makeAppTestHarness } from "arp-application/testing";
import { folderId, makeSlug, mintEditToken, ok, orgId, type Slug, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { resolveEditTokenActor } from "./edit-token-actor.server";
import { loadReportDiff } from "./report-diff-loader.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const OUTSIDER = userId("00000000-0000-7000-8000-0000000000d9");
const FOLDER = folderId("00000000-0000-7000-8000-0000000000f1");
const SECRET = "test-secret";
const NOW_SECONDS = 1_750_000_000;

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
}

const V1_HTML = "<html><head></head><body><p>hello world</p></body></html>";
const V2_HTML = "<html><head></head><body><p>hello there world</p></body></html>";
const V1_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
};
const V2_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello there world" }] }],
};

async function twoVersionHarness(opts: { withSidecars: boolean }) {
  const { deps, reports, bundles, blobs, grants, identities } = makeAppTestHarness();
  const actor: UploadActor = {
    userId: OWNER,
    orgId: ORG,
    folderId: FOLDER,
    scopes: ["reports:write"],
  };

  bundles.setResult(
    ok({
      files: [
        { path: "index.html", contentType: "text/html", bytes: new TextEncoder().encode(V1_HTML) },
      ],
      entryDocument: "index.html",
      contentHash: "hash-v1",
      sizeBytes: V1_HTML.length,
    }),
  );
  const created = await uploadReport(deps, {
    actor,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(V1_HTML) },
    ...(opts.withSidecars ? { sourceDoc: V1_DOC } : {}),
  });
  if (!created.ok) throw new Error("seed v1 failed");
  const reportSlug = slug(created.value.result.slug);

  bundles.setResult(
    ok({
      files: [
        { path: "index.html", contentType: "text/html", bytes: new TextEncoder().encode(V2_HTML) },
      ],
      entryDocument: "index.html",
      contentHash: "hash-v2",
      sizeBytes: V2_HTML.length,
    }),
  );
  const updated = await uploadReport(deps, {
    actor,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(V2_HTML) },
    updateSlug: reportSlug,
    ...(opts.withSidecars ? { sourceDoc: V2_DOC } : {}),
  });
  if (!updated.ok) throw new Error("seed v2 failed");

  const found = await reports.findBySlug(reportSlug);
  if (!found.ok || !found.value) throw new Error("seed report missing");
  const v1 = found.value.versions.find((v) => v.versionNo === 1);
  const v2 = found.value.versions.find((v) => v.versionNo === 2);
  if (!v1 || !v2) throw new Error("seed versions missing");

  return { deps, reports, blobs, grants, identities, slug: reportSlug, v1, v2 };
}

describe("loadReportDiff", () => {
  it("returns a STRUCTURAL diff when both versions carry a _source.json sidecar", async () => {
    const { deps, slug: reportSlug, v1, v2 } = await twoVersionHarness({ withSidecars: true });

    const result = await loadReportDiff(
      {
        reports: deps.reports,
        blobs: deps.blobs,
        grants: deps.grants,
        identities: deps.identities,
      },
      { orgId: ORG, userId: OWNER },
      reportSlug,
      { fromVersionId: v1.id, toVersionId: v2.id },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("structural");
    expect(result.value.fromVersionNo).toBe(1);
    expect(result.value.toVersionNo).toBe(2);
    expect(result.value.fromVersionId).toBe(v1.id);
    expect(result.value.toVersionId).toBe(v2.id);
    expect(result.value.html).toContain("there"); // the inserted word surfaces somewhere in the diff markup
  });

  it("degrades to the FALLBACK diff when a sidecar is missing (e.g. externally-uploaded versions)", async () => {
    const { deps, slug: reportSlug, v1, v2 } = await twoVersionHarness({ withSidecars: false });

    const result = await loadReportDiff(
      {
        reports: deps.reports,
        blobs: deps.blobs,
        grants: deps.grants,
        identities: deps.identities,
      },
      { orgId: ORG, userId: OWNER },
      reportSlug,
      { fromVersionId: v1.id, toVersionId: v2.id },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("fallback");
    expect(result.value.label).not.toBeNull();
  });

  it("rejects with NotFound when a version id doesn't belong to the report", async () => {
    const { deps, slug: reportSlug, v1 } = await twoVersionHarness({ withSidecars: true });
    const { versionId } = await import("arp-domain");
    const bogus = versionId("does-not-exist");

    const result = await loadReportDiff(
      {
        reports: deps.reports,
        blobs: deps.blobs,
        grants: deps.grants,
        identities: deps.identities,
      },
      { orgId: ORG, userId: OWNER },
      reportSlug,
      { fromVersionId: v1.id, toVersionId: bogus },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotFound");
  });

  it("rejects a reader outside the org with no write grant (loadReadableReport's guard)", async () => {
    const { deps, slug: reportSlug, v1, v2 } = await twoVersionHarness({ withSidecars: true });
    const outsiderOrg = orgId("00000000-0000-7000-8000-0000000000a9");

    const result = await loadReportDiff(
      {
        reports: deps.reports,
        blobs: deps.blobs,
        grants: deps.grants,
        identities: deps.identities,
      },
      { orgId: outsiderOrg, userId: OUTSIDER },
      reportSlug,
      { fromVersionId: v1.id, toVersionId: v2.id },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("END-TO-END THROUGH THE REAL TRUST BOUNDARY: a minted edit token's resolved actor can read the diff", async () => {
    const { deps, slug: reportSlug, v1, v2 } = await twoVersionHarness({ withSidecars: true });

    const token = mintEditToken(reportSlug, OWNER, 900, SECRET, NOW_SECONDS);
    const request = new Request(`https://app.example.com/api/v1/reports/${reportSlug}/diff`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const editActor = await resolveEditTokenActor(request, reportSlug, {
      reports: deps.reports,
      writeGrant: { grants: deps.grants, identities: deps.identities },
      secret: SECRET,
      nowSeconds: () => NOW_SECONDS,
    });
    expect(editActor).not.toBeNull();
    if (!editActor) return;

    const result = await loadReportDiff(
      {
        reports: deps.reports,
        blobs: deps.blobs,
        grants: deps.grants,
        identities: deps.identities,
      },
      { orgId: editActor.orgId, userId: editActor.userId },
      reportSlug,
      { fromVersionId: v1.id, toVersionId: v2.id },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("structural");
  });
});
