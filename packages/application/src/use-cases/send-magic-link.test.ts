import { createReport, folderId, makeAcl, makeSlug, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  FakeEmailSender,
  FakeNonceStore,
  InMemoryReportRepository,
  SequentialIdGenerator,
} from "../testing/in-memory";
import { sendMagicLink } from "./send-magic-link";

const SLUG = "aaaaaaaaaa";
const ORIGIN = "https://app.example.com";
const SECRET = "magic-secret";

async function seed(mode: "allowlist" | "password" = "allowlist", emails = ["a@b.com"]) {
  const reports = new InMemoryReportRepository();
  const slug = makeSlug(SLUG);
  if (!slug.ok) throw new Error("slug");
  const { report } = createReport({
    id: reportId("00000000-0000-7000-8000-0000000000c1"),
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
  const acl =
    mode === "allowlist"
      ? makeAcl({ mode: "allowlist", allowedEmails: emails, accessTtlSeconds: 3600 })
      : makeAcl({ mode: "password", passwordHash: "h" });
  if (!acl.ok) throw new Error("acl");
  await reports.setAcl(report.id, acl.value);
  return {
    reports,
    email: new FakeEmailSender(),
    nonces: new FakeNonceStore(),
    ids: new SequentialIdGenerator(),
  };
}

const input = (email: string) => ({
  slug: SLUG as never,
  email,
  appOrigin: ORIGIN,
  secret: SECRET,
});

describe("sendMagicLink (ADR-0056)", () => {
  it("sends a link + stores a nonce for an allowlisted email", async () => {
    const { reports, email, nonces, ids } = await seed();
    const r = await sendMagicLink({ reports, nonces, email, ids }, input("a@b.com"));
    expect(r.ok).toBe(true);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe("a@b.com");
    expect(email.sent[0]?.html).toContain(`${ORIGIN}/unlock/${SLUG}?link=`);
    // the nonce was stored (it can be taken once)
    const taken = await nonces.take("nonce-1");
    expect(taken.ok && taken.value).toContain("a@b.com");
  });

  it("normalizes the entered email (case/space) against the allowlist", async () => {
    const { reports, email, nonces, ids } = await seed("allowlist", ["a@b.com"]);
    const r = await sendMagicLink({ reports, nonces, email, ids }, input("  A@B.com "));
    expect(r.ok && email.sent).toHaveLength(1);
  });

  it("does NOT send for a non-allowlisted email — and stays generic (privacy)", async () => {
    const { reports, email, nonces, ids } = await seed("allowlist", ["a@b.com"]);
    const r = await sendMagicLink({ reports, nonces, email, ids }, input("intruder@x.com"));
    expect(r.ok).toBe(true); // no signal that the email isn't on the list
    expect(email.sent).toHaveLength(0);
  });

  it("does NOT send for a non-allowlist report", async () => {
    const { reports, email, nonces, ids } = await seed("password");
    const r = await sendMagicLink({ reports, nonces, email, ids }, input("a@b.com"));
    expect(r.ok && email.sent).toHaveLength(0);
  });
});
