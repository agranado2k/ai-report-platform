// Unit tests for the owner-open decision — the ADR-0059 §4 security keystone.
// The 24h `owner:true` token bypasses every share gate, so the mint MUST be
// gated on report.ownerId === actor.userId, not on org membership.
import { InMemoryReportRepository } from "arp-application/testing";
import {
  createReport,
  folderId,
  makeSlug,
  orgId,
  readAccessToken,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { OWNER_TTL_SECONDS, ownerOpenLocation } from "./open-report.server";

const ORG = orgId("00000000-0000-7000-8000-0000000000a1");
const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const COLLEAGUE = userId("00000000-0000-7000-8000-0000000000d2");
const SECRET = "test-secret";
const VIEW = "https://view.example.com";
const NOW = 1_750_000_000_000;

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}

async function seededReports(slugStr: string) {
  const reports = new InMemoryReportRepository();
  await reports.save(
    createReport({
      id: reportId("00000000-0000-7000-8000-0000000000c1"),
      orgId: ORG,
      folderId: folderId("00000000-0000-7000-8000-0000000000f1"),
      slug: slug(slugStr),
      title: "T",
      versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
      contentHash: "h".repeat(64),
      uploadedBy: OWNER,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    }).report,
  );
  return reports;
}

function makeDeps(reports: InMemoryReportRepository) {
  const logged: unknown[] = [];
  return {
    deps: {
      reports,
      now: () => NOW,
      log: (fields: Record<string, unknown>, msg: string) => logged.push({ fields, msg }),
    },
    logged,
  };
}

describe("ownerOpenLocation (ADR-0059 §4 — the owner-token mint gate)", () => {
  it("mints an owner:true token for the OWNER and redirects to the viewer", async () => {
    const reports = await seededReports("aaaaaaaaaa");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "aaaaaaaaaa",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location.startsWith(`${VIEW}/aaaaaaaaaa?access=`)).toBe(true);
    const token = decodeURIComponent(location.split("?access=")[1] ?? "");
    const claims = readAccessToken(token, "aaaaaaaaaa", SECRET, Math.floor(NOW / 1000));
    expect(claims).toMatchObject({ slug: "aaaaaaaaaa", owner: true });
    expect(logged).toHaveLength(1); // the privileged mint is audited
  });

  it("KEYSTONE: a same-org non-owner is bounced to the dashboard — no token", async () => {
    const reports = await seededReports("bbbbbbbbbb");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: COLLEAGUE }, // same org, NOT the owner
      rawHandle: "bbbbbbbbbb",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
    expect(logged).toHaveLength(0);
  });

  it("bounces an unauthenticated request to the dashboard", async () => {
    const reports = await seededReports("cccccccccc");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: null,
      rawHandle: "cccccccccc",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
  });

  it("bounces an unknown handle to the dashboard (never reveals existence)", async () => {
    const reports = new InMemoryReportRepository();
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "!!invalid!!",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    expect(location).toBe("/");
  });

  it("falls through to the gated viewer when no secret is configured (previews/dev)", async () => {
    const reports = await seededReports("dddddddddd");
    const { deps, logged } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "dddddddddd",
      viewOrigin: VIEW,
      secret: undefined,
    });
    expect(location).toBe(`${VIEW}/dddddddddd`);
    expect(logged).toHaveLength(0);
  });

  it("the minted token expires after 24h", async () => {
    const reports = await seededReports("eeeeeeeeee");
    const { deps } = makeDeps(reports);
    const location = await ownerOpenLocation(deps, {
      actor: { orgId: ORG, userId: OWNER },
      rawHandle: "eeeeeeeeee",
      viewOrigin: VIEW,
      secret: SECRET,
    });
    const token = decodeURIComponent(location.split("?access=")[1] ?? "");
    const nowSeconds = Math.floor(NOW / 1000);
    expect(
      readAccessToken(token, "eeeeeeeeee", SECRET, nowSeconds + OWNER_TTL_SECONDS - 1),
    ).not.toBeNull();
    expect(
      readAccessToken(token, "eeeeeeeeee", SECRET, nowSeconds + OWNER_TTL_SECONDS + 1),
    ).toBeNull();
  });
});
