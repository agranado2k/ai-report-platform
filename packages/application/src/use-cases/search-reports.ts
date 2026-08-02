// searchReports — the cursor-paginated, searchable read across an org's reports
// (ADR-0036, Reports & Folders; ADR-0053 cursor pagination). Pure orchestration
// over the ReportRepository (ADR-0024): clamp the limit, pass the keyset cursor
// (startingAfter/endingBefore on the report id) + optional query/folder filter,
// return the page {items, hasMore}. Org scope is the tenancy boundary; WITHIN
// it the list is visibility-scoped to the acting user (ADR-0075): only reports
// they own, org/public-shared reports, and reports they hold a write grant on.
// The actor's mirrored email is resolved once (same seam as `hasWriteGrant`,
// ADR-0060 §2) so email-only grants match in the repository predicate.
import type { AppError, FolderId, OrgId, ReportId, Result, UserId } from "arp-domain";
import type { IdentityStore, ReportPage, ReportRepository } from "../ports";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface SearchReportsDeps {
  readonly reports: ReportRepository;
  /** Resolves the actor's mirrored email for the write-grant email match
   *  (ADR-0060 §2 / ADR-0075) — exactly the seam `hasWriteGrant` uses. */
  readonly identities: Pick<IdentityStore, "findEmailByUserId">;
}
export interface SearchReportsActor {
  readonly orgId: OrgId;
  readonly userId: UserId;
}
export interface SearchReportsInput {
  readonly query?: string;
  readonly folderId?: FolderId;
  readonly limit?: number;
  readonly startingAfter?: ReportId;
  readonly endingBefore?: ReportId;
}

export async function searchReports(
  deps: SearchReportsDeps,
  actor: SearchReportsActor,
  input: SearchReportsInput,
): Promise<Result<ReportPage, AppError>> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const email = await deps.identities.findEmailByUserId(actor.userId);
  if (!email.ok) return email;
  return deps.reports.searchByOrg(
    actor.orgId,
    { userId: actor.userId, email: email.value ?? undefined },
    {
      query: input.query,
      folderId: input.folderId,
      limit,
      startingAfter: input.startingAfter,
      endingBefore: input.endingBefore,
    },
  );
}
