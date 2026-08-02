import type { FolderShare, WriteGrant } from "arp-application";
import type { Folder, Report, Slug } from "arp-domain";
import {
  err,
  folderId,
  folderIdToWire,
  insufficientScope,
  ok,
  orgId,
  reportId,
  reportIdToWire,
  userId,
  userIdToWire,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  createFolderToHttp,
  deleteFolderToHttp,
  deleteReportToHttp,
  getAclToHttp,
  getReportToHttp,
  grantWriteToHttp,
  listFolderSharesToHttp,
  listWriteGrantsToHttp,
  moveReportToHttp,
  renameFolderToHttp,
  renameReportToHttp,
  revokeWriteToHttp,
  setAclToHttp,
  setFolderVisibilityToHttp,
  shareFolderToHttp,
  unshareFolderToHttp,
} from "./write-response";

const CTX = { mode: "prod" as const };
const slug = (s: string): Slug => s as Slug;
const F1 = "00000000-0000-7000-8000-000000000001";
const F2 = "00000000-0000-7000-8000-000000000002";
const O1 = "00000000-0000-7000-8000-0000000000aa";
const R1 = "00000000-0000-7000-8000-0000000000c1";
const U1 = "00000000-0000-7000-8000-0000000000d1";
const V1 = "00000000-0000-7000-8000-0000000000v1".replace(/v/g, "1");

const report = (title: string, folder = F1): Report => ({
  id: reportId(R1),
  orgId: orgId(O1),
  ownerId: userId(U1),
  folderId: folderId(folder),
  slug: slug("aaaaaaaaaa"),
  title,
  liveVersionId: versionId(V1),
  versions: [],
  deletedAt: null,
  acl: { mode: "public" },
});
const reportResource = (title: string, folder = F1) => ({
  object: "report",
  id: reportIdToWire(reportId(R1)),
  slug: "aaaaaaaaaa",
  title,
  is_published: true,
  folder_id: folderIdToWire(folderId(folder)),
  mode: "prod",
  owner: userIdToWire(userId(U1)),
  acl: { mode: "public" },
});
/** The report's owner viewing their own report — sees the acl block. */
const OWNER = { userId: userId(U1) };
/** A same-org colleague — sees the resource WITHOUT the acl block (ADR-0059 §3). */
const COLLEAGUE = { userId: userId("00000000-0000-7000-8000-0000000000d2") };

const folder = (name: string): Folder => ({
  id: folderId(F2),
  orgId: orgId(O1),
  parentId: folderId(F1),
  ownerId: userId(U1),
  visibility: "private",
  name,
  slug: "q1",
  deletedAt: null,
});
const folderResource = (name: string) => ({
  object: "folder",
  id: folderIdToWire(folderId(F2)),
  name,
  slug: "q1",
  parent_id: folderIdToWire(folderId(F1)),
  visibility: "private",
  owner: userIdToWire(userId(U1)),
  mode: "prod",
});

describe("report resource mappers (ADR-0053)", () => {
  it("moveReportToHttp → 200 with the moved report resource", () => {
    const res = moveReportToHttp(ok(report("Moved")), CTX, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(reportResource("Moved"));
    expect(JSON.stringify(res.body)).not.toContain(O1);
  });

  it("renameReportToHttp → 200 with the renamed report resource", () => {
    const res = renameReportToHttp(ok(report("Renamed")), CTX, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(reportResource("Renamed"));
  });

  it("getReportToHttp → 200 with the report resource (owner sees the acl)", () => {
    const res = getReportToHttp(ok(report("A Title")), CTX, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(reportResource("A Title"));
  });

  it("getReportToHttp for a NON-owner org member omits the acl block (ADR-0059 §3)", () => {
    const r = report("A Title");
    const withAllowlist: Report = {
      ...r,
      acl: { mode: "allowlist", allowedEmails: ["secret@example.com"], accessTtlSeconds: 3600 },
    };
    const res = getReportToHttp(ok(withAllowlist), CTX, COLLEAGUE);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("acl");
    // owner stays org-visible (ADR-0059 §6) …
    expect(res.body).toHaveProperty("owner", userIdToWire(userId(U1)));
    // … but the share config never leaks to a colleague.
    expect(JSON.stringify(res.body)).not.toContain("secret@example.com");
  });

  it("getReportToHttp with no viewer identity omits the acl block (fail closed)", () => {
    const res = getReportToHttp(ok(report("A Title")), CTX);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("acl");
  });

  it("getReportToHttp NotFound → 404 problem", () => {
    const res = getReportToHttp(err({ kind: "NotFound", message: "x" }), CTX);
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("application/problem+json");
  });

  it("deleteReportToHttp → 204 no body", () => {
    const res = deleteReportToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("setAclToHttp → 200 with the report's acl; the password hash NEVER leaks", () => {
    const pw: Report = {
      ...report("Shared"),
      acl: { mode: "password", passwordHash: "$argon2id$secret" },
    };
    const res = setAclToHttp(ok(pw), CTX, OWNER);
    expect(res.status).toBe(200);
    expect((res.body as { acl: unknown }).acl).toEqual({ mode: "password" });
    expect(JSON.stringify(res.body)).not.toContain("argon2id");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("setAclToHttp → allowlist surfaces allowed_emails + access_ttl_seconds (snake_case)", () => {
    const al: Report = {
      ...report("Shared"),
      acl: { mode: "allowlist", allowedEmails: ["a@b.com", "c@d.io"], accessTtlSeconds: 86_400 },
    };
    const res = setAclToHttp(ok(al), CTX, OWNER);
    expect((res.body as { acl: unknown }).acl).toEqual({
      mode: "allowlist",
      allowed_emails: ["a@b.com", "c@d.io"],
      access_ttl_seconds: 86_400,
    });
  });
});

describe("folder resource mappers (ADR-0053)", () => {
  it("createFolderToHttp → 201 with the folder resource (no org id)", () => {
    const res = createFolderToHttp(ok(folder("Q1")), CTX);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(folderResource("Q1"));
    expect(JSON.stringify(res.body)).not.toContain(O1);
  });

  it("renameFolderToHttp → 200 with the folder resource", () => {
    const res = renameFolderToHttp(ok(folder("Renamed")), CTX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(folderResource("Renamed"));
  });

  it("createFolderToHttp ValidationError → 422 problem", () => {
    const res = createFolderToHttp(err({ kind: "ValidationError", message: "too deep" }), CTX);
    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
  });

  it("deleteFolderToHttp → 204 no body", () => {
    const res = deleteFolderToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("getAclToHttp public → 200 { object: acl, mode }", () => {
    const res = getAclToHttp(ok(report("R")));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ object: "acl", mode: "public" });
  });

  it("getAclToHttp allowlist → surfaces allowed_emails + access_ttl_seconds (no hash)", () => {
    const allowlistReport: Report = {
      ...report("R"),
      acl: { mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 604800 },
    };
    const res = getAclToHttp(ok(allowlistReport));
    expect(res.body).toEqual({
      object: "acl",
      mode: "allowlist",
      allowed_emails: ["a@b.com"],
      access_ttl_seconds: 604800,
    });
  });

  it("getAclToHttp NotFound → problem passthrough", () => {
    const res = getAclToHttp(err({ kind: "NotFound", message: "no report" }));
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("write-grant resource mappers (ADR-0060)", () => {
  const grant: WriteGrant = {
    reportId: reportId(R1),
    granteeEmail: "grantee@x.com",
    granteeUserId: null,
    grantedBy: userId(U1),
    grantedAt: 1_700_000_000_000,
  };

  it("grantWriteToHttp → 201 with the write_grant resource, no surrogate id", () => {
    const res = grantWriteToHttp(ok(grant));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      object: "write_grant",
      email: "grantee@x.com",
      granted_by: userIdToWire(userId(U1)),
      granted_at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("grantWriteToHttp with the entry-URL opts → the resource carries open_url (the grantee's editor entry)", () => {
    const res = grantWriteToHttp(ok(grant), {
      appOrigin: "https://app.example.test",
      slug: "abcde12345",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      object: "write_grant",
      email: "grantee@x.com",
      granted_by: userIdToWire(userId(U1)),
      granted_at: new Date(1_700_000_000_000).toISOString(),
      open_url: "https://app.example.test/reports/abcde12345/open",
    });
  });

  it("grantWriteToHttp NotAllowed (non-owner) → 403 problem", () => {
    const res = grantWriteToHttp(
      err({ kind: "NotAllowed", message: "you do not own this report" }),
    );
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });

  it("revokeWriteToHttp → 204 no body", () => {
    const res = revokeWriteToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("listWriteGrantsToHttp → 200 list envelope of write_grant resources", () => {
    const second: WriteGrant = {
      ...grant,
      granteeEmail: "second@x.com",
      granteeUserId: userId(U1),
    };
    const res = listWriteGrantsToHttp(ok([grant, second]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      has_more: false,
      data: [
        {
          object: "write_grant",
          email: "grantee@x.com",
          granted_by: userIdToWire(userId(U1)),
          granted_at: new Date(1_700_000_000_000).toISOString(),
        },
        {
          object: "write_grant",
          email: "second@x.com",
          granted_by: userIdToWire(userId(U1)),
          granted_at: new Date(1_700_000_000_000).toISOString(),
        },
      ],
    });
  });

  it("listWriteGrantsToHttp InsufficientScope → 403 problem", () => {
    const res = listWriteGrantsToHttp(err(insufficientScope("acl:write")));
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("folder share mappers (ADR-0076)", () => {
  const share: FolderShare = {
    folderId: folderId(F2),
    granteeEmail: "pal@x.com",
    granteeUserId: null,
    grantedBy: userId(U1),
    grantedAt: 1_700_000_000_000,
  };

  it("setFolderVisibilityToHttp → 200 with the folder resource (visibility + owner on the wire)", () => {
    const res = setFolderVisibilityToHttp(ok(folder("Q1")), CTX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(folderResource("Q1"));
  });

  it("setFolderVisibilityToHttp ValidationError (Root → private) → 422 problem", () => {
    const res = setFolderVisibilityToHttp(
      err({ kind: "ValidationError", message: "the Root folder is always org-visible" }),
      CTX,
    );
    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
  });

  it("shareFolderToHttp → 201 with the folder_share resource, no surrogate id", () => {
    const res = shareFolderToHttp(ok(share));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      object: "folder_share",
      email: "pal@x.com",
      granted_by: userIdToWire(userId(U1)),
      granted_at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("unshareFolderToHttp → 204 No Content", () => {
    const res = unshareFolderToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("listFolderSharesToHttp → 200 list envelope of folder_share resources", () => {
    const res = listFolderSharesToHttp(ok([share]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      has_more: false,
      data: [
        {
          object: "folder_share",
          email: "pal@x.com",
          granted_by: userIdToWire(userId(U1)),
          granted_at: new Date(1_700_000_000_000).toISOString(),
        },
      ],
    });
  });

  it("shareFolderToHttp NotAllowed (non-owner) → 403 problem", () => {
    const res = shareFolderToHttp(
      err({ kind: "NotAllowed", message: "only the folder's owner can manage its sharing" }),
    );
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});
