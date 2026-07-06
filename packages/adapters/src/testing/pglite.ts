// Fast adapter-integration harness: a fresh in-memory pglite (the real Postgres
// engine, in-process) with the committed drizzle migrations applied, wrapped in a
// DbContext so the real Drizzle adapters run their actual SQL — no Neon, no network.
// This is the fast tier BELOW the real-Neon e2e (ADR-0019), and the regression net
// for SQL-semantics bugs (ON CONFLICT, transactions) that pure-mapper tests miss.
// Test-only: imported by *.test.ts directly, never from the package entry.
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { folders, orgs, users } from "arp-db/schema";
import {
  createReport,
  type FolderId,
  folderId,
  makeSlug,
  type OrgId,
  orgId,
  type Report,
  type ReportId,
  reportId,
  type UserId,
  userId,
  type VersionId,
  versionId,
} from "arp-domain";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, DbContext, schema } from "../client";

// packages/adapters/src/testing → packages/db/drizzle (holds meta/_journal.json + *.sql).
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../db/drizzle", import.meta.url));

export interface TestDb {
  /** A DbContext backed by the pglite instance — feed it to any Drizzle adapter. */
  readonly ctx: DbContext;
  /** Tear down the in-memory database. */
  close(): Promise<void>;
}

/**
 * Spin up a fresh, migrated in-memory database for one test. Each call is fully
 * isolated, so tests never share state.
 */
export async function makeTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // pglite and neon-serverless drizzle expose the same query-builder + transaction
  // surface the adapters use; the cast bridges the nominal driver types here only.
  const ctx = new DbContext({ base: db as unknown as Db });
  return { ctx, close: () => client.close() };
}

const SEED_ORG = "00000000-0000-4000-8000-000000000001";
const SEED_USER = "00000000-0000-4000-8000-000000000002";
const SEED_FOLDER = "00000000-0000-4000-8000-000000000003";

export interface SeededIdentity {
  readonly orgId: OrgId;
  readonly userId: UserId;
  readonly folderId: FolderId;
}

/**
 * Insert the Org / User / Root folder a Report's foreign keys require, so a test
 * can save a report aggregate. Returns the branded ids to build fixtures with.
 */
export async function seedIdentity(ctx: DbContext): Promise<SeededIdentity> {
  const db = ctx.current();
  await db
    .insert(orgs)
    .values({ id: SEED_ORG, clerkOrgId: "org_test", name: "Test Org", planLimitsJson: {} });
  await db.insert(users).values({ id: SEED_USER, clerkUserId: "user_test", email: "t@test.local" });
  await db.insert(folders).values({ id: SEED_FOLDER, orgId: SEED_ORG, name: "Root", slug: "root" });
  return { orgId: orgId(SEED_ORG), userId: userId(SEED_USER), folderId: folderId(SEED_FOLDER) };
}

export const SAMPLE_REPORT_ID = reportId("00000000-0000-4000-8000-0000000000a1");
export const SAMPLE_VERSION_ID = versionId("00000000-0000-4000-8000-0000000000b1");

/** Overridable fields for {@link makeSampleReport} — everything else defaults
 *  to the fixed sample (Q3 metrics, slug "abcde12345", version 1). */
export interface SampleReportOverrides {
  readonly id?: ReportId;
  readonly versionId?: VersionId;
  /** A 10-char nanoid-shaped slug (Slug's smart-constructor requirement). */
  readonly slug?: string;
  readonly title?: string;
}

/**
 * A pure Report aggregate (+ its events) whose foreign keys match seedIdentity()'s
 * Org / User / Root folder — so after `seedIdentity(ctx)` it can be saved. The
 * single shared fixture builder for adapter integration/contract tests
 * (consolidates the near-duplicate local `makeReport`/`newReport` helpers that
 * used to live in report-repository.integration.test.ts).
 */
export function makeSampleReport(overrides: SampleReportOverrides = {}): {
  readonly report: Report;
  readonly events: ReturnType<typeof createReport>["events"];
} {
  const slugStr = overrides.slug ?? "abcde12345";
  const slug = makeSlug(slugStr);
  if (!slug.ok) throw new Error(`bad slug: ${slugStr}`);
  return createReport({
    id: overrides.id ?? SAMPLE_REPORT_ID,
    orgId: orgId(SEED_ORG),
    folderId: folderId(SEED_FOLDER),
    slug: slug.value,
    title: overrides.title ?? "Q3 metrics",
    versionId: overrides.versionId ?? SAMPLE_VERSION_ID,
    contentHash: "a".repeat(64),
    uploadedBy: userId(SEED_USER),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
}

/** The fixed default sample report (no overrides) — kept as a distinct export
 *  since most callers just need "a" valid report, not a customized one. */
export function sampleReport(): {
  readonly report: Report;
  readonly events: ReturnType<typeof createReport>["events"];
} {
  return makeSampleReport();
}
