// Unit tests for reassembleAndSaveEditedVersion (ADR-0063 API slice) — the
// server-layer helper factored out of reports.$slug.edit.tsx's action so the
// dashboard editor route AND the new POST /api/v1/reports/{slug}/versions
// (edit-token save) route share ONE reassembly implementation. Exercises it
// two ways:
//   - directly, with a plain UploadActor (mirrors the dashboard route's own
//     Clerk-session path);
//   - chained through the REAL edit-token trust boundary
//     (mintEditToken -> resolveEditTokenActor -> this helper) — proving the
//     API route's actual call chain works end-to-end without a live DB/Remix
//     action, per the same pattern edit-token-actor.server.test.ts uses.

import type { UploadActor } from "arp-application";
import { makeAppTestHarness } from "arp-application/testing";
import {
  folderId,
  makeSlug,
  mintEditToken,
  ok,
  orgId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import type { PMDocJson } from "arp-report-html";
import { describe, expect, it } from "vitest";
import { resolveEditTokenActor } from "./edit-token-actor.server";
import {
  editableVersion,
  reassembleAndSaveEditedVersion,
  reassembleEditedHtml,
} from "./save-edited-version.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const GRANTEE = userId("00000000-0000-7000-8000-0000000000d3");
const FOLDER = folderId("00000000-0000-7000-8000-0000000000f1");
const SECRET = "test-secret";
const NOW_SECONDS = 1_750_000_000;

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
}

const SHELL_HTML =
  '<html><head><style>.report{color:red}</style></head><body class="report-body">OLD CONTENT</body></html>';

const DOC: PMDocJson = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello edited" }] }],
};

/** A harness seeded with one report whose stored HTML has a real shell
 *  (`<head>`/`<body>`) — the default FakeBundleProcessor's canned `<h1>ok</h1>`
 *  has no `<body>` tag, which would make splitShell throw, so every test
 *  overrides `bundles` with shell-bearing content. */
async function seededHarness() {
  const { deps, reports, blobs, bundles, grants, identities } = makeAppTestHarness();
  bundles.setResult(
    ok({
      files: [
        {
          path: "index.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode(SHELL_HTML),
        },
      ],
      entryDocument: "index.html",
      contentHash: "hash-1",
      sizeBytes: SHELL_HTML.length,
    }),
  );
  const actor: UploadActor = {
    userId: OWNER,
    orgId: ORG,
    folderId: FOLDER,
    scopes: ["reports:write"],
  };
  const { uploadReport } = await import("arp-application");
  const uploaded = await uploadReport(deps, {
    actor,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(SHELL_HTML) },
  });
  if (!uploaded.ok) throw new Error("seed upload failed");
  return {
    deps,
    reports,
    blobs,
    grants,
    identities,
    actor,
    slug: slug(uploaded.value.result.slug),
  };
}

describe("editableVersion", () => {
  it("picks the live version when one is published", () => {
    const v1 = { id: versionId("v1"), versionNo: 1 } as never;
    const v2 = { id: versionId("v2"), versionNo: 2 } as never;
    const picked = editableVersion({ liveVersionId: versionId("v1"), versions: [v1, v2] });
    expect(picked).toBe(v1);
  });

  it("falls back to the newest version by versionNo when nothing is live yet", () => {
    const v1 = { id: versionId("v1"), versionNo: 1 } as never;
    const v2 = { id: versionId("v2"), versionNo: 2 } as never;
    const picked = editableVersion({ liveVersionId: null, versions: [v1, v2] });
    expect(picked).toBe(v2);
  });
});

describe("reassembleAndSaveEditedVersion", () => {
  it("re-injects the CURRENT version's shell around the newly-serialized body and saves an editor-origin version", async () => {
    const { deps, reports, actor, slug: reportSlug } = await seededHarness();

    const saved = await reassembleAndSaveEditedVersion(deps, actor, reportSlug, DOC);

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.result.version).toBe(2);

    const found = await reports.findBySlug(reportSlug);
    const v2 = found.ok ? found.value?.versions.find((v) => v.versionNo === 2) : undefined;
    expect(v2?.origin).toBe("editor");
    expect(v2?.uploadedBy).toBe(actor.userId);
  });

  it("writes the doc as the _source.json sidecar alongside the new version", async () => {
    const { deps, blobs, actor, slug: reportSlug } = await seededHarness();

    const saved = await reassembleAndSaveEditedVersion(deps, actor, reportSlug, DOC);
    expect(saved.ok).toBe(true);
    if (!saved.ok || !saved.value.reportId || !saved.value.versionId) return;

    const sidecar = await blobs.readObject(
      saved.value.reportId,
      saved.value.versionId,
      "_source.json",
    );
    expect(sidecar.ok).toBe(true);
    const decoded =
      sidecar.ok && sidecar.value
        ? JSON.parse(new TextDecoder().decode(sidecar.value.bytes))
        : null;
    expect(decoded).toEqual(DOC);
  });

  it("reassembleEditedHtml re-injects the new body into the CURRENT shell, preserving <head>/<style> and body attributes", () => {
    const html = reassembleEditedHtml(SHELL_HTML, DOC);
    expect(html).toContain("<style>.report{color:red}</style>");
    expect(html).toContain('class="report-body"');
    expect(html).toContain("hello edited");
    expect(html).not.toContain("OLD CONTENT");
  });

  it("rejects a save by a non-owner, non-grantee (mirrors re-upload's canWrite authorization)", async () => {
    const { deps, actor, slug: reportSlug } = await seededHarness();
    const stranger: UploadActor = {
      ...actor,
      userId: userId("00000000-0000-7000-8000-0000000000d9"),
    };

    const saved = await reassembleAndSaveEditedVersion(deps, stranger, reportSlug, DOC);

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error).toEqual({
      kind: "NotAllowed",
      message: "you do not have write access to this report",
    });
  });

  it("rejects a save for a slug that doesn't exist", async () => {
    const { deps, actor } = await seededHarness();
    const saved = await reassembleAndSaveEditedVersion(deps, actor, slug("nosuchslug"), DOC);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.kind).toBe("NotFound");
  });

  it("END-TO-END THROUGH THE REAL TRUST BOUNDARY: a minted edit token resolves via resolveEditTokenActor, and the resulting actor can save", async () => {
    const { deps, reports, grants, identities, slug: reportSlug } = await seededHarness();
    // Grant GRANTEE canWrite on the seeded report.
    identities.seedUser(GRANTEE, "grantee@x.com");
    const found = await reports.findBySlug(reportSlug);
    if (!found.ok || !found.value) throw new Error("seed report missing");
    await grants.grant(found.value.id, "grantee@x.com", OWNER, GRANTEE);

    const token = mintEditToken(reportSlug, GRANTEE, 900, SECRET, NOW_SECONDS);
    const request = new Request(`https://app.example.com/api/v1/reports/${reportSlug}/versions`, {
      headers: { authorization: `Bearer ${token}` },
    });

    const editActor = await resolveEditTokenActor(request, reportSlug, {
      reports: deps.reports,
      writeGrant: { grants, identities },
      secret: SECRET,
      nowSeconds: () => NOW_SECONDS,
    });
    expect(editActor).not.toBeNull();
    if (!editActor) return;

    const uploadActor: UploadActor = {
      userId: editActor.userId,
      orgId: editActor.orgId,
      folderId: editActor.folderId,
      scopes: ["reports:write"],
    };

    const saved = await reassembleAndSaveEditedVersion(deps, uploadActor, reportSlug, DOC);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.result.version).toBe(2);

    const after = await reports.findBySlug(reportSlug);
    const v2 = after.ok ? after.value?.versions.find((v) => v.versionNo === 2) : undefined;
    expect(v2?.uploadedBy).toBe(GRANTEE); // authored by the token's sub, not the owner
  });

  it("END-TO-END: a token whose canWrite grant was REVOKED after mint never reaches the helper (resolveEditTokenActor rejects first)", async () => {
    const { deps, reports, grants, identities, slug: reportSlug } = await seededHarness();
    identities.seedUser(GRANTEE, "grantee@x.com");
    const found = await reports.findBySlug(reportSlug);
    if (!found.ok || !found.value) throw new Error("seed report missing");
    await grants.grant(found.value.id, "grantee@x.com", OWNER, GRANTEE);
    const token = mintEditToken(reportSlug, GRANTEE, 900, SECRET, NOW_SECONDS);

    await grants.revoke(found.value.id, "grantee@x.com");

    const request = new Request(`https://app.example.com/api/v1/reports/${reportSlug}/versions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const editActor = await resolveEditTokenActor(request, reportSlug, {
      reports: deps.reports,
      writeGrant: { grants, identities },
      secret: SECRET,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(editActor).toBeNull(); // the API route's auth seam rejects BEFORE reassembleAndSaveEditedVersion is ever called
  });

  it("END-TO-END: a token minted for a DIFFERENT slug is rejected — never resolves an actor for this report", async () => {
    const { deps, grants, identities, slug: reportSlug } = await seededHarness();
    const token = mintEditToken("some-other-slug1", OWNER, 900, SECRET, NOW_SECONDS);

    const request = new Request(`https://app.example.com/api/v1/reports/${reportSlug}/versions`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const editActor = await resolveEditTokenActor(request, reportSlug, {
      reports: deps.reports,
      writeGrant: { grants, identities },
      secret: SECRET,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(editActor).toBeNull();
  });
});
