import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { FakePasswordHasher, InMemoryReportRepository } from "../testing/in-memory";
import { setAcl } from "./set-acl";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const SLUG = "aaaaaaaaaa";
const ACTOR = { orgId: ORG, scopes: ["acl:write"] };

async function seed(reportOrg = ORG) {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
    orgId: reportOrg,
    folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
    slug: slug.value,
    title: "T",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  });
  await reports.save(report);
  return { reports, hasher: new FakePasswordHasher() };
}

describe("setAcl use case (ADR-0056)", () => {
  it("requires the acl:write scope", async () => {
    const { reports, hasher } = await seed();
    const r = await setAcl(
      { reports, hasher },
      { orgId: ORG, scopes: [] },
      {
        slug: SLUG as never,
        mode: "org",
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InsufficientScope");
  });

  it("password mode hashes the plaintext and persists it (never stores plaintext)", async () => {
    const { reports, hasher } = await seed();
    const r = await setAcl({ reports, hasher }, ACTOR, {
      slug: SLUG as never,
      mode: "password",
      password: "hunter2",
    });
    expect(r.ok && r.value.acl).toEqual({ mode: "password", passwordHash: "hashed:hunter2" });
    // and it round-trips through the repo
    const loaded = await reports.findBySlug(SLUG as never);
    expect(loaded.ok && loaded.value?.acl).toEqual({
      mode: "password",
      passwordHash: "hashed:hunter2",
    });
  });

  it("password mode without a password is a ValidationError", async () => {
    const { reports, hasher } = await seed();
    const r = await setAcl({ reports, hasher }, ACTOR, { slug: SLUG as never, mode: "password" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("allowlist normalizes emails; empty list is a ValidationError", async () => {
    const { reports, hasher } = await seed();
    const ok = await setAcl({ reports, hasher }, ACTOR, {
      slug: SLUG as never,
      mode: "allowlist",
      allowedEmails: ["A@B.com", " a@b.com "],
    });
    expect(ok.ok && ok.value.acl).toEqual({ mode: "allowlist", allowedEmails: ["a@b.com"] });
    const bad = await setAcl({ reports, hasher }, ACTOR, {
      slug: SLUG as never,
      mode: "allowlist",
      allowedEmails: [],
    });
    expect(bad.ok).toBe(false);
  });

  it("sets public / org with no extra data", async () => {
    const { reports, hasher } = await seed();
    const r = await setAcl({ reports, hasher }, ACTOR, { slug: SLUG as never, mode: "public" });
    expect(r.ok && r.value.acl).toEqual({ mode: "public" });
  });

  it("rejects a report in another org (NotAllowed) and an unknown slug (NotFound)", async () => {
    const { reports, hasher } = await seed(orgId("00000000-0000-7000-8000-0000000000a2"));
    const notMine = await setAcl({ reports, hasher }, ACTOR, { slug: SLUG as never, mode: "org" });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.kind).toBe("NotAllowed");

    const missing = await setAcl({ reports, hasher }, ACTOR, {
      slug: "zzzzzzzzzz" as never,
      mode: "org",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("NotFound");
  });
});
