// The AuditLogger seam's vocabulary (ADR-0070, issue #153): every
// user-initiated, org-scoped mutation writes an `audit_log` row in the SAME
// transaction as the state change (commit-last, mirrors the outbox in
// ports.ts). System/webhook-driven use cases (process-scan-result,
// handle-user-deleted, provision-identity) are OUT of scope here — those stay
// captured as domain events, per ADR-0070.
import type { OrgId, UserId } from "arp-domain";

/** The closed vocabulary of audited actions. Extend deliberately — each new
 *  member should correspond to one user-initiated mutation use case. */
export type AuditAction =
  | "report.uploaded"
  | "report.renamed"
  | "report.moved"
  | "report.deleted"
  | "folder.created"
  | "folder.renamed"
  | "folder.deleted"
  | "acl.set"
  | "grant.write.granted"
  | "grant.write.revoked"
  | "comment.added"
  | "comment.replied"
  | "comment.resolved"
  | "comment.deleted"
  | "api_key.created"
  | "api_key.revoked";

/** One audit row's application-layer shape. `ipHash`/`geo` are deliberately
 *  absent — those are HTTP-layer concerns (ADR-0070) and are left null by the
 *  adapter; the application layer stays request-free (ADR-0024). */
export interface AuditEntry {
  readonly action: AuditAction;
  readonly orgId: OrgId;
  readonly actorUserId: UserId | null;
  /** "report" | "folder" | "acl" | "grant" | "comment" | "api_key" */
  readonly targetType: string;
  readonly targetId: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}
