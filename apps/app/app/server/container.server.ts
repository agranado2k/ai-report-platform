// Composition root (server-only) — wires the UploadReportUseCase's driven ports
// to the real Drizzle/R2 adapters, using validated env from defineEnv() (arp-env,
// ADR-0043). One DbContext + deps set per warm lambda. Boundary layer (ADR-0020):
// this is the ONLY place the concrete adapters are assembled.
import { createClerkClient } from "@clerk/backend";
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
  BackfillDisplayNamesDeps,
  Clock,
  DrainScansDeps,
  EmailSender,
  GrantStore,
  HandleUserCreatedDeps,
  HandleUserDeletedDeps,
  IdentityStore,
  NonceStore,
  ProvisionIdentityDeps,
  UploadReportDeps,
  WriteGrantStore,
} from "arp-application";
import {
  addComment,
  createApiKey,
  createFolder,
  deleteComment,
  deleteFolder,
  deleteReport,
  editComment,
  getAcl,
  getReport,
  grantWrite,
  listApiKeys,
  listComments,
  listFolders,
  listReportVersions,
  listWriteGrants,
  moveReport,
  renameFolder,
  renameReport,
  replyToComment,
  resolveComment,
  revokeApiKey,
  revokeWrite,
  searchReports,
  setAcl,
  uploadReport,
} from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";
import { defineEnv } from "arp-env";
import { clerkDisplayName } from "./clerk-display-name";

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
 * Deps for the Clerk `user.created` webhook handler (ADR-0074 silent domain
 * auto-join): the IdentityStore (the `orgs.domain` index + the org-row write)
 * and the real Clerk org provisioner (anchor verify/scan, create, join).
 * Reuses `provisionDeps()`'s memoized pair so the webhook and first-write JIT
 * provisioning run the SAME wiring — one resolution path, never two.
 */
export function userCreatedDeps(): HandleUserCreatedDeps {
  return provisionDeps();
}

/**
 * Deps for the one-time `display_name` backfill (roadmap #59). Wires the real
 * DrizzleIdentityStore (target-set query + null-guarded write) to a NARROW Clerk
 * source that derives each name with the SAME shared `clerkDisplayName` rule live
 * JIT provisioning uses (auth.server.ts) — so a backfilled name is identical to
 * one captured on sign-in. A Clerk fetch failure for one user resolves to `err`
 * (the use case isolates it into the summary's `errors`, never aborting). PII:
 * the fetched name is passed straight to the store; it is never logged here.
 */
export function backfillDisplayNamesDeps(): BackfillDisplayNamesDeps {
  const env = defineEnv();
  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  return {
    identities: identityStore(),
    clerk: {
      async getDisplayName(clerkUserId: string): Promise<Result<string | null, AppError>> {
        try {
          const user = await client.users.getUser(clerkUserId);
          return ok(clerkDisplayName(user));
        } catch (e) {
          // A deleted/unknown Clerk user or an API outage — isolate as an error
          // for THIS user (no name/id logged: the message stays generic).
          return err({
            kind: "Unexpected",
            message: `clerk getUser failed: ${e instanceof Error ? e.name : "error"}`,
          });
        }
      },
    },
  };
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

/**
 * The container-wired OPERATIONS surface — one fully-wired invocation per use
 * case (the "one write front door" companion to `handle()`). This absorbs the
 * per-route deps bags that used to live in every /api/v1 route and dashboard
 * action (both the named-accessor style and the spread-with-comments style):
 * routes now declare WHAT runs, the composition root owns HOW it's wired.
 *
 * Wiring notes carried over from the old call sites:
 * - The canWrite/loadReadable seams need `grants` (WriteGrantStore) +
 *   `identities` — both already ride `deps()` (ADR-0060 §4).
 * - Comment use cases add the comment repo + clock on top of `deps()`
 *   (ADR-0064 §6).
 * - `setAcl`'s `hasher` is the argon2id PasswordHasher and its `grants` is the
 *   viewer-access GrantStore (ADR-0056) — deliberately DIFFERENT from the
 *   write-grant store the other use cases take; named wiring keeps them apart.
 * - Every mutating op now also carries the ADR-0039 idempotency pair
 *   (`idempotency` + `keyHasher`, the same Sha256 hasher the upload pipeline
 *   uses) — threading an `Idempotency-Key` is just an input field.
 */
export function ops() {
  const d = deps();
  const commentDeps = { ...d, comments: commentRepo(), clock: clock(), keyHasher: d.hasher };
  const writeCommon = { idempotency: d.idempotency, keyHasher: d.hasher };
  return {
    // ── Reports & Folders ──────────────────────────────────────────────────
    // identities backs the ADR-0075 visibility predicate's email-grant match
    // (the same findEmailByUserId seam hasWriteGrant uses).
    searchReports: bind2(searchReports, { reports: d.reports, identities: identityStore() }),
    uploadReport: (cmd: Parameters<typeof uploadReport>[1]) => uploadReport(d, cmd),
    getReport: bind2(getReport, {
      reports: d.reports,
      grants: writeGrantStore(),
      identities: identityStore(),
    }),
    renameReport: bind2(renameReport, {
      reports: d.reports,
      grants: writeGrantStore(),
      identities: identityStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    deleteReport: bind2(deleteReport, {
      reports: d.reports,
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    moveReport: bind2(moveReport, {
      reports: d.reports,
      folders: folderRepo(),
      grants: writeGrantStore(),
      identities: identityStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    listFolders: bind2(listFolders, { folders: folderRepo() }),
    createFolder: bind2(createFolder, {
      folders: folderRepo(),
      ids: d.ids,
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    renameFolder: bind2(renameFolder, {
      folders: folderRepo(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    deleteFolder: bind2(deleteFolder, {
      folders: folderRepo(),
      reports: d.reports,
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    listReportVersions: bind2(listReportVersions, { reports: d.reports }),
    // ── Sharing (ACL + write grants) ───────────────────────────────────────
    getAcl: bind2(getAcl, { reports: d.reports }),
    setAcl: bind2(setAcl, {
      reports: d.reports,
      hasher: passwordHasher(),
      grants: grantStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    listWriteGrants: bind2(listWriteGrants, { reports: d.reports, grants: writeGrantStore() }),
    grantWrite: bind2(grantWrite, {
      reports: d.reports,
      grants: writeGrantStore(),
      identities: identityStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    revokeWrite: bind2(revokeWrite, {
      reports: d.reports,
      grants: writeGrantStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    // ── Authoring & Collaboration (ADR-0064) ───────────────────────────────
    listComments: bind2(listComments, commentDeps),
    addComment: bind2(addComment, commentDeps),
    replyToComment: bind2(replyToComment, commentDeps),
    editComment: bind2(editComment, commentDeps),
    resolveComment: bind2(resolveComment, commentDeps),
    deleteComment: bind2(deleteComment, commentDeps),
    // ── Identity & Access (API keys) ───────────────────────────────────────
    listApiKeys: (actor: Parameters<typeof listApiKeys>[1]) =>
      listApiKeys({ apiKeys: apiKeyStore() }, actor),
    createApiKey: bind2(createApiKey, {
      apiKeys: apiKeyStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
    revokeApiKey: bind2(revokeApiKey, {
      apiKeys: apiKeyStore(),
      audit: auditLogger(),
      uow: d.uow,
      ...writeCommon,
    }),
  };
}

export type Ops = ReturnType<typeof ops>;

/** Partially apply a `(deps, actor, input)` use case with its wired deps →
 *  `(actor, input)`. Keeps `ops()` declarative: one line per use case. */
function bind2<D, A, I, R>(useCase: (deps: D, actor: A, input: I) => R, wired: D) {
  return (actor: A, input: I): R => useCase(wired, actor, input);
}
