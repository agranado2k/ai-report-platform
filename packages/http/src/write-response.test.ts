import type { Folder, FolderId, Report, Slug } from "arp-domain";
import { err, folderId, ok, orgId, reportId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  createFolderToHttp,
  deleteFolderToHttp,
  deleteReportToHttp,
  moveReportToHttp,
  renameFolderToHttp,
  renameReportToHttp,
} from "./write-response";

const slug = (s: string): Slug => s as Slug;
const F1 = "00000000-0000-7000-8000-000000000001";
const F2 = "00000000-0000-7000-8000-000000000002";
const O1 = "00000000-0000-7000-8000-0000000000aa";

describe("moveReportToHttp", () => {
  it("maps ok to 200 echoing the new placement (snake_case)", () => {
    const res = moveReportToHttp(ok(undefined), {
      slug: slug("aaaaaaaaaa"),
      folderId: folderId(F2) as FolderId,
    });
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    expect(res.body).toEqual({ slug: "aaaaaaaaaa", folder_id: F2 });
  });

  it("maps NotFound to a 404 problem", () => {
    const res = moveReportToHttp(err({ kind: "NotFound", message: "no report" }), {
      slug: slug("aaaaaaaaaa"),
      folderId: folderId(F2) as FolderId,
    });
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("createFolderToHttp", () => {
  it("maps ok to 201 with the created folder, exposing no org id", () => {
    const folder: Folder = {
      id: folderId(F2),
      orgId: orgId(O1),
      parentId: folderId(F1),
      name: "Q1",
      slug: "q1",
      deletedAt: null,
    };
    const res = createFolderToHttp(ok(folder));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: F2, name: "Q1", slug: "q1", parent_id: F1 });
    expect(JSON.stringify(res.body)).not.toContain(O1);
  });

  it("maps ValidationError to a 422 problem", () => {
    const res = createFolderToHttp(
      err({ kind: "ValidationError", message: "too deep", field: "parentId" }),
    );
    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("renameFolderToHttp", () => {
  it("maps ok to 200 with the renamed folder", () => {
    const folder: Folder = {
      id: folderId(F2),
      orgId: orgId(O1),
      parentId: folderId(F1),
      name: "Renamed",
      slug: "old-slug",
      deletedAt: null,
    };
    const res = renameFolderToHttp(ok(folder));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: F2, name: "Renamed", slug: "old-slug", parent_id: F1 });
  });

  it("maps NotFound to a 404 problem", () => {
    const res = renameFolderToHttp(err({ kind: "NotFound", message: "gone" }));
    expect(res.status).toBe(404);
  });
});

describe("deleteFolderToHttp", () => {
  it("maps ok to 204 with no body", () => {
    const res = deleteFolderToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("maps a non-empty-folder ValidationError to 422", () => {
    const res = deleteFolderToHttp(
      err({ kind: "ValidationError", message: "folder is not empty" }),
    );
    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("renameReportToHttp", () => {
  const report: Report = {
    id: reportId("00000000-0000-7000-8000-0000000000r1"),
    orgId: orgId(O1),
    folderId: folderId(F1),
    slug: "aaaaaaaaaa" as Slug,
    title: "Renamed",
    liveVersionId: versionId("00000000-0000-7000-8000-0000000000v1"),
    versions: [],
    deletedAt: null,
  };

  it("maps ok to 200 with the report summary (no org id)", () => {
    const res = renameReportToHttp(ok(report));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      slug: "aaaaaaaaaa",
      title: "Renamed",
      is_published: true,
      folder_id: F1,
    });
    expect(JSON.stringify(res.body)).not.toContain(O1);
  });

  it("maps ValidationError to a 422 problem", () => {
    const res = renameReportToHttp(err({ kind: "ValidationError", message: "title required" }));
    expect(res.status).toBe(422);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("deleteReportToHttp", () => {
  it("maps ok to 204 with no body", () => {
    const res = deleteReportToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("maps NotFound to a 404 problem", () => {
    const res = deleteReportToHttp(err({ kind: "NotFound", message: "gone" }));
    expect(res.status).toBe(404);
  });
});
