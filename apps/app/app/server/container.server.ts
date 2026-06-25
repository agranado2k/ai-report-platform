// Composition root (server-only) — wires the UploadReportUseCase's driven ports
// to the real Drizzle/R2 adapters, using validated env from defineEnv() (arp-env,
// ADR-0043). One DbContext + deps set per warm lambda. Boundary layer (ADR-0020):
// this is the ONLY place the concrete adapters are assembled.
import {
  AllowAllPlanLimiter,
  ApiKeyService,
  Argon2PasswordHasher,
  CleanStubScanner,
  ClerkBackendOrgProvisioner,
  DbContext,
  DrizzleApiKeyRepository,
  DrizzleEventOutbox,
  DrizzleFolderRepository,
  DrizzleIdempotencyStore,
  DrizzleIdentityStore,
  DrizzleReportRepository,
  DrizzleScanQueue,
  DrizzleUnitOfWork,
  getBoss,
  HtmlBundleProcessor,
  NanoidSlugFactory,
  PgBossScanWorkQueue,
  R2BlobStore,
  Sha256Hasher,
  UuidV7IdGenerator,
} from "arp-adapters";
import type {
  DrainScansDeps,
  HandleUserDeletedDeps,
  ProvisionIdentityDeps,
  UploadReportDeps,
} from "arp-application";
import { defineEnv } from "arp-env";

let _ctx: DbContext | undefined;
let _deps: UploadReportDeps | undefined;

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

/** The shared HMAC secret for minting view access tokens (ADR-0056); undefined when
 *  unset (previews/dev) → the unlock route fails closed. */
export function accessTokenSecret(): string | undefined {
  return defineEnv().VIEW_ACCESS_TOKEN_SECRET;
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
      keyPrefix: env.R2_KEY_PREFIX,
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

let _folders: DrizzleFolderRepository | undefined;

/** The folder repository (Reports & Folders) — for the dashboard tree + createFolder. */
export function folderRepo(): DrizzleFolderRepository {
  if (!_folders) _folders = new DrizzleFolderRepository(context());
  return _folders;
}

let _passwordHasher: Argon2PasswordHasher | undefined;

/** The argon2id password hasher (ADR-0056) — backs `password`-mode report ACLs. */
export function passwordHasher(): Argon2PasswordHasher {
  if (!_passwordHasher) _passwordHasher = new Argon2PasswordHasher();
  return _passwordHasher;
}

let _apiKeys: DrizzleApiKeyRepository | undefined;

/**
 * The API-key store (Identity & Access, ADR-0008) — backs the `arp_` Bearer path
 * in the auth seam (`resolveUploadActor`/`resolveActorForRead`) alongside Clerk
 * sessions. Memoized per warm lambda like `folderRepo()`.
 */
export function apiKeyStore(): DrizzleApiKeyRepository {
  if (!_apiKeys) {
    const env = defineEnv();
    const keys = new ApiKeyService({ pepper: env.API_KEY_PEPPER ?? "", label: env.API_KEY_ENV });
    _apiKeys = new DrizzleApiKeyRepository(context(), keys);
  }
  return _apiKeys;
}

let _provisionDeps: ProvisionIdentityDeps | undefined;

/**
 * Deps for `provisionIdentity` (ADR-0048) — the IdentityStore mirror + the real
 * Clerk org provisioner. Wired here in the composition root; `resolveUploadActor`
 * uses them to turn a signed-in Clerk session into an org-scoped UploadActor.
 */
export function provisionDeps(): ProvisionIdentityDeps {
  if (_provisionDeps) return _provisionDeps;
  const env = defineEnv();
  _provisionDeps = {
    identities: new DrizzleIdentityStore(context()),
    clerkOrgs: ClerkBackendOrgProvisioner.fromSecretKey(env.CLERK_SECRET_KEY),
  };
  return _provisionDeps;
}

/**
 * Deps for the Clerk `user.deleted` webhook handler (ADR-0054): the IdentityStore
 * (soft-delete) + the ApiKeyStore (revoke cascade).
 */
export function userWebhookDeps(): HandleUserDeletedDeps {
  return { identities: new DrizzleIdentityStore(context()), apiKeys: apiKeyStore() };
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
