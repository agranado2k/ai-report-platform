// setReportSharing — move a Report between the three sharing states (ADR-0078
// §3): `private`, `org_view`, `org_edit`. OWNER-ONLY, permanently: every one of
// these transitions is a `set_acl` plus an org-write decision, and `set_acl` is
// owner-only by ADR-0059 §2. Requires the `acl:write` scope (ADR-0016) — the
// same scope as every other sharing operation; sharing is sharing.
//
// WHY THIS ISN'T JUST `setAcl` WITH AN EXTRA MODE. A sharing state is the
// composition of TWO facts stored in two places: the `Acl` (read authorization,
// consumed by the viewer) and the Org write grant (the third `canWrite` leg).
// Writing them separately would let the pair drift — an org-write row on a
// report the org cannot read is the one combination ADR-0060 §6 forbids. Doing
// both inside ONE UnitOfWork is what makes "read and write are always paired" a
// property of the system rather than a habit of its callers.
//
// The advanced modes (`password`/`allowlist`/`public`) are DISPLAYED by this
// control but never silently overwritten: leaving one requires an explicit
// `confirmDiscard`, and the refusal carries the sentence naming what would be
// lost (ADR-0078 §4).
import {
  ACL_WRITE_SCOPE,
  type AppError,
  advancedSharingDiscardWarning,
  err,
  insufficientScope,
  isAdvancedAclMode,
  makeAcl,
  ok,
  type Report,
  type ReportSharingState,
  type Result,
  reportSharingState,
  type Slug,
  sharingStateTarget,
  validationError,
} from "arp-domain";
import type { AuditEntry } from "../audit";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reportReplayBody,
  reviveReplay,
} from "../idempotent-write";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type {
  AuditLogger,
  GrantStore,
  OrgWriteGrantStore,
  ReportRepository,
  UnitOfWork,
} from "../ports";
import { pruneStaleGrants } from "./set-acl";

const ROUTE = "POST /api/v1/reports/{slug}/sharing";

export interface SetReportSharingDeps extends IdempotentWriteDeps {
  readonly reports: ReportRepository;
  /** The VIEWER-ACCESS grant store (ADR-0056 allowlist redemptions) — needed to
   *  prune rows a mode change no longer authorizes. Deliberately not the write
   *  grant store; named distinctly for exactly that reason. */
  readonly grants: GrantStore;
  readonly orgWriteGrants: OrgWriteGrantStore;
  /** Audit log (ADR-0070) — `report.sharing_set` plus, when the org-write row
   *  actually moves, `grant.org_write.granted` / `.revoked`. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export interface SetReportSharingActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface SetReportSharingInput {
  readonly slug: Slug;
  readonly sharing: ReportSharingState;
  /** Explicit acknowledgement that an ADVANCED mode's configuration will be
   *  discarded (ADR-0078 §4). Without it, a report in `password`/`allowlist`/
   *  `public` is refused rather than silently converted. */
  readonly confirmDiscard?: boolean;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

/** The report plus the state it is now in — returned together because the state
 *  is not derivable from the `Report` aggregate alone (the org-write row lives
 *  outside it), and every caller that renders the result needs both. */
export interface ReportSharingResult {
  readonly report: Report;
  readonly sharing: ReportSharingState;
}

export async function setReportSharing(
  deps: SetReportSharingDeps,
  actor: SetReportSharingActor,
  input: SetReportSharingInput,
): Promise<Result<ReportSharingResult, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;
  const report = found.value;

  const existing = await deps.orgWriteGrants.find(report.id);
  if (!existing.ok) return existing;
  const hadOrgWrite = existing.value !== null;
  const from = reportSharingState(report.acl.mode, hadOrgWrite) ?? report.acl.mode;

  // ADR-0078 §4: an advanced mode is deliberate owner intent. Refuse before
  // anything is written, and say what would have been lost — a confirmation
  // that doesn't name the cost isn't one.
  if (isAdvancedAclMode(report.acl.mode) && input.confirmDiscard !== true) {
    const warning = advancedSharingDiscardWarning(report.acl);
    return err(
      validationError(
        `${warning ?? "This report has advanced sharing configured."} Re-send with confirm_discard to proceed.`,
        "confirm_discard",
      ),
    );
  }

  const target = sharingStateTarget(input.sharing);
  const acl = makeAcl({ mode: target.aclMode });
  if (!acl.ok) return acl;

  // Idempotency (ADR-0039) with the `setFolderVisibility` carve-out, for the
  // same reason: this operation sets STATE, so its fingerprint describes the
  // DESIRED state — and a DERIVED key is a permanent record (`idempotency_keys`
  // has no TTL sweep), so private → org_view → private would replay the first
  // response and never re-save, leaving the report `org` while the API answered
  // `private`. Setting the same state twice is naturally idempotent in effect,
  // so the fallback buys nothing here. An EXPLICIT key means the client owns
  // retry identity, and the usual claim/replay machinery applies.
  // The carve-out is centralized in beginIdempotentWrite via
  // `derivedFallback` — no local guard, so there is only ONE place this
  // decision can be made or drift (issue #233).
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets sharing STATE (the #230 carve-out, now centralized)
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug, input.sharing],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveSharingReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    // Prune first, exactly as setAcl does (ADR-0056 "5e", issue #137): a
    // durable allowlist grant must not outlive the Acl that authorized it.
    // This is the SAME function setAcl calls, not a second implementation —
    // two copies of a revocation rule is one copy too many.
    const pruned = await pruneStaleGrants(deps.grants, report.id, report.acl, acl.value);
    if (!pruned.ok) return pruned;

    const saved = await deps.reports.setAcl(report.id, acl.value);
    if (!saved.ok) return saved;

    // The org-write row moves only when it actually changes — so the audit log
    // records grants and revocations, not every time someone re-asserts a state.
    if (target.orgWrite && !hadOrgWrite) {
      const granted = await deps.orgWriteGrants.grant(report.id, report.orgId, actor.userId);
      if (!granted.ok) return granted;
    } else if (!target.orgWrite && hadOrgWrite) {
      const revoked = await deps.orgWriteGrants.revoke(report.id);
      if (!revoked.ok) return revoked;
    }

    const entries: AuditEntry[] = [
      {
        action: "report.sharing_set",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: report.id,
        // The TRANSITION, not just the endpoint that was hit — `from` degrades
        // to the raw Acl mode when the report was in an advanced one, which is
        // the honest answer rather than a state it was never in.
        meta: { from, to: input.sharing },
      },
    ];
    if (target.orgWrite && !hadOrgWrite) {
      entries.push({
        action: "grant.org_write.granted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: report.id,
        meta: { from, to: input.sharing },
      });
    } else if (!target.orgWrite && hadOrgWrite) {
      entries.push({
        action: "grant.org_write.revoked",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: report.id,
        meta: { from, to: input.sharing },
      });
    }
    const audited = await deps.audit.record(entries);
    if (!audited.ok) return audited;

    const updated: ReportSharingResult = {
      report: { ...report, acl: acl.value },
      sharing: input.sharing,
    };
    if (idemRef) {
      const done = await deps.idempotency.complete(idemRef, {
        responseStatus: 200,
        responseBody: {
          // Never carries a password hash (reportReplayBody's guarantee).
          report: reportReplayBody(updated.report),
          sharing: updated.sharing,
        },
      });
      if (!done.ok) return done;
    }
    return ok(updated);
  });
}

function reviveSharingReplay(
  record: Parameters<typeof reviveReplay>[0],
): Result<ReportSharingResult, AppError> {
  return reviveReplay(record, (body): body is ReportSharingResult => {
    if (typeof body !== "object" || body === null) return false;
    const b = body as Record<string, unknown>;
    return (
      typeof b.sharing === "string" && typeof b.report === "object" && b.report !== null
      // The report half is the same snapshot shape `reviveReportReplay` guards;
      // a body this store wrote always satisfies it.
    );
  });
}
