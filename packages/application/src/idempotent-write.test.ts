import { createReport, folderId, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  beginIdempotentWrite,
  reportReplayBody,
  reviveFolderReplay,
  reviveReplay,
  reviveReportReplay,
} from "./idempotent-write";
import { FakeHasher, InMemoryIdempotencyStore } from "./testing/in-memory";

const actingUserId = userId("00000000-0000-7000-8000-0000000000d1");

const deps = () => ({ idempotency: new InMemoryIdempotencyStore(), keyHasher: new FakeHasher() });
const input = (over: Partial<Parameters<typeof beginIdempotentWrite>[1]> = {}) => ({
  actingUserId,
  route: "PATCH /api/v1/reports/{slug}",
  fingerprint: ["abc1234567", "New Title"],
  // The pre-existing suite all describes DERIVED-fallback behaviour, so the
  // default keeps it engaged; the carve-out suite overrides per test.
  derivedFallback: "sound" as const,
  ...over,
});

describe("beginIdempotentWrite (ADR-0039)", () => {
  it("claims a fresh key → proceed with a ref the caller completes inside its transaction", async () => {
    const d = deps();
    const r = await beginIdempotentWrite(d, input());
    expect(r.ok && r.value.outcome).toBe("proceed");
  });

  it("derives the fallback key from user + route + canonical payload — same payload, same key", async () => {
    const d = deps();
    const first = await beginIdempotentWrite(d, input());
    if (!first.ok || first.value.outcome !== "proceed" || !first.value.ref) {
      throw new Error("expected proceed with a claimed ref");
    }
    await d.idempotency.complete(first.value.ref, { responseStatus: 200, responseBody: { a: 1 } });

    const second = await beginIdempotentWrite(d, input());
    expect(second.ok && second.value.outcome).toBe("replay");
    if (second.ok && second.value.outcome === "replay") {
      expect(second.value.record).toEqual({ responseStatus: 200, responseBody: { a: 1 } });
    }
  });

  it("a different canonical payload derives a DIFFERENT key — no false replay", async () => {
    const d = deps();
    await beginIdempotentWrite(d, input());
    const r = await beginIdempotentWrite(d, input({ fingerprint: ["abc1234567", "Other"] }));
    expect(r.ok && r.value.outcome).toBe("proceed");
  });

  it("null/undefined fingerprint segments encode stably (as empty)", async () => {
    const d = deps();
    const first = await beginIdempotentWrite(d, input({ fingerprint: ["x", null, undefined] }));
    if (!first.ok || first.value.outcome !== "proceed" || !first.value.ref) {
      throw new Error("expected proceed with a claimed ref");
    }
    await d.idempotency.complete(first.value.ref, { responseStatus: 204, responseBody: null });
    const again = await beginIdempotentWrite(d, input({ fingerprint: ["x", null, undefined] }));
    expect(again.ok && again.value.outcome).toBe("replay");
  });

  it("an in-flight duplicate maps to err(IdempotencyInFlight) → 409", async () => {
    const d = deps();
    await beginIdempotentWrite(d, input());
    const r = await beginIdempotentWrite(d, input());
    expect(!r.ok && r.error.kind).toBe("IdempotencyInFlight");
  });

  it("an explicit key reused with a different payload → err(IdempotencyKeyReuseDifferentBody) → 422", async () => {
    const d = deps();
    await beginIdempotentWrite(d, input({ key: "client-key-1" }));
    const r = await beginIdempotentWrite(
      d,
      input({ key: "client-key-1", fingerprint: ["abc1234567", "Different"] }),
    );
    expect(!r.ok && r.error.kind).toBe("IdempotencyKeyReuseDifferentBody");
  });

  it("an explicit key scopes the claim — the same payload under a FRESH key proceeds (deliberate re-apply)", async () => {
    const d = deps();
    const first = await beginIdempotentWrite(d, input({ key: "k1" }));
    if (!first.ok || first.value.outcome !== "proceed" || !first.value.ref) {
      throw new Error("expected proceed with a claimed ref");
    }
    await d.idempotency.complete(first.value.ref, { responseStatus: 200, responseBody: {} });
    const r = await beginIdempotentWrite(d, input({ key: "k2" }));
    expect(r.ok && r.value.outcome).toBe("proceed");
  });
});

// ── The state-setting carve-out (issue #233 / GHSA-ghxh-82j4-pp6m) ─────────
//
// The ADR-0039 DERIVED-key fallback is only sound for operations whose
// fingerprint identifies a ONE-SHOT request. For an operation that sets STATE,
// the fingerprint describes the DESIRED state, so A → B → A derives the SAME
// key as the first call and REPLAYS it — the API answers 200 with the old body
// and never re-applies. `idempotency_keys` has no TTL sweep, so that window is
// permanent.
//
// The security-relevant shapes are `revoke-write` and `set-acl`: a revoke fired
// BEFORE the grant exists burns the key, so the real revoke afterwards no-ops
// and the grantee keeps write access. `kind` is a REQUIRED field precisely so
// this is a decision every use case must make, not one it can fall into.
describe("beginIdempotentWrite — state-setting operations skip the derived fallback", () => {
  it("proceeds with NO ref when state-setting and the client sent no key", async () => {
    const d = deps();

    const r = await beginIdempotentWrite(d, input({ derivedFallback: "unsound" }));

    expect(r.ok && r.value.outcome).toBe("proceed");
    // No ref → nothing to complete → no permanent record to replay off later.
    expect(r.ok && r.value.outcome === "proceed" && r.value.ref).toBeUndefined();
  });

  it("THE BUG: A -> B -> A re-applies instead of replaying the first response", async () => {
    const d = deps();
    const at = (visibility: string) =>
      beginIdempotentWrite(d, {
        ...input({ derivedFallback: "unsound" }),
        fingerprint: ["folder-1", visibility],
      });

    const first = await at("org");
    expect(first.ok && first.value.outcome).toBe("proceed");
    const second = await at("private");
    expect(second.ok && second.value.outcome).toBe("proceed");
    const third = await at("org");

    // Under the derived fallback this third call REPLAYED, leaving the folder
    // `private` while the API answered `org`.
    expect(third.ok && third.value.outcome).toBe("proceed");
  });

  it("still honours an EXPLICIT key on a state-setting op — the client owns retry identity", async () => {
    const d = deps();
    const i = input({ derivedFallback: "unsound", key: "client-key-1" });

    const first = await beginIdempotentWrite(d, i);
    expect(first.ok && first.value.outcome === "proceed" && first.value.ref).toBeDefined();
    if (first.ok && first.value.outcome === "proceed" && first.value.ref) {
      await d.idempotency.complete(first.value.ref, { responseStatus: 200, responseBody: {} });
    }

    expect((await beginIdempotentWrite(d, i)).ok && true).toBe(true);
    const replay = await beginIdempotentWrite(d, i);
    expect(replay.ok && replay.value.outcome).toBe("replay");
  });

  it("leaves ONE-SHOT operations on the derived fallback — a repeat still replays", async () => {
    const d = deps();
    const i = input({ derivedFallback: "sound" });

    const first = await beginIdempotentWrite(d, i);
    expect(first.ok && first.value.outcome === "proceed" && first.value.ref).toBeDefined();
    if (first.ok && first.value.outcome === "proceed" && first.value.ref) {
      await d.idempotency.complete(first.value.ref, { responseStatus: 201, responseBody: {} });
    }

    // Creating the same thing twice must NOT create it twice.
    expect((await beginIdempotentWrite(d, i)).ok && (await beginIdempotentWrite(d, i)).ok).toBe(
      true,
    );
    const again = await beginIdempotentWrite(d, i);
    expect(again.ok && again.value.outcome).toBe("replay");
  });
});

describe("reviveReplay", () => {
  it("returns the stored body when the guard accepts it", () => {
    const r = reviveReplay(
      { responseStatus: 200, responseBody: { slug: "s" } },
      (b): b is { slug: string } =>
        typeof b === "object" && b !== null && typeof (b as { slug?: unknown }).slug === "string",
    );
    expect(r.ok && r.value).toEqual({ slug: "s" });
  });

  it("maps a shape mismatch to Unexpected (the store only ever holds bodies we wrote)", () => {
    const r = reviveReplay(
      { responseStatus: 200, responseBody: null },
      (b): b is { x: 1 } => false,
    );
    expect(!r.ok && r.error.kind).toBe("Unexpected");
  });
});

describe("report replay snapshot", () => {
  const aReport = () =>
    createReport({
      id: reportId("00000000-0000-7000-8000-0000000000r1"),
      orgId: orgId("00000000-0000-7000-8000-0000000000a1"),
      folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
      slug: "abc1234567" as never,
      title: "T",
      versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
      contentHash: "h".repeat(64),
      uploadedBy: actingUserId,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    }).report;

  it("round-trips every field the wire mappers serialize", () => {
    const report = aReport();
    const revived = reviveReportReplay({
      responseStatus: 200,
      responseBody: JSON.parse(JSON.stringify(reportReplayBody(report))),
    });
    expect(revived.ok).toBe(true);
    if (!revived.ok) return;
    expect(revived.value.id).toBe(report.id);
    expect(revived.value.slug).toBe(report.slug);
    expect(revived.value.title).toBe(report.title);
    expect(revived.value.ownerId).toBe(report.ownerId);
    expect(revived.value.folderId).toBe(report.folderId);
    expect(revived.value.liveVersionId).toBe(report.liveVersionId);
    expect(revived.value.acl).toEqual(report.acl);
  });

  it("NEVER persists a password hash — a password acl snapshots as its mode alone", () => {
    const report = { ...aReport(), acl: { mode: "password" as const, passwordHash: "argon2$x" } };
    const body = JSON.stringify(reportReplayBody(report));
    expect(body).not.toContain("argon2$x");
    expect(body).not.toContain("passwordHash");
  });

  it("drops version manifests (bulk) — versions revive empty and no mapper needs them", () => {
    const body = reportReplayBody(aReport()) as { versions: unknown };
    expect(body.versions).toEqual([]);
  });

  it("rejects a foreign body shape with Unexpected", () => {
    const r = reviveReportReplay({ responseStatus: 200, responseBody: { nope: true } });
    expect(!r.ok && r.error.kind).toBe("Unexpected");
  });
});

describe("folder replay revival (ADR-0076)", () => {
  const aFolder = {
    id: "00000000-0000-7000-8000-0000000000f1",
    orgId: "00000000-0000-7000-8000-0000000000a1",
    parentId: null,
    ownerId: null,
    visibility: "org",
    name: "Root",
    slug: "root",
    deletedAt: null,
  };

  it("revives a folder body carrying the ADR-0076 visibility field", () => {
    const r = reviveFolderReplay({ responseStatus: 200, responseBody: aFolder });
    expect(r.ok && r.value.visibility).toBe("org");
  });

  it("rejects a STALE pre-ADR-0076 body with no visibility — a spec-required field", () => {
    const { visibility: _dropped, ...stale } = aFolder;
    const r = reviveFolderReplay({ responseStatus: 200, responseBody: stale });
    expect(!r.ok && r.error.kind).toBe("Unexpected");
  });

  it("rejects a body whose visibility is not one of the closed vocabulary", () => {
    const r = reviveFolderReplay({
      responseStatus: 200,
      responseBody: { ...aFolder, visibility: "public" },
    });
    expect(!r.ok && r.error.kind).toBe("Unexpected");
  });
});
