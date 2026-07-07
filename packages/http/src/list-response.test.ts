import type { FolderPage, ReportPage, VersionPage } from "arp-application";
import type { Folder, Slug } from "arp-domain";
import {
  err,
  folderId,
  folderIdToWire,
  ok,
  orgId,
  reportId,
  reportIdToWire,
  userId,
  userIdToWire,
  versionId,
  versionIdToWire,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { listFoldersToHttp, listReportVersionsToHttp, searchReportsToHttp } from "./list-response";

const CTX = { mode: "prod" as const };
const slug = (s: string): Slug => s as Slug;
const F1 = "00000000-0000-7000-8000-000000000001";
const F2 = "00000000-0000-7000-8000-000000000002";
const O1 = "00000000-0000-7000-8000-0000000000aa";
const R1 = "00000000-0000-7000-8000-0000000000c1";
const V1 = "00000000-0000-7000-8000-0000000000e1";
const U1 = "00000000-0000-7000-8000-0000000000d1";

describe("listFoldersToHttp (Stripe list envelope, ADR-0053)", () => {
  it("maps a folder page to {object:list, data, has_more} with folder resources", () => {
    const folders: Folder[] = [
      {
        id: folderId(F1),
        orgId: orgId(O1),
        parentId: null,
        name: "Root",
        slug: "root",
        deletedAt: null,
      },
      {
        id: folderId(F2),
        orgId: orgId(O1),
        parentId: folderId(F1),
        name: "Q1",
        slug: "q1",
        deletedAt: null,
      },
    ];
    const page: FolderPage = { items: folders, hasMore: true };
    const res = listFoldersToHttp(ok(page), CTX);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      has_more: true,
      data: [
        {
          object: "folder",
          id: folderIdToWire(folderId(F1)),
          name: "Root",
          slug: "root",
          parent_id: null,
          mode: "prod",
        },
        {
          object: "folder",
          id: folderIdToWire(folderId(F2)),
          name: "Q1",
          slug: "q1",
          parent_id: folderIdToWire(folderId(F1)),
          mode: "prod",
        },
      ],
    });
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(O1); // never leak the internal org id
    expect(wire).not.toContain(F1); // bare uuid never appears — only folder_…
  });

  it("maps an error to a problem response", () => {
    const res = listFoldersToHttp(err({ kind: "NotAllowed", message: "nope" }), CTX);
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("searchReportsToHttp (Stripe list envelope, ADR-0053)", () => {
  it("maps a report page to {object:list, data, has_more} with report resources", () => {
    const page: ReportPage = {
      items: [
        {
          id: reportId(R1),
          slug: slug("aaaaaaaaaa"),
          title: "First",
          isPublished: true,
          folderId: folderId(F1),
        },
      ],
      hasMore: false,
    };
    const res = searchReportsToHttp(ok(page), CTX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      has_more: false,
      data: [
        {
          object: "report",
          id: reportIdToWire(reportId(R1)),
          slug: "aaaaaaaaaa",
          title: "First",
          is_published: true,
          folder_id: folderIdToWire(folderId(F1)),
          mode: "prod",
        },
      ],
    });
  });

  it("stamps mode:dev when the context says so", () => {
    const page: ReportPage = {
      items: [
        {
          id: reportId(R1),
          slug: slug("aaaaaaaaaa"),
          title: "x",
          isPublished: false,
          folderId: folderId(F1),
        },
      ],
      hasMore: false,
    };
    const res = searchReportsToHttp(ok(page), { mode: "dev" });
    expect((res.body as { data: { mode: string }[] }).data[0]?.mode).toBe("dev");
  });

  it("maps an error to a problem response", () => {
    const res = searchReportsToHttp(err({ kind: "Unexpected", message: "boom" }), CTX);
    expect(res.status).toBe(500);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("listReportVersionsToHttp (ADR-0065 list envelope)", () => {
  it("maps a version page to {object:list, data, has_more} with version resources", () => {
    const page: VersionPage = {
      items: [
        {
          id: versionId(V1),
          versionNo: 2,
          uploadedBy: userId(U1),
          uploadedAt: 1_700_000_000_000,
          scanStatus: "clean",
          sizeBytes: 1234,
          origin: "upload",
        },
      ],
      hasMore: true,
    };
    const res = listReportVersionsToHttp(ok(page), CTX);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      has_more: true,
      data: [
        {
          object: "version",
          id: versionIdToWire(versionId(V1)),
          version_no: 2,
          uploaded_by: userIdToWire(userId(U1)),
          uploaded_at: 1_700_000_000_000,
          scan_status: "clean",
          size_bytes: 1234,
          origin: "upload",
          mode: "prod",
        },
      ],
    });
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(V1); // bare uuid never appears — only version_…
    expect(wire).not.toContain(U1); // bare uuid never appears — only user_…
  });

  it("maps an error to a problem response", () => {
    const res = listReportVersionsToHttp(err({ kind: "NotFound", message: "nope" }), CTX);
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("application/problem+json");
  });
});
