// Unit tests for loadReportContent (issue #312) — the server-layer helper
// behind GET /api/v1/reports/{slug}/content. Proves: the LIVE-version default
// + explicit ?version= selection, the ?include=source sidecar, the readable-
// report auth guard (the SAME `getReport` seam diff/versions use), and the
// end-to-end edit-token trust-boundary chain (mint -> resolveEditTokenActor ->
// this helper), since the endpoint is edit-token-authenticatable like its
// siblings.
import type { UploadActor } from "arp-application";
import { uploadReport } from "arp-application";
import { makeAppTestHarness } from "arp-application/testing";
import {
  applyScanResult,
  folderId,
  makeSlug,
  mintEditToken,
  ok,
  orgId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { resolveEditTokenActor } from "./edit-token-actor.server";
import { loadReportContent, parseIncludeSource } from "./report-content-loader.server";

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

const V1_HTML = "<html><head></head><body><p>version one body</p></body></html>";
const V2_HTML = "<html><head></head><body><p>version two body</p></body></html>";
const V1_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "version one body" }] }],
};
const V2_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "version two body" }] }],
};

type Harness = Awaited<ReturnType<typeof makeAppTestHarness>>;
function depsOf(h: Harness) {
  return {
    reports: h.deps.reports,
    blobs: h.deps.blobs,
    grants: h.deps.grants,
    orgWriteGrants: h.deps.orgWriteGrants,
    identities: h.deps.identities,
  };
}

const ACTOR: UploadActor = {
  userId: OWNER,
  orgId: ORG,
  folderId: FOLDER,
  scopes: ["reports:write"],
};

async function seedVersion(
  h: Harness,
  html: string,
  hash: string,
  updateSlug: Slug | undefined,
  sourceDoc: Record<string, unknown> | undefined,
) {
  h.bundles.setResult(
    ok({
      files: [
        { path: "index.html", contentType: "text/html", bytes: new TextEncoder().encode(html) },
      ],
      entryDocument: "index.html",
      contentHash: hash,
      sizeBytes: html.length,
    }),
  );
  const r = await uploadReport(h.deps, {
    actor: ACTOR,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(html) },
    ...(updateSlug ? { updateSlug } : {}),
    ...(sourceDoc ? { sourceDoc } : {}),
  });
  if (!r.ok) throw new Error("seed upload failed");
  return r.value.result.slug;
}

/** A two-version report with BOTH versions promoted to `clean` (so v2 is live),
 *  optionally carrying `_source.json` sidecars. */
async function twoVersionLiveReport(opts: { withSidecars: boolean }) {
  const h = makeAppTestHarness();
  const created = await seedVersion(
    h,
    V1_HTML,
    "hash-v1",
    undefined,
    opts.withSidecars ? V1_DOC : undefined,
  );
  const reportSlug = slug(created);
  await seedVersion(h, V2_HTML, "hash-v2", reportSlug, opts.withSidecars ? V2_DOC : undefined);

  const found = await h.reports.findBySlug(reportSlug);
  if (!found.ok || !found.value) throw new Error("seed report missing");
  const v1 = found.value.versions.find((v) => v.versionNo === 1);
  const v2 = found.value.versions.find((v) => v.versionNo === 2);
  if (!v1 || !v2) throw new Error("seed versions missing");
  // Promote both to clean; the newer clean (v2) becomes the live version.
  let report = applyScanResult(found.value, v1.id, "clean").report;
  report = applyScanResult(report, v2.id, "clean").report;
  await h.reports.save(report);

  return { h, slug: reportSlug, v1, v2 };
}

describe("parseIncludeSource", () => {
  it("treats an absent `include` as false (the live/no-source default)", () => {
    const r = parseIncludeSource(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(false);
  });

  it("treats `include=source` as true", () => {
    const r = parseIncludeSource("source");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(true);
  });

  it("rejects any other value with a ValidationError — mirroring `version`'s strictness, not a silent ignore", () => {
    const r = parseIncludeSource("sources");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("ValidationError");
  });
});

describe("loadReportContent", () => {
  it("returns the LIVE version's stored HTML by default", async () => {
    const { h, slug: reportSlug, v2 } = await twoVersionLiveReport({ withSidecars: false });

    const result = await loadReportContent(
      depsOf(h),
      { orgId: ORG, userId: OWNER },
      reportSlug,
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionId).toBe(v2.id);
    expect(result.value.versionNo).toBe(2);
    expect(result.value.slug).toBe(reportSlug);
    expect(result.value.contentType).toBe("text/html");
    expect(result.value.html).toContain("version two body");
    expect(result.value.source).toBeUndefined();
  });

  it("returns a SPECIFIC (non-live) version's HTML when ?version= is given", async () => {
    const { h, slug: reportSlug, v1 } = await twoVersionLiveReport({ withSidecars: false });

    const result = await loadReportContent(depsOf(h), { orgId: ORG, userId: OWNER }, reportSlug, {
      versionId: v1.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionId).toBe(v1.id);
    expect(result.value.versionNo).toBe(1);
    expect(result.value.html).toContain("version one body");
  });

  it("includes the `_source.json` sidecar doc when include=source AND one exists", async () => {
    const { h, slug: reportSlug, v1 } = await twoVersionLiveReport({ withSidecars: true });

    const result = await loadReportContent(depsOf(h), { orgId: ORG, userId: OWNER }, reportSlug, {
      versionId: v1.id,
      includeSource: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toEqual(V1_DOC);
  });

  it("omits source when include=source but the version has NO sidecar (external upload)", async () => {
    const { h, slug: reportSlug, v1 } = await twoVersionLiveReport({ withSidecars: false });

    const result = await loadReportContent(depsOf(h), { orgId: ORG, userId: OWNER }, reportSlug, {
      versionId: v1.id,
      includeSource: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBeUndefined();
  });

  it("omits source when a sidecar exists but include=source was NOT requested", async () => {
    const { h, slug: reportSlug, v1 } = await twoVersionLiveReport({ withSidecars: true });

    const result = await loadReportContent(depsOf(h), { orgId: ORG, userId: OWNER }, reportSlug, {
      versionId: v1.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBeUndefined();
  });

  it("rejects with NotFound when the version id doesn't belong to the report", async () => {
    const { h, slug: reportSlug } = await twoVersionLiveReport({ withSidecars: false });
    const bogus = versionId("does-not-exist");

    const result = await loadReportContent(depsOf(h), { orgId: ORG, userId: OWNER }, reportSlug, {
      versionId: bogus,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotFound");
  });

  it("rejects with NotFound when the report has no live version yet (nothing clean)", async () => {
    const h = makeAppTestHarness();
    const created = await seedVersion(h, V1_HTML, "hash-v1", undefined, undefined);
    const reportSlug = slug(created); // NOT promoted → liveVersionId stays null

    const result = await loadReportContent(
      depsOf(h),
      { orgId: ORG, userId: OWNER },
      reportSlug,
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotFound");
  });

  it("rejects a reader outside the org with no write grant (loadReadableReport's guard)", async () => {
    const { h, slug: reportSlug } = await twoVersionLiveReport({ withSidecars: false });
    const outsiderOrg = orgId("00000000-0000-7000-8000-0000000000a9");

    const result = await loadReportContent(
      depsOf(h),
      { orgId: outsiderOrg, userId: OUTSIDER },
      reportSlug,
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotAllowed");
  });

  it("END-TO-END THROUGH THE REAL TRUST BOUNDARY: a minted edit token's actor can read content", async () => {
    const { h, slug: reportSlug, v2 } = await twoVersionLiveReport({ withSidecars: false });

    const token = mintEditToken(reportSlug, OWNER, 900, SECRET, NOW_SECONDS);
    const request = new Request(`https://app.example.com/api/v1/reports/${reportSlug}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const editActor = await resolveEditTokenActor(request, reportSlug, {
      reports: h.deps.reports,
      writeGrant: {
        grants: h.deps.grants,
        orgWriteGrants: h.deps.orgWriteGrants,
        identities: h.deps.identities,
      },
      secret: SECRET,
      nowSeconds: () => NOW_SECONDS,
    });
    expect(editActor).not.toBeNull();
    if (!editActor) return;

    const result = await loadReportContent(
      depsOf(h),
      { orgId: editActor.orgId, userId: editActor.userId },
      reportSlug,
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versionId).toBe(v2.id);
    expect(result.value.html).toContain("version two body");
  });
});
