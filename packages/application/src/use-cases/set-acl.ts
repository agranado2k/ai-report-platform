// setAcl — set a Report's sharing Acl (ADR-0056). Pure orchestration (ADR-0024):
// `acl:write` scope (ADR-0016) + org ownership (the shared loadOwnedReport
// guard), hash a new password via the PasswordHasher port, prune any now-stale
// `report_grants` rows (ADR-0056 "5e", issue #137) via the GrantStore port —
// a durable grant must not outlive the Acl that granted it — then persist via
// reports.setAcl. Returns the updated Report.
import {
  type AclMode,
  type AppError,
  err,
  insufficientScope,
  makeAcl,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
  validationError,
} from "arp-domain";
import { loadOwnedReport } from "../load-owned";
import type { GrantStore, PasswordHasher, ReportRepository } from "../ports";

const ACL_WRITE_SCOPE = "acl:write";

export interface SetAclDeps {
  readonly reports: ReportRepository;
  readonly hasher: PasswordHasher;
  readonly grants: GrantStore;
}

export interface SetAclActor {
  readonly orgId: OrgId;
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

  // Prune BEFORE persisting (no unit-of-work spans the two ports). Fail-closed
  // both ways: if pruning fails nothing changed and a retry re-prunes; if the
  // persist then fails, grants are revoked while the emails are still
  // allowlisted — the viewer's dual gate (resolve-access) denies until the
  // viewer re-redeems a magic link. Persist-first would be worse: a prune
  // failure after the persist strands the stale grants forever (the re-loaded
  // previous mode is no longer `allowlist`, so a retry never re-prunes).
  const pruned = await pruneStaleGrants(deps.grants, found.value.id, found.value.acl, acl.value);
  if (!pruned.ok) return pruned;

  const saved = await deps.reports.setAcl(found.value.id, acl.value);
  if (!saved.ok) return saved;

  return ok({ ...found.value, acl: acl.value });
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
