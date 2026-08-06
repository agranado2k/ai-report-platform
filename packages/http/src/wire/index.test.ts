// The wire catalog (`arp-http/wire`) is the single source of truth for the
// `/api/v1` success wire shapes (ADR-0052 prefixed ids, ADR-0053 envelopes).
// These tests pin the COMPILE-TIME link: the resource.ts / diff-response.ts /
// write-response.ts encoders are typed AGAINST the catalog, so any drift
// between what the server emits and what the catalog declares fails typecheck
// (`expectTypeOf` assertions + typed `expected` literals), while the runtime
// assertions lock the emitted key sets and defaults (e.g. `author` is ALWAYS
// present, `edited_at` is ALWAYS present — the truths the viewer's old
// hand-mirrored types hedged on).
import type { ReportVersionSummary, WriteGrant } from "arp-application";
import type { Comment, Report } from "arp-domain";
import {
  commentId,
  commentIdToWire,
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
import { describe, expect, expectTypeOf, it } from "vitest";
import { reportDiffToHttp } from "../diff-response";
import { commentBody, folderBody, listBody, reportBody, versionBody } from "../resource";
import { getAclToHttp, getReportToHttp, grantWriteToHttp } from "../write-response";
import type {
  AclSharingWire,
  AclWire,
  CommentWire,
  DiffWire,
  FolderWire,
  ListEnvelope,
  ReportDetailWire,
  ReportSharingWire,
  ReportWire,
  VersionWire,
  WriteGrantWire,
} from "./index";

const CTX = { mode: "prod" as const };
const F1 = "00000000-0000-7000-8000-000000000001";
const O1 = "00000000-0000-7000-8000-0000000000aa";
const R1 = "00000000-0000-7000-8000-0000000000c1";
const U1 = "00000000-0000-7000-8000-0000000000d1";
const V1 = "00000000-0000-7000-8000-0000000000e1";
const V2 = "00000000-0000-7000-8000-0000000000e2";
const C1 = "00000000-0000-7000-8000-0000000000f1";

describe("wire catalog ⇄ encoder link (compile-time)", () => {
  it("types every resource encoder against its catalog shape", () => {
    expectTypeOf(reportBody).returns.toEqualTypeOf<ReportWire>();
    expectTypeOf(folderBody).returns.toEqualTypeOf<FolderWire>();
    expectTypeOf(versionBody).returns.toEqualTypeOf<VersionWire>();
    expectTypeOf(commentBody).returns.toEqualTypeOf<CommentWire>();
    expectTypeOf(listBody<ReportWire>).returns.toEqualTypeOf<ListEnvelope<ReportWire>>();
  });
});

describe("wire catalog ⇄ emitted shape (runtime truths)", () => {
  it("reportBody emits exactly the ReportWire summary shape", () => {
    const expected: ReportWire = {
      object: "report",
      id: reportIdToWire(reportId(R1)),
      slug: "aaaaaaaaaa",
      title: "T",
      is_published: true,
      folder_id: folderIdToWire(folderId(F1)),
      editability: "unsplittable",
      mode: "prod",
    };
    expect(
      reportBody(
        {
          id: reportId(R1),
          slug: "aaaaaaaaaa" as Report["slug"],
          title: "T",
          isPublished: true,
          folderId: folderId(F1),
          editability: "unsplittable",
        },
        CTX,
      ),
    ).toEqual(expected);
  });

  it("reportBody emits `editability: null` for the UNKNOWN state, never omits it", () => {
    // ADR-0080: a client must be able to tell "nobody probed this" apart from
    // "this is editable". Omitting the key would collapse the two.
    const body = reportBody(
      {
        id: reportId(R1),
        slug: "aaaaaaaaaa" as Report["slug"],
        title: "T",
        isPublished: true,
        folderId: folderId(F1),
        editability: null,
      },
      CTX,
    );
    expect("editability" in body).toBe(true);
    expect(body.editability).toBeNull();
  });

  it("commentBody ALWAYS emits `author` and `edited_at` (null-filled, never omitted)", () => {
    const comment: Comment = {
      id: commentId(C1),
      reportId: reportId(R1),
      authorUserId: userId(U1),
      body: "Nice chart.",
      anchor: { versionPinned: { versionId: versionId(V1), textQuote: "q" } },
      parentCommentId: null,
      intent: "note",
      editedAt: null,
      resolvedAt: null,
      createdAt: 1_752_000_000_000,
    };
    const expected: CommentWire = {
      object: "comment",
      id: commentIdToWire(commentId(C1)),
      report_id: reportIdToWire(reportId(R1)),
      author_id: userIdToWire(userId(U1)),
      author: { id: userIdToWire(userId(U1)), email: null, name: null },
      parent_id: null,
      body: "Nice chart.",
      intent: "note",
      anchor: { version_pinned: { version_id: versionIdToWire(versionId(V1)), text_quote: "q" } },
      edited_at: null,
      resolved_at: null,
      created_at: new Date(1_752_000_000_000).toISOString(),
      mode: "prod",
    };
    expect(commentBody(comment, CTX)).toEqual(expected);
  });

  it("versionBody ALWAYS emits `author` (null-filled when unresolved)", () => {
    const summary: ReportVersionSummary = {
      id: versionId(V1),
      versionNo: 3,
      uploadedBy: userId(U1),
      uploadedAt: 1_752_000_000_000,
      scanStatus: "clean",
      sizeBytes: 4096,
      origin: "upload",
      editability: "editable",
    };
    const expected: VersionWire = {
      object: "version",
      id: versionIdToWire(versionId(V1)),
      version_no: 3,
      uploaded_by: userIdToWire(userId(U1)),
      author: { id: userIdToWire(userId(U1)), email: null, name: null },
      uploaded_at: new Date(1_752_000_000_000).toISOString(),
      scan_status: "clean",
      size_bytes: 4096,
      origin: "upload",
      editability: "editable",
      mode: "prod",
    };
    expect(versionBody(summary, CTX)).toEqual(expected);
  });

  it("reportDiffToHttp emits exactly the DiffWire shape", () => {
    const expected: DiffWire = {
      object: "report_diff",
      diff_mode: "structural",
      html: "<p>hi</p>",
      label: null,
      from: { id: versionIdToWire(versionId(V1)), version_no: 1 },
      to: { id: versionIdToWire(versionId(V2)), version_no: 2 },
      mode: "prod",
    };
    const res = reportDiffToHttp(
      ok({
        mode: "structural",
        html: "<p>hi</p>",
        label: null,
        fromVersionId: versionId(V1),
        toVersionId: versionId(V2),
        fromVersionNo: 1,
        toVersionNo: 2,
      }),
      CTX,
    );
    expect(res.body).toEqual(expected);
  });

  const report: Report = {
    id: reportId(R1),
    orgId: orgId(O1),
    ownerId: userId(U1),
    folderId: folderId(F1),
    slug: "aaaaaaaaaa" as Report["slug"],
    title: "T",
    liveVersionId: versionId(V1),
    versions: [],
    deletedAt: null,
    acl: { mode: "allowlist", allowedEmails: ["a@example.com"], accessTtlSeconds: 604_800 },
  };

  it("getAclToHttp emits exactly the AclSharingWire resource (allowlist branch)", () => {
    const expected: AclSharingWire = {
      object: "acl",
      mode: "allowlist",
      allowed_emails: ["a@example.com"],
      access_ttl_seconds: 604_800,
      // An advanced mode is in NO three-state sharing state — null, never
      // rounded down to `private` (ADR-0078 §13).
      sharing: null,
    };
    expect(getAclToHttp(ok({ report, sharing: null })).body).toEqual(expected);
  });

  it("getReportToHttp (owner view) emits exactly the ReportSharingWire shape", () => {
    const expected: ReportSharingWire = {
      object: "report",
      id: reportIdToWire(reportId(R1)),
      slug: "aaaaaaaaaa",
      title: "T",
      is_published: true,
      folder_id: folderIdToWire(folderId(F1)),
      editability: null,
      mode: "prod",
      owner: userIdToWire(userId(U1)),
      acl: { mode: "allowlist", allowed_emails: ["a@example.com"], access_ttl_seconds: 604_800 },
      sharing: null,
    };
    expect(
      getReportToHttp(ok({ report, sharing: null }), CTX, { userId: userId(U1) }).body,
    ).toEqual(expected);
  });

  it("grantWriteToHttp emits exactly the WriteGrantWire shape (no `mode`)", () => {
    const grant: WriteGrant = {
      reportId: reportId(R1),
      granteeEmail: "b@example.com",
      granteeUserId: null,
      grantedBy: userId(U1),
      grantedAt: 1_752_000_000_000,
    };
    const expected: WriteGrantWire = {
      object: "write_grant",
      email: "b@example.com",
      granted_by: userIdToWire(userId(U1)),
      granted_at: new Date(1_752_000_000_000).toISOString(),
    };
    expect(grantWriteToHttp(ok(grant)).body).toEqual(expected);
    // With the entry-URL opts, the same shape gains ONLY the optional
    // `open_url` (additive — the grantee's one-click editor entry).
    const withEntry: WriteGrantWire = {
      ...expected,
      open_url: "https://app.example.test/reports/abcde12345/open",
    };
    expect(
      grantWriteToHttp(ok(grant), { appOrigin: "https://app.example.test", slug: "abcde12345" })
        .body,
    ).toEqual(withEntry);
  });
});
