// Composition root (server-only) — wires the UploadReportUseCase's driven ports
// to the real Drizzle/R2 adapters, using validated env from defineEnv() (arp-env,
// ADR-0043). One DbContext + deps set per warm lambda. Boundary layer (ADR-0020):
// this is the ONLY place the concrete adapters are assembled.
import {
  AllowAllPlanLimiter,
  CleanStubScanner,
  DbContext,
  DrizzleEventOutbox,
  DrizzleIdempotencyStore,
  DrizzleReportRepository,
  DrizzleScanQueue,
  DrizzleUnitOfWork,
  getBoss,
  HtmlBundleProcessor,
  NanoidSlugFactory,
  PgBossScanWorkQueue,
  R2BlobStore,
  Sha256Hasher,
  SystemClock,
  UuidV7IdGenerator,
} from "arp-adapters";
import type { DrainScansDeps, UploadActor, UploadReportDeps } from "arp-application";
import { folders, orgs, users } from "arp-db/schema";
import { folderId, orgId, userId } from "arp-domain";
import { defineEnv } from "arp-env";

// Fixed dev identity (Phase 1: real auth is Clerk, ADR-0005). These rows satisfy
// the reports/report_versions FK constraints; seeded idempotently on first use.
const DEV_ORG = "00000000-0000-4000-8000-000000000001";
const DEV_USER = "00000000-0000-4000-8000-000000000002";
const DEV_FOLDER = "00000000-0000-4000-8000-000000000003";

export const DEMO_ACTOR: UploadActor = {
  userId: userId(DEV_USER),
  orgId: orgId(DEV_ORG),
  folderId: folderId(DEV_FOLDER),
  scopes: ["reports:write"],
};

let _ctx: DbContext | undefined;
let _deps: UploadReportDeps | undefined;
let _seeded = false;

function context(): DbContext {
  if (_ctx) return _ctx;
  const env = defineEnv();
  _ctx = new DbContext(env.DATABASE_URL);
  return _ctx;
}

export function dbContext(): DbContext {
  return context();
}

/**
 * The canonical viewer origin for building `view_url` (ADR-002 / ADR-0038):
 * `${viewOrigin}/${slug}`. Reads the validated `VIEW_ORIGIN` from the env
 * contract HERE, in the composition root — route handlers never touch
 * `defineEnv()` directly (ADR-0043). Falls back to the request origin on
 * previews/dev, where Terraform leaves `VIEW_ORIGIN` unset.
 */
export function viewOrigin(request: Request): string {
  return defineEnv().VIEW_ORIGIN ?? new URL(request.url).origin;
}

export function deps(): UploadReportDeps {
  if (_deps) return _deps;
  const env = defineEnv();
  const ctx = context();
  _deps = {
    reports: new DrizzleReportRepository(ctx),
    blobs: new R2BlobStore({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      // R2's S3 endpoint is derived from the account id.
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    }),
    bundles: new HtmlBundleProcessor(),
    idempotency: new DrizzleIdempotencyStore(ctx),
    outbox: new DrizzleEventOutbox(ctx),
    scans: new DrizzleScanQueue(ctx),
    planLimiter: new AllowAllPlanLimiter(),
    ids: new UuidV7IdGenerator(),
    slugs: new NanoidSlugFactory(),
    hasher: new Sha256Hasher(),
    uow: new DrizzleUnitOfWork(ctx),
  };
  return _deps;
}

/**
 * Deps for the async scan drain (ADR-0045). Reuses the Drizzle ports from deps()
 * and adds the pg-boss work queue + the (Phase-1.5a stub) Scanner. pg-boss runs
 * over node-postgres TCP against the POOLED Neon endpoint (SCAN_QUEUE_DATABASE_URL,
 * falling back to DATABASE_URL) — separate from DbContext's WebSocket pool.
 */
export async function scanDrainDeps(): Promise<DrainScansDeps> {
  const env = defineEnv();
  const base = deps();
  const boss = await getBoss(env.SCAN_QUEUE_DATABASE_URL ?? env.DATABASE_URL);
  return {
    reports: base.reports,
    scans: base.scans,
    outbox: base.outbox,
    uow: base.uow,
    scanWork: new PgBossScanWorkQueue(boss),
    scanner: new CleanStubScanner(),
  };
}

/** Idempotently ensure the dev org/user/folder exist (FK targets for uploads). */
export async function ensureDevIdentity(): Promise<void> {
  if (_seeded) return;
  const db = context().current();
  await db
    .insert(orgs)
    .values({ id: DEV_ORG, clerkOrgId: "dev-org", name: "Dev Org", planLimitsJson: {} })
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({ id: DEV_USER, clerkUserId: "dev-user", email: "dev@local.test" })
    .onConflictDoNothing();
  await db
    .insert(folders)
    .values({ id: DEV_FOLDER, orgId: DEV_ORG, name: "Root", slug: "root" })
    .onConflictDoNothing();
  _seeded = true;
}
