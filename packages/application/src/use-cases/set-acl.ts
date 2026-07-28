// setAcl — set a Report's sharing Acl (ADR-0056). OWNER-ONLY, permanently
// (ADR-0059 §2 — share config is the owner's business; deliberately NOT on the
// canWrite seam). Pure orchestration (ADR-0024): `acl:write` scope (ADR-0016)
// + ownership (the shared loadOwnedReport owner guard), hash a new password
// via the PasswordHasher port (OUTSIDE the tx — no state change yet), then
// prune any now-stale `report_grants` rows (ADR-0056 "5e", issue #137) via the
// GrantStore port — a durable grant must not outlive the Acl that granted it
// — persist via reports.setAcl, and record a `acl.set` audit_log row
// (ADR-0070), all inside ONE UnitOfWork (ADR-0037 §5 commit-last atomicity —
// this closes a latent gap where the prune and the persist were two
// unwrapped writes). Returns the updated Report.
import {
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
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  GrantStore,
  PasswordHasher,
  ReportRepository,
  UnitOfWork,
} from "../ports";

const ACL_WRITE_SCOPE = "acl:write";

export interface SetAclDeps {
  readonly reports: ReportRepository;
  readonly hasher: PasswordHasher;
  readonly grants: GrantStore;
  /** Audit log (ADR-0070) — one `acl.set` row per Acl change. */
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

  return deps.uow.run(async () => {
    // Prune BEFORE persisting. Fail-closed both ways: if pruning fails
    // nothing changed and a retry re-prunes; if the persist then fails, the
    // whole transaction rolls back together (prune + persist + audit are now
    // one UnitOfWork) — so a partial prune-without-persist can no longer
    // strand the Acl and the grants out of sync. Persist-first would still be
    // worse in spirit: pruning stays logically "first" so a fresh retry after
    // any failure re-derives the diff from the (unchanged) previous mode.
    const pruned = await pruneStaleGrants(deps.grants, found.value.id, found.value.acl, acl.value);
    if (!pruned.ok) return pruned;

    const saved = await deps.reports.setAcl(found.value.id, acl.value);
    if (!saved.ok) return saved;

    const audited = await deps.audit.record([
      {
        action: "acl.set",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        meta: { mode: acl.value.mode },
      },
    ]);
    if (!audited.ok) return audited;

    return ok({ ...found.value, acl: acl.value });
  });
}

/**
 * Revoke `report_grants` rows the new Acl no longer authorizes (ADR-0056 "5e"):
 * mode switched away from `allowlist` → revoke every grant; mode stays
 * `allowlist` → revoke just the emails dropped from the roster. Any other
 * transition (including allowlist → allowlist with only additions) leaves
 * grants untouched — the previous grants are a strict superset restriction of
 * the new allowlist, so a re-added email should NOT need to re-redeem a
 * magic link.
 */
async function pruneStaleGrants(
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
