import { Pool } from "@neondatabase/serverless";
import type { reportVersions } from "arp-db/schema";
import * as schema from "arp-db/schema";
import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { drizzle } from "drizzle-orm/neon-serverless";
import { describe, expect, it } from "vitest";
import {
  reportToRow,
  rowsToReport,
  rowToVersion,
  upsertVersions,
  versionToRow,
} from "./report-repository";

const slug = (s: string) => {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
};

const report = createReport({
  id: reportId("11111111-1111-7111-8111-111111111111"),
  orgId: orgId("o-1"),
  folderId: folderId("f-1"),
  slug: slug("abcdefghij"),
  title: "Q3 metrics",
  versionId: versionId("v-1"),
  contentHash: "hash-1",
  uploadedBy: userId("u-1"),
  manifest: { entryDocument: "index.html", files: ["index.html"] },
  sizeBytes: 11,
}).report;

describe("report-repository mappers", () => {
  it("versionToRow maps domain fields onto columns (manifest/size/uploader/scan)", () => {
    const row = versionToRow("rid", report.versions[0]!);
    expect(row).toMatchObject({
      reportId: "rid",
      versionNo: 1,
      manifestJson: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
      contentHash: "hash-1",
      uploadedByUser: "u-1",
      scanStatus: "pending",
    });
  });

  it("reportToRow maps null deletedAt through and keeps slug/title/ids", () => {
    const row = reportToRow(report);
    expect(row).toMatchObject({
      slug: "abcdefghij",
      title: "Q3 metrics",
      liveVersionId: null,
      deletedAt: null,
    });
  });

  it("rowToVersion round-trips a version row back to the domain shape", () => {
    const vrow: typeof reportVersions.$inferSelect = {
      id: "v-1",
      reportId: "rid",
      versionNo: 2,
      manifestJson: { entryDocument: "index.html", files: ["index.html", "a.css"] },
      sizeBytes: 42,
      contentHash: "h",
      uploadedByUser: "u-1",
      scanStatus: "clean",
      uploadedAt: new Date(),
    };
    const v = rowToVersion(vrow);
    expect(v).toEqual({
      id: "v-1",
      versionNo: 2,
      contentHash: "h",
      uploadedBy: "u-1",
      scanStatus: "clean",
      manifest: { entryDocument: "index.html", files: ["index.html", "a.css"] },
      sizeBytes: 42,
    });
  });

  it("rowsToReport reconstructs the aggregate + maps deletedAt to epoch ms", () => {
    const reportRow = {
      id: "rid",
      orgId: "oid",
      folderId: "fid",
      slug: "abcdefghij",
      title: "T",
      liveVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(5),
    };
    const back = rowsToReport(reportRow, []);
    expect(back.id).toBe("rid");
    expect(back.slug).toBe("abcdefghij");
    expect(back.deletedAt).toBe(5);
    expect(back.versions).toEqual([]);
  });
});

describe("upsertVersions — conflict clause persists scan_status (regression: viewer 404)", () => {
  // Connectionless drizzle: the Neon Pool is lazy (no socket until a query), so
  // .toSQL() renders the statement via the dialect without touching a DB.
  const sqlDb = drizzle(new Pool({ connectionString: "postgresql://u:p@localhost:5432/t" }), {
    schema,
  });

  it("emits ON CONFLICT DO UPDATE SET scan_status = excluded.scan_status (not DO NOTHING)", () => {
    const [v0] = report.versions;
    if (!v0) throw new Error("fixture has no version");
    const row = versionToRow("rid", v0);
    const { sql } = upsertVersions(sqlDb, [row]).toSQL();
    const q = sql.toLowerCase();

    expect(q).toContain("on conflict");
    expect(q).toContain("do update set");
    expect(q).toContain("scan_status");
    expect(q).toContain("excluded");
    // The old onConflictDoNothing() left scan_status stale at 'pending' forever,
    // so the ADR-0038 gate (requires live version === clean) 404'd every promoted
    // report. The conflict MUST refresh scan_status from the inserted row.
    expect(q).not.toContain("do nothing");
  });
});
