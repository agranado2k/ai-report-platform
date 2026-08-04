// applyFolderSharingToReports — the folder-scoped bulk apply (ADR-0078 §5).
//
// THE PROBLEM IT SOLVES: sharing a folder with the org makes the FOLDER visible
// and nothing inside it (ADR-0076 §6, deliberately). This is the explicit
// action that reaches the reports — by changing each report's own `Acl`, so the
// listing surface and the viewer keep working through the paths they already
// have. It does NOT reverse ADR-0076: no folder fact is ever consulted at
// authorization time, here or downstream.
//
// WHY A LOOP AND NOT RECURSIVE SQL. Every iteration calls the SAME
// `setReportSharing` use case, so every report re-runs its own owner-only gate,
// its own advanced-mode protection, and its own audit row. ADR-0076's cascade
// amendment says why in one sentence: re-implementing that gate in a recursive
// UPDATE is "the classic place an authorization bypass gets introduced".
//
// WHY IT ONLY NEEDS TO SEE THE FOLDER. The real authority here is per-report
// and is enforced per-report. Requiring folder OWNERSHIP would stop a member
// from bulk-sharing their OWN reports inside a legacy or org-visible folder
// they happen not to own — a restriction that protects nothing, since the loop
// can only ever touch reports the actor already owns. So the folder guard is
// `loadVisibleFolder`: you must be able to see the folder (existence is
// private, ADR-0075/0076), and after that each report speaks for itself.
//
// SCOPE IS THE ACTOR'S VISIBLE LISTING, exactly as ADR-0076's cascade walks the
// actor's visible tree. A colleague's private report inside the folder is not
// "skipped" — it was never a candidate, and the surface cannot admit it exists.
import {
  ACL_WRITE_SCOPE,
  type AppError,
  err,
  type FolderId,
  insufficientScope,
  ok,
  type ReportSharingState,
  type Result,
  type SharingDirection,
  type Slug,
  sharingCandidacy,
  validationError,
} from "arp-domain";
import { type FolderAccessDeps, loadVisibleFolder, type TenancyActor } from "../load-owned";
import type { FolderRepository } from "../ports";
import { type SetReportSharingDeps, setReportSharing } from "./set-report-sharing";

/**
 * The most reports one bulk apply may cover (ADR-0078 §5), mirroring
 * ADR-0076's `MAX_CASCADE` and chosen for the same reason.
 *
 * The loop is sequential and non-transactional, and every iteration is a
 * `loadOwnedReport` + an org-write probe + a `uow.run(prune + setAcl + grant +
 * audit)` — several serialized round trips — all inside ONE serverless
 * invocation. A folder wide enough to exhaust that budget would commit N
 * reports and then time out with no summary of what changed: the one hole in
 * the honesty story. So past this size the request is refused PRE-FLIGHT,
 * before anything is written, and says so. Silent truncation reporting success
 * was never an option.
 */
export const MAX_SHARING_BULK_APPLY = 50;

export interface ApplyFolderSharingToReportsDeps extends SetReportSharingDeps, FolderAccessDeps {
  readonly folders: FolderRepository;
}

export interface ApplyFolderSharingToReportsActor extends TenancyActor {
  readonly scopes: readonly string[];
}

export interface ApplyFolderSharingToReportsInput {
  readonly folderId: FolderId;
  readonly sharing: ReportSharingState;
}

/** One report the loop touched or declined to touch. `slug` is the handle the
 *  caller can act on; `title` is what an operator will recognize. */
export interface SharingApplyEntry {
  readonly slug: string;
  readonly title: string;
}

export interface SharingApplyRefusal extends SharingApplyEntry {
  /** The server's OWN reason — the domain's `sharingCandidacy` wording for a
   *  skip, or the use case's own error message for a failure. Never invented
   *  here, so what the operator reads is what the server decided. */
  readonly reason: string;
}

/**
 * The honest partial-result shape, borrowed wholesale from ADR-0076's
 * `cascadeSummary`: a bulk apply that could not change everything is NOT a
 * success, and every report it did not change is NAMED with its reason.
 *
 * `skipped` and `failed` are deliberately separate. A skip is the rule working
 * as designed (a colleague's report, a password-protected one); a failure is
 * the server refusing or erroring on something the rule thought was a
 * candidate. Collapsing them would hide the second kind inside the first.
 */
export interface SharingApplyOutcome {
  readonly sharing: ReportSharingState;
  /** Reports whose sharing actually moved. */
  readonly changed: readonly SharingApplyEntry[];
  /** Reports the candidate rule declined, each with its reason. */
  readonly skipped: readonly SharingApplyRefusal[];
  /** Candidates the server then refused or errored on. */
  readonly failed: readonly SharingApplyRefusal[];
  /** How many reports were examined — the size of the actor's visible listing
   *  for this folder, which is what "the N reports inside" must mean. */
  readonly total: number;
}

/** Is this outcome anything less than a clean success? Named rather than
 *  re-derived at each call site, for the reason ADR-0076 records: a condition
 *  inlined at the surface can be inverted without a single test noticing. */
export function sharingApplyIsPartial(outcome: SharingApplyOutcome): boolean {
  return outcome.failed.length > 0;
}

export async function applyFolderSharingToReports(
  deps: ApplyFolderSharingToReportsDeps,
  actor: ApplyFolderSharingToReportsActor,
  input: ApplyFolderSharingToReportsInput,
): Promise<Result<SharingApplyOutcome, AppError>> {
  if (!actor.scopes.includes(ACL_WRITE_SCOPE)) return err(insufficientScope(ACL_WRITE_SCOPE));

  const folder = await loadVisibleFolder(deps.folders, actor, input.folderId, deps);
  if (!folder.ok) return folder;

  const email = await deps.identities.findEmailByUserId(actor.userId);
  if (!email.ok) return email;

  // Enumerate FIRST, one over the cap, so an oversized folder is refused before
  // a single report is touched — a refusal must change nothing at all.
  const listed = await deps.reports.searchByOrg(
    actor.orgId,
    { userId: actor.userId, email: email.value ?? undefined },
    { folderId: input.folderId, limit: MAX_SHARING_BULK_APPLY + 1 },
  );
  if (!listed.ok) return listed;
  if (listed.value.items.length > MAX_SHARING_BULK_APPLY) {
    return err(
      validationError(
        `this folder holds more than the ${MAX_SHARING_BULK_APPLY} reports one change can cover. Nothing was changed; share them in smaller folders, or one at a time.`,
        "folder_id",
      ),
    );
  }

  const direction: SharingDirection = input.sharing === "private" ? "private" : "org";
  const changed: SharingApplyEntry[] = [];
  const skipped: SharingApplyRefusal[] = [];
  const failed: SharingApplyRefusal[] = [];

  for (const summary of listed.value.items) {
    const entry: SharingApplyEntry = { slug: summary.slug, title: summary.title };
    // The candidate rule needs the OWNER and the CURRENT mode, and the listing
    // projection carries both (ADR-0078 §7) — read from the join the
    // visibility predicate was already paying for, so classifying N reports
    // costs no extra round trips. It is only a FILTER: the authoritative gate
    // is still setReportSharing's own owner check, re-run per report below.
    const candidacy = sharingCandidacy(
      { ownerId: summary.ownerId, aclMode: summary.aclMode },
      actor.userId,
      direction,
    );
    if (candidacy.kind === "skip") {
      skipped.push({ ...entry, reason: candidacy.reason });
      continue;
    }
    // The same use case a single-report change goes through: same owner gate,
    // same advanced-mode protection, same audit row. `confirmDiscard` is NOT
    // forwarded — the candidate rule has already excluded every advanced mode,
    // so there is nothing here that could need confirming, and passing it would
    // turn a bulk action into a bulk discard.
    const applied = await setReportSharing(deps, actor, {
      slug: summary.slug as Slug,
      sharing: input.sharing,
    });
    if (applied.ok) changed.push(entry);
    else failed.push({ ...entry, reason: applied.error.message });
  }

  return ok({
    sharing: input.sharing,
    changed,
    skipped,
    failed,
    total: listed.value.items.length,
  });
}
