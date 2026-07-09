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
  DrizzleAuditLogger,
  DrizzleCommentRepository,
  DrizzleEventOutbox,
  DrizzleFolderRepository,
  DrizzleGrantStore,
  DrizzleIdempotencyStore,
  DrizzleIdentityStore,
  DrizzleReportRepository,
  DrizzleScanQueue,
  DrizzleUnitOfWork,
  DrizzleWriteGrantStore,
  getBoss,
  HtmlBundleProcessor,
  NanoidSlugFactory,
  PgBossScanWorkQueue,
  R2BlobStore,
  ResendEmailSender,
  Sha256Hasher,
  SystemClock,
  UpstashNonceStore,
  UuidV7IdGenerator,
} from "arp-adapters";
import type {
  Clock,
  DrainScansDeps,
  EmailSender,
  GrantStore,
  HandleUserDeletedDeps,
  IdentityStore,
  NonceStore,
  ProvisionIdentityDeps,
  UploadReportDeps,
  WriteGrantStore,
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

/** App origin for building magic-link URLs (ADR-0056): `${APP_ORIGIN}/unlock/${slug}?link=…`.
 *  Falls back to the request origin on previews/dev where `APP_ORIGIN` is unset. */
export function appOrigin(request: Request): string {
  return defineEnv().APP_ORIGIN ?? new URL(request.url).origin;
}

let _nonces: UpstashNonceStore | undefined;
/** The Upstash nonce store (ADR-0056/0011) — backs allowlist magic links; undefined when
 *  the Upstash env is unset (previews/dev) → the unlock route fails closed. */
export function nonceStore(): NonceStore | undefined {
  if (_nonces) return _nonces;
  const env = defineEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return undefined;
  _nonces = new UpstashNonceStore({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _nonces;
}

let _email: ResendEmailSender | undefined;
/** The Resend email sender (ADR-0057) — sends allowlist magic links; undefined when the
 *  Resend env is unset → the unlock route fails closed. */
export function emailSender(): EmailSender | undefined {
  if (_email) return _email;
  const env = defineEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return undefined;
  _email = new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  return _email;
}

let _grants: DrizzleGrantStore | undefined;
/** The grant store (ADR-0056, revocation-C) — durable, revocable allowlist access grants. */
export function grantStore(): GrantStore {
  if (!_grants) _grants = new DrizzleGrantStore(context());
  return _grants;
}

let _writeGrants: DrizzleWriteGrantStore | undefined;
/** The write-grant store (ADR-0060) — per-report rename/re-upload/move grants;
 *  backs the canWrite seam's hasWriteGrant check + the grant/revoke/list use cases. */
export function writeGrantStore(): WriteGrantStore {
  if (!_writeGrants) _writeGrants = new DrizzleWriteGrantStore(context());
  return _writeGrants;
}

let _audit: DrizzleAuditLogger | undefined;
/** The audit log (ADR-0070, issue #153) — every user-initiated, org-scoped
 *  mutation's `audit_log` row. Memoized once and shared by `deps()` and any
 *  other use-case deps builder that needs it (e.g. deleteReport). */
export function auditLogger(): DrizzleAuditLogger {
  if (!_audit) _audit = new DrizzleAuditLogger(context());
  return _audit;
}

let _clock: SystemClock | undefined;
/** The system clock — epoch ms; backs grant expiry on magic-link redeem. */
export function clock(): Clock {
  if (!_clock) _clock = new SystemClock();
  return _clock;
}

let _identities: DrizzleIdentityStore | undefined;
/** The identity store (ADR-0048/0060) — Clerk-identity mirroring PLUS the
 *  internal-UserId ↔ email lookups the write-grant seam needs. Memoized once
 *  and shared by `deps()`, `provisionDeps()`, and `userWebhookDeps()`. */
export function identityStore(): IdentityStore {
  if (!_identities) _identities = new DrizzleIdentityStore(context());
  return _identities;
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
    audit: auditLogger(),
    scans: new DrizzleScanQueue(ctx),
    planLimiter: new AllowAllPlanLimiter(),
    ids: new UuidV7IdGenerator(),
    slugs: new NanoidSlugFactory(),
    hasher: new Sha256Hasher(),
    uow: new DrizzleUnitOfWork(ctx),
    grants: writeGrantStore(),
    identities: identityStore(),
  };
  return _deps;
}

let _folders: DrizzleFolderRepository | undefined;

/** The folder repository (Reports & Folders) — for the dashboard tree + createFolder. */
export function folderRepo(): DrizzleFolderRepository {
  if (!_folders) _folders = new DrizzleFolderRepository(context());
  return _folders;
}

let _comments: DrizzleCommentRepository | undefined;

/** The comment repository (Authoring & Collaboration, ADR-0064) — for the
 *  add/reply/resolve/delete/list comment routes. Memoized like folderRepo(). */
export function commentRepo(): DrizzleCommentRepository {
  if (!_comments) _comments = new DrizzleCommentRepository(context());
  return _comments;
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
    identities: identityStore(),
    clerkOrgs: ClerkBackendOrgProvisioner.fromSecretKey(env.CLERK_SECRET_KEY),
  };
  return _provisionDeps;
}

/**
 * Deps for the Clerk `user.deleted` webhook handler (ADR-0054): the IdentityStore
 * (soft-delete) + the ApiKeyStore (revoke cascade).
 */
export function userWebhookDeps(): HandleUserDeletedDeps {
  return { identities: identityStore(), apiKeys: apiKeyStore() };
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
