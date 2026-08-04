// Report sharing state — the three-state model the sharing control speaks
// (ADR-0078). Pure value-object logic: no I/O, no persistence, no copy about
// warnings (that belongs to the surface that renders it).
//
// WHY A NEW VOCABULARY. A report's reach is decided by TWO facts that live in
// two different places: its `Acl` (ADR-0056 — READ authorization, consumed by
// the viewer) and, as of ADR-0078, whether it carries an Org write grant
// (`report_org_write_grants` — the third leg of the `canWrite` seam). Neither
// alone answers "how is this shared?", and every surface that asks — the
// dashboard badge, the API, MCP, the audit log — must get the SAME answer. So
// the composition is named once, here.
//
// THE INVARIANT THIS FILE EXISTS TO HOLD: read and write are always paired.
// `sharingStateTarget` can never produce an org write grant on a report the org
// cannot read. ADR-0060 §6 keeps the read capability (Acl) and the write
// capability (grant) deliberately separate; at ORG scale, composing them the
// wrong way round would hand every member of the org the ability to publish
// content into a report none of them can open.
import type { AppError } from "./errors";
import { validationError } from "./errors";
import type { Result } from "./result";
import { err, ok } from "./result";
import type { AclMode } from "./value-objects";

/** The three sharing states, in increasing order of reach (ADR-0078 §3).
 *  Deliberately NOT `AclMode` values: a state is a COMPOSITION of an Acl mode
 *  and an org write grant, and naming it as such is what keeps write out of the
 *  read-only `Acl`. */
export const REPORT_SHARING_STATES = ["private", "org_view", "org_edit"] as const;
export type ReportSharingState = (typeof REPORT_SHARING_STATES)[number];

/** Parse a wire/form value into a `ReportSharingState` (ADR-0078). Lives beside
 *  the enum so the JSON API route, the MCP tool and the dashboard action share
 *  ONE validator rather than three copies that drift — the lesson
 *  `makeFolderVisibility` already records. Refusing an empty value is the
 *  point: no door may default a sharing state the caller didn't state. */
export function makeReportSharingState(raw: string): Result<ReportSharingState, AppError> {
  if ((REPORT_SHARING_STATES as readonly string[]).includes(raw)) {
    return ok(raw as ReportSharingState);
  }
  return err(
    validationError(`sharing must be one of: ${REPORT_SHARING_STATES.join(", ")}`, "sharing"),
  );
}

/** What a state requires of the two underlying facts (ADR-0078 §3). The single
 *  place a sharing state becomes an `Acl` mode plus an org-write decision —
 *  so "write is never offered without read" is one testable property of one
 *  function rather than a convention every call site has to remember. */
export function sharingStateTarget(state: ReportSharingState): {
  readonly aclMode: AclMode;
  readonly orgWrite: boolean;
} {
  switch (state) {
    case "private":
      return { aclMode: "private", orgWrite: false };
    case "org_view":
      return { aclMode: "org", orgWrite: false };
    case "org_edit":
      return { aclMode: "org", orgWrite: true };
  }
}

/** Which sharing state a report is in TODAY, or `null` when it isn't in one.
 *
 *  Null has two distinct causes, and both are deliberate:
 *   - the report is in an ADVANCED mode (`password`/`allowlist`/`public`),
 *     which the three-state control displays but never silently overwrites; or
 *   - it carries an org write grant WITHOUT `org` read — a combination the
 *     control can never produce, but the API can (the grant and the `Acl` are
 *     separate resources).
 *
 *  Returning `null` rather than rounding either case down to "private" is the
 *  honesty requirement: a badge that reads `Private` over a report the whole
 *  org can edit is exactly the class of lie ADR-0075/0076 were written to fix. */
export function reportSharingState(mode: AclMode, hasOrgWrite: boolean): ReportSharingState | null {
  if (mode === "org") return hasOrgWrite ? "org_edit" : "org_view";
  if (mode === "private" && !hasOrgWrite) return "private";
  return null;
}

/** The `Acl` modes that carry deliberate owner intent the three-state control
 *  must never silently discard (ADR-0078 §4): a password, a curated allowlist,
 *  or a link deliberately published to the world. Switching a report out of one
 *  of these takes an explicit confirmation step. */
export const ADVANCED_ACL_MODES: readonly AclMode[] = ["password", "allowlist", "public"];

export function isAdvancedAclMode(mode: AclMode): boolean {
  return ADVANCED_ACL_MODES.includes(mode);
}

/** Which way a bulk apply is going (ADR-0078 §5). `org` shares the reports
 *  inside a folder; `private` takes them back. */
export type SharingDirection = "org" | "private";

/** Whether one report inside a folder is a candidate for the bulk apply, and
 *  when it isn't, WHY — in the words the operator will read. */
export type SharingCandidacy =
  | { readonly kind: "candidate" }
  | { readonly kind: "skip"; readonly reason: string };

const CANDIDATE: SharingCandidacy = { kind: "candidate" };
const skip = (reason: string): SharingCandidacy => ({ kind: "skip", reason });

/**
 * THE CANDIDATE RULE (ADR-0078 §5), chosen for least surprise.
 *
 * A report inside the folder is a candidate only if the actor OWNS it and its
 * mode is the one the direction starts from. Everything else is skipped and
 * NAMED — the folder cascade's honest partial-reporting shape, which never
 * counts an untouched report as a success.
 *
 * Ownership is checked FIRST, and not only because `set_acl` is owner-only
 * (ADR-0059 §2): the mode of a report the actor does not own is not their
 * business to have described back to them.
 *
 * Advanced modes are refused in BOTH directions. The org direction must not
 * publish a password-protected report; the private direction must not silently
 * discard the password. §4 forbids that destruction on the single-report
 * control, and a loop over N reports is the worst possible place to make an
 * exception.
 *
 * The reasons are the DOMAIN's, not the UI's — the use case, the API response
 * and the dashboard banner all quote the same sentence, so what an operator
 * reads is what the server actually decided.
 */
export function sharingCandidacy(
  report: { readonly ownerId: string; readonly aclMode: AclMode },
  actorUserId: string,
  direction: SharingDirection,
): SharingCandidacy {
  if (report.ownerId !== actorUserId) return skip("not owned by you");
  switch (report.aclMode) {
    case "password":
      return skip("password-protected");
    case "allowlist":
      return skip("allowlisted");
    case "public":
      return skip("already public");
    case "private":
      return direction === "org" ? CANDIDATE : skip("already private");
    case "org":
      return direction === "private" ? CANDIDATE : skip("already shared with your org");
  }
}
