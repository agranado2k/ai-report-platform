import type { Folder, Slug } from "arp-domain";
import { err, folderId, ok, orgId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { listFoldersToHttp, searchReportsToHttp } from "./list-response";

const slug = (s: string): Slug => s as Slug;

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

describe("searchReportsToHttp", () => {
  it("maps a page to 200 with reports + paging metadata", () => {
    const res = searchReportsToHttp(
      ok({
        items: [
          { slug: slug("aaaaaaaaaa"), title: "First", isPublished: true, folderId: folderId(F1) },
        ],
        total: 42,
        page: 2,
        pageSize: 20,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reports: [{ slug: "aaaaaaaaaa", title: "First", is_published: true, folder_id: F1 }],
      page: 2,
      page_size: 20,
      total: 42,
    });
  });

  it("maps an error to a problem response", () => {
    const res = searchReportsToHttp(err({ kind: "Unexpected", message: "boom" }));
    expect(res.status).toBe(500);
    expect(res.contentType).toBe("application/problem+json");
  });
});
