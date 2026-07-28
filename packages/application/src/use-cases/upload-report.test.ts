import { err, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
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
