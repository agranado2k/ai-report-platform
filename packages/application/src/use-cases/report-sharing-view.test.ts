import { describe, expect, it } from "vitest";
import { ACTORS, report } from "../testing/fixtures";
import { InMemoryOrgWriteGrantStore } from "../testing/in-memory";
import { withReportSharing } from "./report-sharing-view";

const { orgA, orgB, owner } = ACTORS;
const ok = <T>(value: T) => ({ ok: true as const, value });

describe("withReportSharing — the read surfaces' composed answer (ADR-0078 §13)", () => {
  it("distinguishes org_view from org_edit, which the Acl alone cannot", async () => {
    const store = new InMemoryOrgWriteGrantStore();
    const shared = { ...report(orgA, "aaaaaaaaaa"), acl: { mode: "org" } as const };

    const view = await withReportSharing(store, ok(shared));
    expect(view.ok && view.value.sharing).toBe("org_view");

    await store.grant(shared.id, orgA, owner);
    const edit = await withReportSharing(store, ok(shared));
    expect(edit.ok && edit.value.sharing).toBe("org_edit");
    // The Acl is byte-identical across both — which is the whole problem.
    expect(view.ok && view.value.report.acl).toEqual(edit.ok ? edit.value.report.acl : null);
  });

  it("reports `private` for a private report with no grant", async () => {
    const r = await withReportSharing(
      new InMemoryOrgWriteGrantStore(),
      ok(report(orgA, "bbbbbbbbbb")),
    );
    expect(r.ok && r.value.sharing).toBe("private");
  });

  it("reports null for an advanced mode rather than rounding it down to private", async () => {
    const locked = {
      ...report(orgA, "cccccccccc"),
      acl: { mode: "password", passwordHash: "$argon2id$x" } as const,
    };
    const r = await withReportSharing(new InMemoryOrgWriteGrantStore(), ok(locked));
    expect(r.ok && r.value.sharing).toBeNull();
  });

  it("reports null for org-write-WITHOUT-org-read — the state only the API can make", async () => {
    const store = new InMemoryOrgWriteGrantStore();
    const r = report(orgA, "dddddddddd"); // acl defaults to private
    await store.grant(r.id, orgA, owner);
    const view = await withReportSharing(store, ok(r));
    expect(view.ok && view.value.sharing).toBeNull();
  });

  it("IGNORES a grant row issued for another org — a stale row is not org write", async () => {
    // The same rule `hasOrgWriteGrant` applies on the authorization path: a row
    // that would not authorize a write must not be reported as `org_edit`.
    const store = new InMemoryOrgWriteGrantStore();
    const shared = { ...report(orgA, "eeeeeeeeee"), acl: { mode: "org" } as const };
    await store.grant(shared.id, orgB, owner);
    const r = await withReportSharing(store, ok(shared));
    expect(r.ok && r.value.sharing).toBe("org_view");
  });

  it("propagates a store failure instead of answering with a confident state", async () => {
    // Degrading to "no grant" would report `org_view` on a report the whole org
    // can edit — the one wrong answer this composition exists to prevent.
    const failing = {
      async grant() {
        return { ok: true as const, value: undefined };
      },
      async revoke() {
        return { ok: true as const, value: undefined };
      },
      async find() {
        return { ok: false as const, error: { kind: "Unexpected" as const, message: "db down" } };
      },
    };
    const shared = { ...report(orgA, "ffffffffff"), acl: { mode: "org" } as const };
    const r = await withReportSharing(failing, ok(shared));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("db down");
  });

  it("passes a failed read straight through, never probing the store", async () => {
    const r = await withReportSharing(new InMemoryOrgWriteGrantStore(), {
      ok: false,
      error: { kind: "NotFound", message: "report not found" },
    });
    expect(r.ok).toBe(false);
  });
});
