// setAcl — set a Report's sharing Acl (ADR-0056). Pure orchestration (ADR-0024):
// `acl:write` scope (ADR-0016) + org ownership, hash a new password via the
// PasswordHasher port, then persist via reports.setAcl. Returns the updated Report.
import {
  type AclMode,
  type AppError,
  err,
  insufficientScope,
  makeAcl,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
  validationError,
} from "arp-domain";
import type { PasswordHasher, ReportRepository } from "../ports";

const ACL_WRITE_SCOPE = "acl:write";

export interface SetAclDeps {
  readonly reports: ReportRepository;
  readonly hasher: PasswordHasher;
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

  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("report is not in your org"));

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

  const saved = await deps.reports.setAcl(found.value.id, acl.value);
  if (!saved.ok) return saved;
  return ok({ ...found.value, acl: acl.value });
}
