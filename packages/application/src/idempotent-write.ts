// The shared idempotent-write shape (ADR-0039) — the generalization of what
// upload-report.ts pioneered, adopted by every mutating use case:
//
//   1. `beginIdempotentWrite` AFTER load+authz, BEFORE the transaction: claims
//      the key (explicit `Idempotency-Key` header when the client sent one,
//      else the ADR-0039 derived fallback — hash(user ∥ route ∥ canonical
//      significant payload)), and classifies the claim: `proceed` (fresh),
//      `replay` (completed match → return the recorded response WITHOUT
//      re-executing), err(IdempotencyInFlight) (concurrent duplicate → 409),
//      or err(IdempotencyKeyReuseDifferentBody) (explicit key reused with a
//      different request → 422).
//   2. On `proceed`, the use case runs its OWN `uow.run` transaction exactly as
//      before — mutation → audit (ADR-0070 commit-last) → and, as the final
//      co-equal-last step, `deps.idempotency.complete(ref, record)` — so the
//      idempotency record commits or rolls back WITH the mutation (ADR-0039's
//      crash-consistency requirement). Only the claim/derive wiring lives here;
//      each use case stays explicit about its transaction.
//
// One deliberate divergence from upload-report's step order: upload claims its
// key before plan-limit/load (its derived key needs the processed bundle's
// content hash anyway). Here the claim happens AFTER load+authz so a rejected
// request (403/404/422) never poisons a key — an in-flight record for a request
// that will never complete would otherwise 409 identical retries until the 24h
// sweep. Replay is keyed per acting user, so re-running the (read-only) authz
// before serving a replay only ever narrows access, never widens it.
import type {
  AppError,
  Comment,
  Folder,
  FolderVisibility,
  Report,
  Result,
  UserId,
} from "arp-domain";
import { err, FOLDER_VISIBILITIES, ok } from "arp-domain";
import type {
  FolderShare,
  Hasher,
  IdempotencyKeyRef,
  IdempotencyRecord,
  IdempotencyStore,
  WriteGrant,
} from "./ports";

/** The two deps every mutating use case adds for ADR-0039. `keyHasher` derives
 *  the fallback key + fingerprint digest (sha-256 hex in production) — named
 *  distinctly from use-case-specific hashers (e.g. setAcl's PasswordHasher). */
export interface IdempotentWriteDeps {
  readonly idempotency: IdempotencyStore;
  readonly keyHasher: Hasher;
}

export interface IdempotentWriteInput {
  readonly actingUserId: UserId;
  /** Canonical route tag — the ADR-0039 key-derivation `route` term (e.g.
   *  "PATCH /api/v1/reports/{slug}"). Stable per operation, NOT per URL. */
  readonly route: string;
  /** The client's explicit `Idempotency-Key` header, when sent. */
  readonly key?: string | undefined;
  /** Canonical significant-payload segments (ADR-0039). Joined with \n (which
   *  cannot occur in id/slug segments) and hashed — the digest is both the
   *  stored fingerprint and the derived-key input. null/undefined encode as ""
   *  so optional fields keep the encoding stable. */
  readonly fingerprint: readonly (string | number | null | undefined)[];
  /**
   * Whether the ADR-0039 DERIVED-key fallback is sound for this operation.
   * REQUIRED — a use case must classify itself, because the wrong answer fails
   * OPEN and silently (issue #233 / GHSA-ghxh-82j4-pp6m).
   *
   * `sound` — running it twice would create a second thing (add a comment,
   * create a folder). The derived key is genuinely protective: it is what makes
   * a retried POST not duplicate. Keep it.
   *
   * `unsound` — running it twice leaves the same end state (rename, move,
   * set-acl, grant, revoke, delete). The fingerprint describes the DESIRED
   * state, so A → B → A derives the key of the FIRST call and replays it: the
   * API answers 200 with the stale body and never re-applies. `idempotency_keys`
   * has no TTL sweep, so that window never closes. The delete-shaped variant is
   * worse — the key can be burned before the fact, making the real call a
   * no-op. These operations are naturally idempotent in effect, so the fallback
   * buys nothing and costs correctness: it is skipped unless the CLIENT sends
   * an explicit `Idempotency-Key`, in which case the client owns retry identity
   * and the full claim/replay machinery applies as usual.
   *
   * The fallback can also be unsound for reasons unrelated to state-setting —
   * `create-api-key` marks itself `unsound` because a swallowed duplicate mint
   * returns a key summary with NO secret, which is worse than the cheap,
   * revocable duplicate it would prevent. Hence this flag names what it
   * CONTROLS rather than one rationale for it.
   */
  readonly derivedFallback: "sound" | "unsound";
}

export type IdempotentBegin =
  /** `ref` is undefined when no key was claimed — an `unsound` operation with
   *  no explicit client key. Callers complete only when it is present. */
  | { readonly outcome: "proceed"; readonly ref?: IdempotencyKeyRef | undefined }
  | { readonly outcome: "replay"; readonly record: IdempotencyRecord };

/** The `sound` result: a key is ALWAYS claimed, so `ref` is always present.
 *  Narrowing this in the type keeps one-shot call sites unchanged and stops a
 *  `if (ref)` guard from silently skipping `complete` where completing is the
 *  whole point (a skipped complete would let a retried POST duplicate). */
export type IdempotentBeginClaimed =
  | { readonly outcome: "proceed"; readonly ref: IdempotencyKeyRef }
  | { readonly outcome: "replay"; readonly record: IdempotencyRecord };

export function beginIdempotentWrite(
  deps: IdempotentWriteDeps,
  input: IdempotentWriteInput & { readonly derivedFallback: "sound" },
): Promise<Result<IdempotentBeginClaimed, AppError>>;
export function beginIdempotentWrite(
  deps: IdempotentWriteDeps,
  input: IdempotentWriteInput,
): Promise<Result<IdempotentBegin, AppError>>;
export async function beginIdempotentWrite(
  deps: IdempotentWriteDeps,
  input: IdempotentWriteInput,
): Promise<Result<IdempotentBegin, AppError>> {
  // The carve-out, centralized. Previously each use case either hand-rolled
  // this `if` or — for fifteen of them — simply did not, which is the defect.
  if (input.derivedFallback === "unsound" && input.key === undefined) {
    return ok({ outcome: "proceed" });
  }
  const fingerprint = deps.keyHasher.hash(
    input.fingerprint.map((s) => (s === null || s === undefined ? "" : String(s))).join("\n"),
  );
  const ref: IdempotencyKeyRef = {
    actingUserId: input.actingUserId,
    route: input.route,
    key:
      input.key ?? deps.keyHasher.hash([input.actingUserId, input.route, fingerprint].join("\n")),
  };
  const begun = await deps.idempotency.begin(ref, fingerprint);
  if (!begun.ok) return begun; // explicit key reused with a different body → 422
  if (begun.value.outcome === "in_flight") {
    return err({ kind: "IdempotencyInFlight", message: "request in flight" });
  }
  if (begun.value.outcome === "replay") {
    return ok({ outcome: "replay", record: begun.value.record });
  }
  return ok({ outcome: "proceed", ref });
}

/** Revive a stored replay body as `T`. Light structural guard mirroring
 *  upload-report's `parseUploadResult`: the store only ever holds bodies
 *  `complete` wrote, so a mismatch is an `Unexpected` (500), never a client
 *  error. */
export function reviveReplay<T>(
  record: IdempotencyRecord,
  guard: (body: unknown) => body is T,
): Result<T, AppError> {
  if (!guard(record.responseBody)) {
    return err({
      kind: "Unexpected",
      message: "stored idempotency response has an unexpected shape",
    });
  }
  return ok(record.responseBody);
}

// ── Report replay snapshot ─────────────────────────────────────────────────
// The stored replay body for a Report-returning write (rename/move/setAcl).
// Deliberately NOT the raw aggregate:
//   - `versions` is dropped (bulk — manifests/hashes; no write mapper
//     serializes them) and revives as [].
//   - `acl.passwordHash` is NEVER persisted outside the `acls` table — a
//     password-mode acl snapshots as `{ mode: "password" }` alone. The wire
//     mappers never serialize the hash either, so a replayed response is
//     byte-identical to the original.

export function reportReplayBody(report: Report): Record<string, unknown> {
  return {
    id: report.id,
    orgId: report.orgId,
    ownerId: report.ownerId,
    folderId: report.folderId,
    slug: report.slug,
    title: report.title,
    liveVersionId: report.liveVersionId,
    deletedAt: report.deletedAt,
    versions: [],
    acl: report.acl.mode === "password" ? { mode: "password" } : report.acl,
  };
}

export function reviveReportReplay(record: IdempotencyRecord): Result<Report, AppError> {
  return reviveReplay(record, isReportReplay);
}

function isReportReplay(body: unknown): body is Report {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.slug === "string" &&
    typeof b.title === "string" &&
    typeof b.ownerId === "string" &&
    typeof b.folderId === "string" &&
    typeof b.acl === "object" &&
    b.acl !== null &&
    Array.isArray(b.versions)
  );
}

// ── Aggregate replay revivers for the other JSON-safe result shapes ────────
// Folder / Comment / WriteGrant are stored whole (every field is a string /
// number / null — nothing bulky, nothing secret) and revived with the same
// light structural guard style as `reviveReportReplay`.

export function reviveFolderReplay(record: IdempotencyRecord): Result<Folder, AppError> {
  return reviveReplay(record, (body): body is Folder => {
    if (typeof body !== "object" || body === null) return false;
    const b = body as Record<string, unknown>;
    return (
      typeof b.id === "string" &&
      typeof b.name === "string" &&
      typeof b.slug === "string" &&
      // ADR-0076 made `visibility` a required field of every folder resource.
      // A record written before that migration lacks it, and reviving it would
      // emit a wire folder missing a spec-required field — reject as Unexpected
      // so the caller 500s loudly instead of serving a malformed replay.
      FOLDER_VISIBILITIES.includes(b.visibility as FolderVisibility)
    );
  });
}

export function reviveCommentReplay(record: IdempotencyRecord): Result<Comment, AppError> {
  return reviveReplay(
    record,
    (body): body is Comment =>
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).id === "string" &&
      typeof (body as Record<string, unknown>).reportId === "string" &&
      typeof (body as Record<string, unknown>).body === "string" &&
      typeof (body as Record<string, unknown>).createdAt === "number",
  );
}

export function reviveWriteGrantReplay(record: IdempotencyRecord): Result<WriteGrant, AppError> {
  return reviveReplay(
    record,
    (body): body is WriteGrant =>
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).reportId === "string" &&
      typeof (body as Record<string, unknown>).granteeEmail === "string" &&
      typeof (body as Record<string, unknown>).grantedAt === "number",
  );
}

export function reviveFolderShareReplay(record: IdempotencyRecord): Result<FolderShare, AppError> {
  return reviveReplay(
    record,
    (body): body is FolderShare =>
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).folderId === "string" &&
      typeof (body as Record<string, unknown>).granteeEmail === "string" &&
      typeof (body as Record<string, unknown>).grantedAt === "number",
  );
}
