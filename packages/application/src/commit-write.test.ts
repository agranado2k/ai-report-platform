import { orgId, userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { commitWrite } from "./commit-write";
import {
  InMemoryAuditLogger,
  InMemoryIdempotencyStore,
  PassThroughUnitOfWork,
} from "./testing/in-memory";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const ACTOR = userId("00000000-0000-7000-8000-0000000000d1");
const ref = () => ({ actingUserId: ACTOR, route: "PATCH /x", key: "k1" });

const deps = () => ({
  uow: new PassThroughUnitOfWork(),
  audit: new InMemoryAuditLogger(),
  idempotency: new InMemoryIdempotencyStore(),
});

const entry = () =>
  ({
    action: "report.renamed",
    orgId: ORG,
    actorUserId: ACTOR,
    targetType: "report",
    targetId: "r1",
    meta: {},
  }) as const;

describe("commitWrite — the mutating-write tail", () => {
  it("runs mutation, audit and complete inside ONE transaction, in that order", async () => {
    const d = deps();
    const order: string[] = [];
    const uow = {
      run: async <T>(fn: () => Promise<T>) => {
        order.push("tx-open");
        const r = await fn();
        order.push("tx-close");
        return r;
      },
    };
    await d.idempotency.begin(ref(), "fp");

    const r = await commitWrite(
      { ...d, uow },
      {
        idemRef: ref(),
        audit: () => [entry()],
        response: () => ({ responseStatus: 200, responseBody: { v: 1 } }),
      },
      async () => {
        order.push("mutate");
        return { ok: true as const, value: { v: 1 } };
      },
    );

    expect(r.ok).toBe(true);
    expect(order).toEqual(["tx-open", "mutate", "tx-close"]);
    expect(d.audit.recorded().length).toBe(1);
  });

  it("does NOT audit or complete when the mutation fails", async () => {
    const d = deps();
    await d.idempotency.begin(ref(), "fp");

    const r = await commitWrite(
      d,
      {
        idemRef: ref(),
        audit: () => [entry()],
        response: () => ({ responseStatus: 200, responseBody: {} }),
      },
      async () => ({ ok: false as const, error: { kind: "NotFound" as const, message: "gone" } }),
    );

    expect(r.ok).toBe(false);
    expect(d.audit.recorded().length).toBe(0);
    // The claim is still in flight — nothing completed it.
    const again = await d.idempotency.begin(ref(), "fp");
    expect(again.ok && again.value.outcome).toBe("in_flight");
  });

  it("skips complete when there is NO ref — an unsound op that claimed nothing", async () => {
    const d = deps();

    const r = await commitWrite(
      d,
      { audit: () => [entry()], response: () => ({ responseStatus: 204, responseBody: null }) },
      async () => ({ ok: true as const, value: undefined }),
    );

    expect(r.ok).toBe(true);
    expect(d.audit.recorded().length).toBe(1);
  });

  it("completes with the recorded response when a ref IS present", async () => {
    const d = deps();
    await d.idempotency.begin(ref(), "fp");

    await commitWrite(
      d,
      {
        idemRef: ref(),
        audit: () => [entry()],
        response: (v: { v: number }) => ({ responseStatus: 200, responseBody: v }),
      },
      async () => ({ ok: true as const, value: { v: 7 } }),
    );

    const replay = await d.idempotency.begin(ref(), "fp");
    expect(replay.ok && replay.value.outcome).toBe("replay");
    if (replay.ok && replay.value.outcome === "replay") {
      expect(replay.value.record.responseBody).toEqual({ v: 7 });
    }
  });

  it("propagates an audit failure and never completes", async () => {
    const d = deps();
    const audit = {
      record: async () => ({
        ok: false as const,
        error: { kind: "Unexpected" as const, message: "audit down" },
      }),
      recorded: () => [],
    };
    await d.idempotency.begin(ref(), "fp");

    const r = await commitWrite(
      { ...d, audit },
      {
        idemRef: ref(),
        audit: () => [entry()],
        response: () => ({ responseStatus: 200, responseBody: {} }),
      },
      async () => ({ ok: true as const, value: { v: 1 } }),
    );

    expect(r.ok).toBe(false);
    const again = await d.idempotency.begin(ref(), "fp");
    expect(again.ok && again.value.outcome).toBe("in_flight");
  });

  it("derives audit entries from the mutation's RESULT, so conditional rows work", async () => {
    // set-acl and set-report-sharing emit a second entry only when they also
    // revoked a grant. The entries must be a function of what happened.
    const d = deps();

    await commitWrite(
      d,
      {
        audit: (v: { readonly revoked: boolean }) => (v.revoked ? [entry(), entry()] : [entry()]),
        response: () => ({ responseStatus: 200, responseBody: {} }),
      },
      async () => ({ ok: true as const, value: { revoked: true } }),
    );

    expect(d.audit.recorded().length).toBe(2);
  });
});
