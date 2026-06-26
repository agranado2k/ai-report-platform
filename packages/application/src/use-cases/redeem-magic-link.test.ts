import {
  createReport,
  folderId,
  makeAcl,
  makeSlug,
  mintMagicLinkToken,
  reportId,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  FakeNonceStore,
  FixedClock,
  InMemoryGrantStore,
  InMemoryReportRepository,
} from "../testing/in-memory";
import { redeemMagicLink } from "./redeem-magic-link";

const SLUG = "aaaaaaaaaa";
const SECRET = "magic-secret";
const RID = reportId("00000000-0000-7000-8000-0000000000c1");

async function seed(emails = ["a@b.com"]) {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: RID,
    orgId: reportId("00000000-0000-7000-8000-0000000000a1") as never,
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
  const acl = makeAcl({ mode: "allowlist", allowedEmails: emails, accessTtlSeconds: 3600 });
  if (!acl.ok) throw new Error("acl");
  await reports.setAcl(RID, acl.value);
  const clock = new FixedClock(1000);
  return { reports, nonces: new FakeNonceStore(), grants: new InMemoryGrantStore(clock), clock };
}

async function stage(nonces: FakeNonceStore, nonceId: string, slug: string, email: string) {
  await nonces.put(nonceId, JSON.stringify({ slug, email }), 900);
  return mintMagicLinkToken(nonceId, SECRET);
}

describe("redeemMagicLink (ADR-0056, revocation-C)", () => {
  it("consumes the nonce, creates a live grant, and returns the access data", async () => {
    const { reports, nonces, grants, clock } = await seed();
    const token = await stage(nonces, "n1", SLUG, "a@b.com");

    const r = await redeemMagicLink(
      { reports, nonces, grants, clock },
      { slug: SLUG as never, token, secret: SECRET },
    );
    expect(r.ok && r.value).toEqual({ slug: SLUG, email: "a@b.com", accessTtlSeconds: 3600 });
    const g = await grants.isGranted(RID, "a@b.com");
    expect(g.ok && g.value).toBe(true);
    const n = await nonces.take("n1"); // already consumed by redeem (single-use)
    expect(n.ok && n.value).toBeNull();
  });

  it("rejects an invalid token", async () => {
    const { reports, nonces, grants, clock } = await seed();
    const r = await redeemMagicLink(
      { reports, nonces, grants, clock },
      { slug: SLUG as never, token: "bogus", secret: SECRET },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a reused/expired link (no nonce in the store)", async () => {
    const { reports, nonces, grants, clock } = await seed();
    const token = mintMagicLinkToken("missing", SECRET); // valid signature, no nonce staged
    const r = await redeemMagicLink(
      { reports, nonces, grants, clock },
      { slug: SLUG as never, token, secret: SECRET },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects when the email was removed from the allowlist since send (revocation)", async () => {
    const { reports, nonces, grants, clock } = await seed(["a@b.com"]);
    const token = await stage(nonces, "n1", SLUG, "a@b.com");
    const acl = makeAcl({
      mode: "allowlist",
      allowedEmails: ["someone@x.com"],
      accessTtlSeconds: 3600,
    });
    if (!acl.ok) throw new Error("acl");
    await reports.setAcl(RID, acl.value); // owner removed a@b.com

    const r = await redeemMagicLink(
      { reports, nonces, grants, clock },
      { slug: SLUG as never, token, secret: SECRET },
    );
    expect(r.ok).toBe(false);
    const g = await grants.isGranted(RID, "a@b.com");
    expect(g.ok && g.value).toBe(false); // no grant was created
  });

  it("rejects a slug mismatch (link bound to its report)", async () => {
    const { reports, nonces, grants, clock } = await seed();
    const token = await stage(nonces, "n1", "zzzzzzzzzz", "a@b.com");
    const r = await redeemMagicLink(
      { reports, nonces, grants, clock },
      { slug: SLUG as never, token, secret: SECRET },
    );
    expect(r.ok).toBe(false);
  });
});
