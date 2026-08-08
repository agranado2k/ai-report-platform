// setAcl — set a Report's sharing Acl (ADR-0056). OWNER-ONLY, permanently
// (ADR-0059 §2 — share config is the owner's business; deliberately NOT on the
// canWrite seam). Pure orchestration (ADR-0024): `acl:write` scope (ADR-0016)
// + ownership (the shared loadOwnedReport owner guard), hash a new password
// via the PasswordHasher port (OUTSIDE the tx — no state change yet), then
// prune any now-stale durable grants — `report_grants` (ADR-0056 "5e", issue
// #137) AND the ADR-0078 org-write row (§11) — persist via reports.setAcl, and
// record an `acl.set` audit_log row (ADR-0070), all inside ONE UnitOfWork
// (ADR-0037 §5 commit-last atomicity — this closes a latent gap where the
// prune and the persist were two unwrapped writes). Returns the updated Report.
//
// A DURABLE GRANT MUST NOT OUTLIVE THE ACL THAT AUTHORIZED IT. That rule now
// covers both grant families, because this route is the SECOND door onto the
// same Acl `setReportSharing` writes: an owner could set `org_edit` there and
// then narrow to `private` here, and — before ADR-0078 §11 — the org-write row
// survived. Every org member kept `canWrite` (rename/move/re-upload), the
// report stayed LISTED to them through the §8 org-write leg, and the ADR-0063
// edit-token door (which never consults the Acl) served them its content. See
// `pruneStaleOrgWriteGrant` for the exact rule and why `org` is left alone.

import {
  ACL_WRITE_SCOPE,
  type AclMode,
  type AppError,
  err,
  insufficientScope,
  makeAcl,
  ok,
  type Report,
  type Result,
  type Slug,
  validationError,
} from "arp-domain";
import type { AuditEntry } from "../audit";
import { commitWrite } from "../commit-write";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reportReplayBody,
  reviveReportReplay,
} from "../idempotent-write";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  GrantStore,
  IdempotencyKeyRef,
  OrgWriteGrantStore,
  PasswordHasher,
  ReportRepository,
  UnitOfWork,
} from "../ports";

const ROUTE = "POST /api/v1/reports/{slug}/acl";

export interface SetAclDeps extends IdempotentWriteDeps {
  readonly reports: ReportRepository;
  readonly hasher: PasswordHasher;
  /** The VIEWER-ACCESS grant store (ADR-0056 allowlist redemptions). */
  readonly grants: GrantStore;
  /** The ADR-0078 org-write grant store. Deliberately a DIFFERENT port from
   *  `grants` and named as such — the two revoke different things and confusing
   *  them would silently disable one of the two prunes. */
  readonly orgWriteGrants: OrgWriteGrantStore;
  /** Audit log (ADR-0070) — one `acl.set` row per Acl change, plus a
   *  `grant.org_write.revoked` row when the narrowing dropped one. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface SetAclActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface SetAclInput {
  readonly slug: Slug;
  readonly mode: AclMode;
  /** Plaintext — required for `password` mode; hashed (argon2id) before persistence. */
  readonly password?: string;
  /** Required (≥1) for `allowlist` mode. */
  readonly allowedEmails?: readonly string[];
  /** Owner access TTL (seconds) for `allowlist` mode; defaults when omitted. */
  readonly accessTtlSeconds?: number;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function setAcl(
  deps: SetAclDeps,
  actor: SetAclActor,
  input: SetAclInput,
): Promise<Result<Report, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  let passwordHash: string | undefined;
  if (input.mode === "password") {
    if (!input.password?.trim()) {
      return err(validationError("password mode requires a password", "password"));
    }
    const hashed = await deps.hasher.hash(input.password);
    if (!hashed.ok) return hashed;
    passwordHash = hashed.value;
  }

  const acl = makeAcl({
    mode: input.mode,
    passwordHash,
    allowedEmails: input.allowedEmails,
    accessTtlSeconds: input.accessTtlSeconds,
  });
  if (!acl.ok) return acl;

  // Idempotency (ADR-0039), with one deliberate carve-out: a DERIVED key must
  // never be a function of the plaintext password (a fast sha-256 fingerprint
  // of a password would be a crackable artifact in `idempotency_keys`, far
  // weaker than the argon2id hash `acls` stores). So a password-mode request
  // WITHOUT an explicit `Idempotency-Key` skips the claim entirely — re-applying
  // the same password is naturally idempotent in effect, and two DIFFERENT
  // passwords back-to-back must both apply (a presence-marker fingerprint would
  // silently swallow the second). With an explicit key, the client owns retry
  // identity and the fingerprint carries only a `password:set` marker.
  const useIdempotency = input.mode !== "password" || input.idempotencyKey !== undefined;
  let idemRef: IdempotencyKeyRef | undefined;
  if (useIdempotency) {
    const idem = await beginIdempotentWrite(deps, {
      actingUserId: actor.userId,
      route: ROUTE,
      // ADR-0039 derived fallback: sets sharing STATE; org -> private -> org must re-apply, not replay (security-relevant)
      derivedFallback: "unsound",
      key: input.idempotencyKey,
      fingerprint: [
        input.slug,
        input.mode,
        input.allowedEmails?.join(",") ?? "",
        input.accessTtlSeconds ?? "",
        input.password !== undefined ? "password:set" : "",
      ],
    });
    if (!idem.ok) return idem;
    if (idem.value.outcome === "replay") return reviveReportReplay(idem.value.record);
    idemRef = idem.value.ref;
  }

  // The mutation returns BOTH the updated report and whether the org-write
  // grant was actually revoked, because the audit rows depend on the latter and
  // commitWrite derives them from what the mutation returns. Mapped back to the
  // report below so this use case's signature is unchanged.
  const committed = await commitWrite<{
    readonly report: Report;
    readonly orgWriteRevoked: boolean;
  }>(
    deps,
    {
      idemRef,
      audit: ({ orgWriteRevoked }) => {
        const entries: AuditEntry[] = [
          {
            action: "acl.set",
            orgId: actor.orgId,
            actorUserId: actor.userId,
            targetType: "report",
            targetId: found.value.id,
            meta: { mode: acl.value.mode },
          },
        ];
        // Only when a row actually moved — the log records revocations, not
        // every narrowing call, exactly as `setReportSharing` does.
        if (orgWriteRevoked) {
          entries.push({
            action: "grant.org_write.revoked",
            orgId: actor.orgId,
            actorUserId: actor.userId,
            targetType: "report",
            targetId: found.value.id,
            // The Acl mode that no longer authorizes it — the reason, not just
            // the fact. `setAcl` has no sharing-state vocabulary for a `to`.
            meta: { revokedBy: "acl.set", mode: acl.value.mode },
          });
        }
        return entries;
      },
      // never carries a password hash
      response: ({ report }) => ({ responseStatus: 200, responseBody: reportReplayBody(report) }),
    },
    async () => {
      // Prune BEFORE persisting. Fail-closed both ways: if pruning fails
      // nothing changed and a retry re-prunes; if the persist then fails, the
      // whole transaction rolls back together (prune + persist + audit are one
      // UnitOfWork) — so a partial prune-without-persist can no longer strand
      // the Acl and the grants out of sync. Persist-first would still be worse
      // in spirit: pruning stays logically "first" so a fresh retry after any
      // failure re-derives the diff from the (unchanged) previous mode.
      const pruned = await pruneStaleGrants(
        deps.grants,
        found.value.id,
        found.value.acl,
        acl.value,
      );
      if (!pruned.ok) return pruned;

      // The SAME rule, applied to the second grant family (ADR-0078 §11).
      const prunedOrgWrite = await pruneStaleOrgWriteGrant(
        deps.orgWriteGrants,
        found.value.id,
        acl.value.mode,
      );
      if (!prunedOrgWrite.ok) return prunedOrgWrite;

      const saved = await deps.reports.setAcl(found.value.id, acl.value);
      if (!saved.ok) return saved;

      return ok({
        report: { ...found.value, acl: acl.value },
        orgWriteRevoked: prunedOrgWrite.value,
      });
    },
  );
  return committed.ok ? ok(committed.value.report) : committed;
}

export async function pruneStaleGrants(
  grants: GrantStore,
  reportId: Report["id"],
  previousAcl: Report["acl"],
  nextAcl: Report["acl"],
): Promise<Result<void, AppError>> {
  if (previousAcl.mode !== "allowlist") return ok(undefined);

  if (nextAcl.mode !== "allowlist") {
    return grants.revokeAll(reportId);
  }

  const removed = previousAcl.allowedEmails.filter((e) => !nextAcl.allowedEmails.includes(e));
  for (const email of removed) {
    const revoked = await grants.revoke(reportId, email);
    if (!revoked.ok) return revoked;
  }
  return ok(undefined);
}

/**
 * Revoke the ADR-0078 org-write grant when the new Acl no longer authorizes it
 * (ADR-0078 §11) — `pruneStaleGrants`' rule, applied to the second grant
 * family. Returns whether a row was actually revoked, so the caller can audit
 * a revocation without auditing every narrowing call.
 *
 * THE RULE: the row survives ONLY while the mode is `org`. `org_edit` is
 * DEFINED (§3) as `acl.mode = 'org'` plus this row, so any other mode makes the
 * pair impossible — and the pair is what keeps write from outrunning read
 * (ADR-0060 §6). `private`, `password`, `allowlist` and `public` all narrow
 * READ below org, so the org-wide WRITE must go with them.
 *
 * MODE `org` IS DELIBERATELY LEFT ALONE. Re-asserting `org` neither grants nor
 * revokes write: the pair `org_edit` depends on is still intact, and this is a
 * call the owner made about READING. Revoking here would silently downgrade
 * `org_edit` to `org_view` — a change the caller never asked for and the
 * response body (which carries only the `Acl`) could not report. Granting here
 * would be worse: `setAcl` would manufacture org-wide write out of a read call.
 *
 * `revoke` is idempotent, but the `find` still runs first: without it there is
 * no way to tell a revocation from a no-op, and the audit log would either
 * record narrowings that revoked nothing or record nothing at all.
 */
export async function pruneStaleOrgWriteGrant(
  orgWriteGrants: OrgWriteGrantStore,
  reportId: Report["id"],
  nextMode: AclMode,
): Promise<Result<boolean, AppError>> {
  if (nextMode === "org") return ok(false);
  const existing = await orgWriteGrants.find(reportId);
  if (!existing.ok) return existing;
  if (existing.value === null) return ok(false);
  const revoked = await orgWriteGrants.revoke(reportId);
  if (!revoked.ok) return revoked;
  return ok(true);
}
