import {
  createFolder,
  err,
  folderId,
  makeSlug,
  ok,
  orgId,
  reportId,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { makeAppTestHarness } from "../testing/harness";
import { type UploadActor, type UploadCommand, uploadReport } from "./upload-report";

const sv = (s: string) => {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
};

// Exemplar conversion to the shared harness (mission: shared use-case test
// harness) — was 11 hand-wired fakes; now one call, with named handles for
// assertions preserved.
const makeDeps = makeAppTestHarness;

const actor = (over: Partial<UploadActor> = {}): UploadActor => ({
  userId: userId("u1"),
  orgId: orgId("o1"),
  folderId: folderId("f1"),
  scopes: ["reports:write"],
  ...over,
});

const cmd = (over: Partial<UploadCommand> = {}): UploadCommand => ({
  actor: actor(),
  upload: { filename: "report.html", bytes: new TextEncoder().encode("<h1>hi</h1>") },
  ...over,
});

describe("uploadReport", () => {
  it("rejects a key without reports:write scope", async () => {
    const { deps } = makeDeps();
    const r = await uploadReport(deps, cmd({ actor: actor({ scopes: [] }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("creates a report: 201-shape result, persisted, event + scan enqueued, blob stored", async () => {
    const { deps, reports, outbox, audit, scans, blobs } = makeDeps();
    const r = await uploadReport(deps, cmd());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replayed).toBe(false);
      expect(r.value.result).toMatchObject({
        slug: "slug000001",
        version: 1,
        scanStatus: "pending",
      });
    }
    const found = await reports.findBySlug(sv("slug000001"));
    expect(found.ok && found.value?.slug).toBe("slug000001");
    expect(outbox.drained().map((e) => e.type)).toEqual(["ReportVersionUploaded"]);
    expect(audit.recorded()).toContainEqual({
      action: "report.uploaded",
      orgId: "o1",
      actorUserId: "u1",
      targetType: "report",
      targetId: "r1",
      meta: { versionId: "v1" },
    });
    expect(scans.enqueued).toEqual([{ reportId: "r1", versionId: "v1" }]);
    const blob = await blobs.readObject(reportId("r1"), versionId("v1"), "index.html");
    expect(blob.ok && blob.value?.path).toBe("index.html");
  });

  it("passes a bundle pre-check failure straight through (e.g. SVG → 415)", async () => {
    const { deps, bundles } = makeDeps();
    bundles.setResult(err({ kind: "UnsupportedMediaType", message: "SVG rejected (ADR-0015)" }));
    const r = await uploadReport(
      deps,
      cmd({ upload: { filename: "x.svg", bytes: new Uint8Array() } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("UnsupportedMediaType");
  });

  it("rejects when over the plan limit (402)", async () => {
    const { deps, planLimiter } = makeDeps();
    planLimiter.setWithinPlan(false);
    const r = await uploadReport(deps, cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("PlanLimitExceeded");
  });

  it("replays an identical retry (same key + content) without creating a duplicate", async () => {
    const { deps, reports, audit } = makeDeps();
    const first = await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    const second = await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    expect(first.ok && first.value.replayed).toBe(false);
    expect(second.ok && second.value.replayed).toBe(true);
    expect(first.ok && second.ok && first.value.result.slug === second.value.result.slug).toBe(
      true,
    );
    // No second report was created.
    const dup = await reports.findBySlug(sv("slug000002"));
    expect(dup.ok && dup.value).toBeNull();
    // A replay is not a NEW mutation — exactly one report.uploaded is recorded.
    expect(audit.recorded().filter((e) => e.action === "report.uploaded")).toHaveLength(1);
  });

  it("rejects a reused key with a different body (422)", async () => {
    const { deps, bundles } = makeDeps();
    bundles.setContentHash("hashA");
    await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    bundles.setContentHash("hashB");
    const r = await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
  });

  it("re-upload with update_slug adds version 2 at the same slug", async () => {
    const { deps } = makeDeps();
    await uploadReport(deps, cmd()); // creates slug000001
    const r = await uploadReport(deps, cmd({ updateSlug: "slug000001" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.result).toMatchObject({ slug: "slug000001", version: 2 });
  });

  it("rejects a re-upload by a non-owner (403, ADR-0059 canWrite = isOwner)", async () => {
    const { deps } = makeDeps();
    await uploadReport(deps, cmd()); // u1 creates (and owns) slug000001
    const r = await uploadReport(
      deps,
      cmd({ actor: actor({ userId: userId("u2") }), updateSlug: "slug000001" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toEqual({
        kind: "NotAllowed",
        message: "you do not have write access to this report",
      });
    }
  });

  it("the owner can re-upload regardless of acting-org context (ownership is org-agnostic)", async () => {
    const { deps } = makeDeps();
    await uploadReport(deps, cmd()); // u1 creates (and owns) slug000001
    const r = await uploadReport(
      deps,
      cmd({ actor: actor({ orgId: orgId("o2") }), updateSlug: "slug000001" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.result).toMatchObject({ slug: "slug000001", version: 2 });
  });

  it("an editor save (origin: 'editor') is recorded on the new ReportVersion", async () => {
    const { deps, reports } = makeDeps();
    await uploadReport(deps, cmd()); // creates slug000001, origin 'upload'
    const r = await uploadReport(deps, cmd({ updateSlug: "slug000001", origin: "editor" }));
    expect(r.ok).toBe(true);
    const found = await reports.findBySlug(sv("slug000001"));
    const v2 = found.ok ? found.value?.versions.find((v) => v.versionNo === 2) : undefined;
    expect(v2?.origin).toBe("editor");
  });

  it(
    "SECURITY: an editor save's _source.json sidecar reaches the blob store but is " +
      "excluded from the version manifest (never publicly servable at view.<domain>/<slug>/_source.json)",
    async () => {
      const { deps, reports, blobs } = makeDeps();
      await uploadReport(deps, cmd()); // creates slug000001 (r1/v1)
      const sourceDoc = { type: "doc", content: [{ type: "paragraph" }] };
      const r = await uploadReport(
        deps,
        cmd({ updateSlug: "slug000001", origin: "editor", sourceDoc }),
      );
      expect(r.ok).toBe(true);

      const found = await reports.findBySlug(sv("slug000001"));
      const v2 = found.ok ? found.value?.versions.find((v) => v.versionNo === 2) : undefined;
      // The manifest — what the viewer is allowed to serve by path — never lists the sidecar.
      expect(v2?.manifest.files).not.toContain("_source.json");
      expect(v2?.manifest.files).toEqual(["index.html"]);

      // Yet the blob store DID receive it, at the same version prefix.
      const sidecar = await blobs.readObject(reportId("r1"), versionId("v2"), "_source.json");
      expect(sidecar.ok).toBe(true);
      expect(sidecar.ok && sidecar.value?.path).toBe("_source.json");
      const decoded =
        sidecar.ok && sidecar.value
          ? JSON.parse(new TextDecoder().decode(sidecar.value.bytes))
          : null;
      expect(decoded).toEqual(sourceDoc);
    },
  );

  it("a plain upload/re-upload with no sourceDoc writes no sidecar at all", async () => {
    const { deps, blobs } = makeDeps();
    await uploadReport(deps, cmd()); // r1/v1, no sourceDoc
    const sidecar = await blobs.readObject(reportId("r1"), versionId("v1"), "_source.json");
    expect(sidecar.ok && sidecar.value).toBeNull();
  });

  describe("CORRECTNESS (PR #151 review, Fix 3): idempotency must not fold a PM-doc-only change into a no-op replay", () => {
    // FakeBundleProcessor ignores its actual filename/bytes arguments and
    // always returns the same fixed contentHash unless overridden (see
    // in-memory.ts) — every uploadReport call below is therefore, from the
    // pipeline's point of view, "the same HTML bytes", exactly the scenario
    // this bug is about: a PM-doc edit that serializes to byte-identical
    // HTML (e.g. a no-op formatting change, or content moved without
    // altering rendered markup).

    it("two editor saves with the SAME html but a DIFFERENT sourceDoc: the second is not a replay, and its own sidecar is written", async () => {
      const { deps, blobs } = makeDeps();
      await uploadReport(deps, cmd()); // creates slug000001 (r1/v1)

      const docA = { type: "doc", content: [{ type: "paragraph", attrs: { note: "A" } }] };
      const first = await uploadReport(
        deps,
        cmd({ updateSlug: "slug000001", origin: "editor", sourceDoc: docA }),
      );
      expect(first.ok && first.value.replayed).toBe(false);
      if (first.ok) expect(first.value.result.version).toBe(2);

      const docB = { type: "doc", content: [{ type: "paragraph", attrs: { note: "B" } }] };
      const second = await uploadReport(
        deps,
        cmd({ updateSlug: "slug000001", origin: "editor", sourceDoc: docB }),
      );
      expect(second.ok && second.value.replayed).toBe(false);
      if (second.ok) expect(second.value.result.version).toBe(3);

      const sidecarV2 = await blobs.readObject(reportId("r1"), versionId("v2"), "_source.json");
      const sidecarV3 = await blobs.readObject(reportId("r1"), versionId("v3"), "_source.json");
      expect(
        sidecarV2.ok &&
          sidecarV2.value &&
          JSON.parse(new TextDecoder().decode(sidecarV2.value.bytes)),
      ).toEqual(docA);
      expect(
        sidecarV3.ok &&
          sidecarV3.value &&
          JSON.parse(new TextDecoder().decode(sidecarV3.value.bytes)),
      ).toEqual(docB);
    });

    it("two editor saves with the SAME html and the SAME sourceDoc still replay (plain double-submit dedup preserved)", async () => {
      const { deps, blobs } = makeDeps();
      await uploadReport(deps, cmd()); // creates slug000001 (r1/v1)

      const doc = { type: "doc", content: [{ type: "paragraph", attrs: { note: "same" } }] };
      const first = await uploadReport(
        deps,
        cmd({ updateSlug: "slug000001", origin: "editor", sourceDoc: doc }),
      );
      expect(first.ok && first.value.replayed).toBe(false);
      if (first.ok) expect(first.value.result.version).toBe(2);

      const second = await uploadReport(
        deps,
        cmd({ updateSlug: "slug000001", origin: "editor", sourceDoc: doc }),
      );
      expect(second.ok && second.value.replayed).toBe(true);
      if (second.ok) expect(second.value.result.version).toBe(2); // replayed the v2 response, no v3 created

      // Still only one sidecar — no phantom v3 was created.
      const sidecarV3 = await blobs.readObject(reportId("r1"), versionId("v3"), "_source.json");
      expect(sidecarV3.ok && sidecarV3.value).toBeNull();
    });
  });
});

// ── Inherit-on-upload (ADR-0078 §6) ────────────────────────────────────────
// A report created in a non-Root folder takes that folder's visibility as its
// initial Acl. The ROOT CARVE-OUT is the whole reason this is safe: Root is
// permanently org-visible AND is the default upload placement, so inheriting
// without exempting it would make EVERY upload in the product org-visible.
describe("uploadReport — initial sharing inherits the destination folder (ADR-0078 §6)", () => {
  const ROOT = folderId("00000000-0000-7000-8000-0000000000a0");
  const CHILD = folderId("00000000-0000-7000-8000-0000000000a2");

  const seedTree = async (h: ReturnType<typeof makeDeps>, childVisibility: "private" | "org") => {
    const root = createFolder({
      id: ROOT,
      orgId: orgId("o1"),
      parentId: null,
      ownerId: null,
      visibility: "org",
      name: "Root",
    });
    if (!root.ok) throw new Error("root fixture");
    await h.folders.save(root.value);
    const child = createFolder({
      id: CHILD,
      orgId: orgId("o1"),
      parentId: ROOT,
      ownerId: userId("u1"),
      visibility: childVisibility,
      name: "House Numbers",
    });
    if (!child.ok) throw new Error("child fixture");
    await h.folders.save(child.value);
  };

  it("uploads into an ORG-shared folder land org-visible", async () => {
    const h = makeDeps();
    await seedTree(h, "org");
    const r = await uploadReport(h.deps, cmd({ actor: actor({ folderId: CHILD }) }));
    expect(r.ok).toBe(true);
    const saved = await h.reports.findBySlug(sv(r.ok ? r.value.result.slug : ""));
    expect(saved.ok && saved.value?.acl.mode).toBe("org");
  });

  it("uploads into a PRIVATE folder stay private", async () => {
    const h = makeDeps();
    await seedTree(h, "private");
    const r = await uploadReport(h.deps, cmd({ actor: actor({ folderId: CHILD }) }));
    const saved = await h.reports.findBySlug(sv(r.ok ? r.value.result.slug : ""));
    expect(saved.ok && saved.value?.acl.mode).toBe("private");
  });

  it("uploads into ROOT stay PRIVATE even though Root is permanently org-visible", async () => {
    // THE carve-out. Root is the default upload placement (ADR-0037) and is
    // always `org` (ADR-0076 §3) — inheriting from it would silently publish
    // every upload in the product.
    const h = makeDeps();
    await seedTree(h, "org");
    const r = await uploadReport(h.deps, cmd({ actor: actor({ folderId: ROOT }) }));
    const saved = await h.reports.findBySlug(sv(r.ok ? r.value.result.slug : ""));
    expect(saved.ok && saved.value?.acl.mode).toBe("private");
  });

  it("never inherits ORG WRITE — write is always an explicit act", async () => {
    const h = makeDeps();
    await seedTree(h, "org");
    const r = await uploadReport(h.deps, cmd({ actor: actor({ folderId: CHILD }) }));
    const saved = await h.reports.findBySlug(sv(r.ok ? r.value.result.slug : ""));
    const grant = saved.ok && saved.value ? await h.deps.orgWriteGrants.find(saved.value.id) : null;
    expect(grant && grant.ok && grant.value).toBeNull();
  });

  it("falls back to PRIVATE when the destination folder can't be resolved", async () => {
    // Fail-safe: an unknown folder must never widen a report's reach.
    const h = makeDeps();
    const r = await uploadReport(h.deps, cmd({ actor: actor({ folderId: CHILD }) }));
    const saved = await h.reports.findBySlug(sv(r.ok ? r.value.result.slug : ""));
    expect(saved.ok && saved.value?.acl.mode).toBe("private");
  });

  it("PROPAGATES a folder-store error instead of silently defaulting to private", async () => {
    // The documented distinction (upload-report.ts): silently narrowing on
    // infrastructure trouble is fine, but doing so without anyone being able to
    // tell the difference from a legitimately-private upload is not. The
    // fallback above and this branch must stay distinguishable.
    const h = makeDeps();
    const failing = {
      ...h.deps,
      folders: {
        ...h.deps.folders,
        async findById() {
          return { ok: false as const, error: { kind: "Unexpected" as const, message: "db down" } };
        },
      },
    };
    const r = await uploadReport(failing, cmd({ actor: actor({ folderId: CHILD }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });

  it("a RE-UPLOAD never re-derives sharing from the folder", async () => {
    // Inheritance is a CREATE-time rule only (ADR-0078 §6/§7). A re-upload into
    // an org-shared folder must not publish a report its owner made private.
    const h = makeDeps();
    await seedTree(h, "org");
    const first = await uploadReport(h.deps, cmd({ actor: actor({ folderId: CHILD }) }));
    const slugStr = first.ok ? first.value.result.slug : "";
    const created = await h.reports.findBySlug(sv(slugStr));
    if (!created.ok || !created.value) throw new Error("seed");
    await h.reports.setAcl(created.value.id, { mode: "private" });

    h.bundles.setContentHash("b".repeat(64)); // a genuinely new version
    const again = await uploadReport(
      h.deps,
      cmd({ actor: actor({ folderId: CHILD }), updateSlug: slugStr }),
    );
    expect(again.ok).toBe(true);
    const after = await h.reports.findBySlug(sv(slugStr));
    expect(after.ok && after.value?.acl.mode).toBe("private");
  });
});

describe("uploadReport — Editability (ADR-0080)", () => {
  it("records the probe's verdict on the created version", async () => {
    const { deps, reports, editability } = makeDeps();
    editability.setVerdict("unsplittable");
    const r = await uploadReport(deps, cmd());
    expect(r.ok).toBe(true);
    const found = await reports.findBySlug(sv("slug000001"));
    expect(found.ok && found.value?.versions[0]?.editability).toBe("unsplittable");
  });

  it("ACCEPTS an un-editable upload — views-fine-won't-edit is a state, not a rejection", async () => {
    const { deps, blobs, editability } = makeDeps();
    editability.setVerdict("unsplittable");
    const r = await uploadReport(deps, cmd());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.result.version).toBe(1);
    // …and the bytes are stored regardless, so the viewer still serves it.
    const blob = await blobs.readObject(reportId("r1"), versionId("v1"), "index.html");
    expect(blob.ok && blob.value?.path).toBe("index.html");
  });

  it("probes the ENTRY DOCUMENT's bytes, verbatim", async () => {
    const { deps, editability } = makeDeps();
    await uploadReport(deps, cmd());
    // The default FakeBundleProcessor's canned entry document.
    expect(editability.probed).toEqual([{ html: "<h1>ok</h1>", hasSourceDoc: false }]);
  });

  it("tells the probe a _source.json sidecar will be written (editor saves)", async () => {
    const { deps, editability } = makeDeps();
    await uploadReport(deps, cmd({ sourceDoc: { type: "doc", content: [] } }));
    expect(editability.probed[0]?.hasSourceDoc).toBe(true);
  });

  it("records a fresh verdict per re-upload, leaving the prior version's alone", async () => {
    const { deps, reports, editability } = makeDeps();
    editability.setVerdict("editable");
    await uploadReport(deps, cmd());
    editability.setVerdict("unparsable");
    const again = await uploadReport(deps, cmd({ updateSlug: "slug000001" }));
    expect(again.ok).toBe(true);
    const found = await reports.findBySlug(sv("slug000001"));
    expect(found.ok && found.value?.versions.map((v) => v.editability)).toEqual([
      "editable",
      "unparsable",
    ]);
  });

  it("leaves editability UNKNOWN when the bundle has no entry-document bytes to probe", async () => {
    const { deps, reports, bundles, editability } = makeDeps();
    bundles.setResult(
      ok({
        files: [
          { path: "other.html", contentType: "text/html", bytes: new TextEncoder().encode("x") },
        ],
        entryDocument: "index.html",
        contentHash: "hash-default",
        sizeBytes: 1,
      }),
    );
    const r = await uploadReport(deps, cmd());
    expect(r.ok).toBe(true);
    const found = await reports.findBySlug(sv("slug000001"));
    expect(found.ok && found.value?.versions[0]?.editability).toBeNull();
    expect(editability.probed).toEqual([]);
  });
});

describe("uploadReport — Editability on an idempotent replay (ADR-0080)", () => {
  it("replays the recorded verdict rather than re-probing", async () => {
    const { deps, editability } = makeDeps();
    editability.setVerdict("unparsable");
    const first = await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    editability.setVerdict("editable"); // the probe would now disagree
    const second = await uploadReport(deps, cmd({ idempotencyKey: "k1" }));
    expect(first.ok && first.value.result.editability).toBe("unparsable");
    expect(second.ok && second.value.replayed).toBe(true);
    expect(second.ok && second.value.result.editability).toBe("unparsable");
  });

  it("reads a record stored BEFORE ADR-0080 as UNKNOWN, not as a 500", async () => {
    // In-flight idempotency records written by the previous deploy have no
    // `editability` key at all. Rejecting them would turn every one of them
    // into an Unexpected error on replay.
    const { deps, idempotency } = makeDeps();
    const ref = { actingUserId: userId("u1"), route: "POST /api/v1/reports", key: "legacy" };
    // The same fingerprint the use case derives — content hash + target — so
    // the replay branch is reached rather than the 422 reuse-conflict branch.
    await idempotency.begin(ref, "hash-default:folder:f1");
    await idempotency.complete(ref, {
      responseStatus: 201,
      responseBody: { slug: "slug000001", version: 1, scanStatus: "clean" },
    });
    const r = await uploadReport(deps, cmd({ idempotencyKey: "legacy" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.replayed).toBe(true);
      expect(r.value.result.editability).toBeNull();
    }
  });
});
