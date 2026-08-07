import { err } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../ports";
import {
  ACTORS,
  makeOwnerMutationDeps as makeDeps,
  ownerActor,
  report,
  slug,
} from "../testing/fixtures";
import {
  InMemoryReportRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { type DeleteReportDeps, deleteReport } from "./delete-report";

const { orgA, owner, otherUser } = ACTORS;

describe("deleteReport use case", () => {
  it("soft-deletes a report (excluded from the owner's searchByOrg)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await deleteReport(deps, ownerActor, { slug: slug("aaaaaaaaaa") });
    expect(r.ok).toBe(true);
    const list = await deps.reports.searchByOrg(orgA, { userId: owner }, { limit: 10 });
    expect(list.ok && list.value.items.some((s) => s.slug === "aaaaaaaaaa")).toBe(false);
  });

  it("rejects a non-owner (even same-org) with NotAllowed (ADR-0059: delete is owner-only)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "bbbbbbbbbb"));
    const r = await deleteReport(
      deps,
      { orgId: orgA, userId: otherUser },
      {
        slug: slug("bbbbbbbbbb"),
      },
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "you do not own this report" });
  });

  it("rejects an unknown report with NotFound", async () => {
    const deps = makeDeps();
    const r = await deleteReport(deps, ownerActor, { slug: slug("cccccccccc") });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an already-deleted report with NotFound under a FRESH explicit key", async () => {
    // An IDENTICAL retry replays the recorded 204 (ADR-0039 — see the
    // idempotency describe below); a deliberate re-delete under a fresh
    // explicit Idempotency-Key re-executes and surfaces the real NotFound.
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "dddddddddd"));
    await deleteReport(deps, ownerActor, { slug: slug("dddddddddd") });
    const again = await deleteReport(deps, ownerActor, {
      slug: slug("dddddddddd"),
      idempotencyKey: "fresh-deliberate-retry",
    });
    expect(!again.ok && again.error.kind).toBe("NotFound");
  });

  it("records a report.deleted audit entry alongside the soft-delete (ADR-0070)", async () => {
    const deps = makeDeps();
    const toDelete = report(orgA, "eeeeeeeeee");
    await deps.reports.save(toDelete);
    const r = await deleteReport(deps, ownerActor, { slug: slug("eeeeeeeeee") });
    expect(r.ok).toBe(true);
    expect(deps.audit.recorded()).toContainEqual({
      action: "report.deleted",
      orgId: orgA,
      actorUserId: owner,
      targetType: "report",
      targetId: toDelete.id,
    });
  });

  it("ATOMICITY: when audit.record fails inside uow.run, the use case returns that error", async () => {
    const failingAudit: AuditLogger = {
      record: async () => err({ kind: "Unexpected", message: "audit sink down" }),
    };
    const deps: DeleteReportDeps = {
      reports: new InMemoryReportRepository(),
      audit: failingAudit,
      uow: new PassThroughUnitOfWork(),
      ...idempotencyTestDeps(),
    };
    await deps.reports.save(report(orgA, "ffffffffff"));

    const r = await deleteReport(deps, ownerActor, { slug: slug("ffffffffff") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("audit sink down");

    // NOTE: PassThroughUnitOfWork is a non-transactional fake — it can't prove
    // the softDelete write was actually rolled back (InMemoryReportRepository
    // mutates its map directly, with no undo). The real rollback guarantee is
    // proven against real Postgres in
    // packages/adapters/src/delete-report.integration.test.ts, which wires
    // deleteReport with DrizzleUnitOfWork + DrizzleReportRepository + a
    // failing AuditLogger and asserts the row's `deleted_at` stayed null.
  });
});

describe("deleteReport idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "ffffffffff"));
    const first = await deleteReport(deps, ownerActor, { slug: slug("ffffffffff") });
    const second = await deleteReport(deps, ownerActor, { slug: slug("ffffffffff") });
    expect(first.ok).toBe(true);
    // #233: the keyless retry now really RUNS. For a delete-shaped operation
    // that means the second call fails (the thing is already gone) instead of
    // replaying a recorded 204. That is the point: the derived key could
    // otherwise be burned BEFORE the fact, making the real delete a no-op.
    // A client that wants exactly-once retry semantics sends an
    // Idempotency-Key, which still claims and replays as before.
    expect(second.ok).toBe(false);
    expect(deps.audit.recorded().length).toBe(1);
  });
});

// ── #233 acceptance: the pre-emptive burn ──────────────────────────────────
describe("deleteReport — a pre-emptive delete must not burn the key (#233)", () => {
  it("a delete fired before the report is re-created does not swallow the real one", async () => {
    const deps = makeDeps();
    await deps.reports.save(report(orgA, "ffffffffff"));
    const target = { slug: slug("ffffffffff") };

    // 1. Arm: a real delete records a key for this exact payload.
    expect((await deleteReport(deps, ownerActor, target)).ok).toBe(true);
    // 2. The slug is live again (re-uploaded, or restored out-of-band).
    await deps.reports.save(report(orgA, "ffffffffff"));
    // 3. The real delete. A derived-key replay would answer 204 and leave it.
    const real = await deleteReport(deps, ownerActor, target);

    expect(real.ok, "the second delete must actually run, not replay").toBe(true);
    const after = await deps.reports.findBySlug(slug("ffffffffff"));
    expect(after.ok && after.value?.deletedAt, "the report must really be gone").not.toBeNull();
  });
});
