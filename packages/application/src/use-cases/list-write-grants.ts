// listWriteGrants — the report's OWNER lists everyone with write access
// (ADR-0060 §3, §5). OWNER-ONLY (ADR-0059 §2) + `acl:write` scope (ADR-0016) —
// like `getAcl`, this is share config and stays the owner's business.
import type { AppError, Result, Slug } from "arp-domain";
import { err, insufficientScope } from "arp-domain";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { ReportRepository, WriteGrant, WriteGrantStore } from "../ports";

const ACL_WRITE_SCOPE = "acl:write";

export interface ListWriteGrantsDeps {
  readonly reports: ReportRepository;
  readonly grants: WriteGrantStore;
}

export interface ListWriteGrantsActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface ListWriteGrantsInput {
  readonly slug: Slug;
}

export async function listWriteGrants(
  deps: ListWriteGrantsDeps,
  actor: ListWriteGrantsActor,
  input: ListWriteGrantsInput,
): Promise<Result<readonly WriteGrant[], AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  return deps.grants.listByReport(found.value.id);
}
