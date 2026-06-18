import type { ReportSummary } from "arp-application";
import type { Folder, Slug } from "arp-domain";
import { err, folderId, ok, orgId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { listFoldersToHttp, listReportsToHttp } from "./list-response";

const slug = (s: string): Slug => s as Slug;

describe("listReportsToHttp", () => {
  it("maps an ok list to a 200 JSON body with snake_case fields", () => {
    const summaries: ReportSummary[] = [
      { slug: slug("aaaaaaaaaa"), title: "First", isPublished: true, folderId: folderId(F1) },
      { slug: slug("bbbbbbbbbb"), title: "Second", isPublished: false, folderId: folderId(F1) },
    ];
    const res = listReportsToHttp(ok(summaries));

    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    expect(res.body).toEqual({
      reports: [
        { slug: "aaaaaaaaaa", title: "First", is_published: true, folder_id: F1 },
        { slug: "bbbbbbbbbb", title: "Second", is_published: false, folder_id: F1 },
      ],
    });
  });

  it("maps an empty list to a 200 with an empty array", () => {
    const res = listReportsToHttp(ok([]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reports: [] });
  });

  it("maps an Unexpected error to a 500 problem with a redacted detail", () => {
    const res = listReportsToHttp(err({ kind: "Unexpected", message: "raw driver text" }));
    expect(res.status).toBe(500);
    expect(res.contentType).toBe("application/problem+json");
    expect(res.body).toMatchObject({
      code: "internal_error",
      detail: "An unexpected error occurred.",
    });
  });
});

describe("listFoldersToHttp", () => {
  it("maps folders to a 200 JSON body, exposing no org id", () => {
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
    const res = listFoldersToHttp(ok(folders));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      folders: [
        { id: F1, name: "Root", slug: "root", parent_id: null },
        { id: F2, name: "Q1", slug: "q1", parent_id: F1 },
      ],
    });
    // never leak the internal org id over the wire
    expect(JSON.stringify(res.body)).not.toContain(O1);
  });

  it("maps an error to a problem response", () => {
    const res = listFoldersToHttp(err({ kind: "NotAllowed", message: "nope" }));
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});

const F1 = "00000000-0000-7000-8000-000000000001";
const F2 = "00000000-0000-7000-8000-000000000002";
const O1 = "00000000-0000-7000-8000-0000000000aa";
