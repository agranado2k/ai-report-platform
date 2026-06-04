import { err, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  FakeBundleProcessor,
  FakeHasher,
  FakePlanLimiter,
  InMemoryBlobStore,
  InMemoryEventOutbox,
  InMemoryIdempotencyStore,
  InMemoryReportRepository,
  PassThroughUnitOfWork,
  RecordingScanQueue,
  SequentialIdGenerator,
  SequentialSlugFactory,
} from "../testing/in-memory";
import {
  type UploadActor,
  type UploadCommand,
  type UploadReportDeps,
  uploadReport,
} from "./upload-report";

const sv = (s: string) => {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
};

function makeDeps() {
  const reports = new InMemoryReportRepository();
  const blobs = new InMemoryBlobStore();
  const bundles = new FakeBundleProcessor();
  const idempotency = new InMemoryIdempotencyStore();
  const outbox = new InMemoryEventOutbox();
  const scans = new RecordingScanQueue();
  const planLimiter = new FakePlanLimiter();
  const deps: UploadReportDeps = {
    reports,
    blobs,
    bundles,
    idempotency,
    outbox,
    scans,
    planLimiter,
    ids: new SequentialIdGenerator(),
    slugs: new SequentialSlugFactory(),
    hasher: new FakeHasher(),
    uow: new PassThroughUnitOfWork(),
  };
  return { deps, reports, blobs, bundles, idempotency, outbox, scans, planLimiter };
}

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
    const { deps, reports, outbox, scans, blobs } = makeDeps();
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
    const { deps, reports } = makeDeps();
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

  it("rejects a cross-org re-upload (403)", async () => {
    const { deps } = makeDeps();
    await uploadReport(deps, cmd()); // org o1 creates slug000001
    const r = await uploadReport(
      deps,
      cmd({ actor: actor({ orgId: orgId("o2") }), updateSlug: "slug000001" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NotAllowed");
  });
});
