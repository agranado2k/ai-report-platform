import type { Folder, Slug } from "arp-domain";
import { err, folderId, folderIdToWire, ok, orgId, reportId, reportIdToWire } from "arp-domain";
import { describe, expect, it } from "vitest";
import { listFoldersToHttp, searchReportsToHttp } from "./list-response";

const slug = (s: string): Slug => s as Slug;
const F1 = "00000000-0000-7000-8000-000000000001";
const F2 = "00000000-0000-7000-8000-000000000002";
const O1 = "00000000-0000-7000-8000-0000000000aa";
const R1 = "00000000-0000-7000-8000-0000000000c1";

describe("listFoldersToHttp", () => {
  it("maps folders to a 200 JSON body with prefixed External Ids, no org id", () => {
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
        { id: folderIdToWire(folderId(F1)), name: "Root", slug: "root", parent_id: null },
        {
          id: folderIdToWire(folderId(F2)),
          name: "Q1",
          slug: "q1",
          parent_id: folderIdToWire(folderId(F1)),
        },
      ],
    });
    // never leak the internal org id OR a bare uuid over the wire
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain(O1);
    expect(wire).not.toContain(F1); // the bare uuid must not appear — only folder_…
    expect(wire).toContain("folder_");
  });

  it("maps an error to a problem response", () => {
    const res = listFoldersToHttp(err({ kind: "NotAllowed", message: "nope" }));
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("searchReportsToHttp", () => {
  it("maps a page to 200 with prefixed report + folder ids + paging metadata", () => {
    const res = searchReportsToHttp(
      ok({
        items: [
          {
            id: reportId(R1),
            slug: slug("aaaaaaaaaa"),
            title: "First",
            isPublished: true,
            folderId: folderId(F1),
          },
        ],
        total: 42,
        page: 2,
        pageSize: 20,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reports: [
        {
          id: reportIdToWire(reportId(R1)),
          slug: "aaaaaaaaaa",
          title: "First",
          is_published: true,
          folder_id: folderIdToWire(folderId(F1)),
        },
      ],
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
