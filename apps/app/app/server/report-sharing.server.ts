// Report sharing, as the DASHBOARD sees it (ADR-0078 §7) — the report-row
// counterpart to `folder-sharing.server.ts`, and deliberately built to the same
// doctrine.
//
// Everything here lives on the SERVER on purpose. The dashboard's components
// must never import `arp-domain` (its barrel pulls `node:crypto` into the
// client bundle), so every domain-derived decision a row renders — "may I
// change this report's sharing?", "which badge?", "what would this discard?" —
// is computed here and handed over as plain data.
//
// THE SERVER SENDS CONCLUSIONS, NOT INPUTS. `ownerId` never reaches the client.
// A row the actor does not own renders its control DISABLED with the server's
// own reason; it does not receive the ownership fact and decide for itself.
// That is the `folderManagement` rule, and it exists because an independently
// invented client rule drifts from the server that actually decides.

// Re-exported, not re-implemented: the banner's success/warning switch is the
// SAME condition the API mapper serializes as `partial` and the use case's own
// tests assert. Two spellings of it — one of them referenced only by its own
// test — is how the real call site drifts alone.
export { sharingApplyIsPartial } from "arp-application";

import { SETTING_SHARING_NOT_OWNER } from "arp-application";
import {
  type AclMode,
  advancedSharingDiscardWarning,
  hasFolderManagementScope,
  type ReportSharingState,
  reportSharingState,
  type UserId,
} from "arp-domain";
import type { BadgeTone } from "arp-ui";

/** No resolved actor — a signed-out or degraded dashboard render. */
export const NO_ACTOR_REASON = "Sign in to change this report's sharing.";

/** The `acl:write` gate every sharing use case applies first (ADR-0016). Not
 *  every actor that reaches the dashboard carries it — an edit-token actor
 *  holds `reports:write` only (ADR-0063) — and a control rendered live for such
 *  a session would POST straight into a 403. */
export const NO_SCOPE_REASON = "This session isn't allowed to change report sharing.";

/** The 403 `loadOwnedReport` returns, said in the UI's voice — DERIVED from the
 *  application layer's own constant so the sentence a member reads is the
 *  sentence the server would have given them. */
export const NON_OWNER_REASON = `${SETTING_SHARING_NOT_OWNER.charAt(0).toUpperCase()}${SETTING_SHARING_NOT_OWNER.slice(1)}.`;

export interface ReportBadge {
  readonly label: string;
  readonly tone: BadgeTone;
  /** The whole claim, in a sentence — rendered as the badge's `title`. The
   *  label shares a crowded row with a truncating title, so the nuance lives
   *  here rather than being cut out of the label. */
  readonly title: string;
}

/**
 * The row's sharing badge (ADR-0078 §7).
 *
 * Unlike the folder sidebar's, this badge is never in an "unknown" state: the
 * two facts it needs ride the listing projection, so every row can make a claim
 * it can actually support. The advanced modes get their OWN labels rather than
 * being folded into "shared" — a password-protected report and an org-visible
 * one are not the same thing, and a control that displayed them identically
 * would be the first step towards overwriting one with the other.
 */
export function reportSharingBadge(input: {
  readonly aclMode: AclMode;
  readonly hasOrgWrite: boolean;
}): ReportBadge {
  const state = reportSharingState(input.aclMode, input.hasOrgWrite);
  if (state === "org_edit") {
    return {
      label: "Org + edit",
      tone: "warning",
      title: "Everyone in your org can view AND edit this report. Only you can delete it.",
    };
  }
  if (state === "org_view") {
    return {
      label: "Org",
      tone: "warning",
      title: "Everyone in your org can view this report. Only you can edit or delete it.",
    };
  }
  if (state === "private") {
    return { label: "Private", tone: "neutral", title: "Only you can open this report." };
  }
  // No sharing state — an advanced mode, or the API-only combination of an org
  // write grant without org read. Both must read as themselves.
  switch (input.aclMode) {
    case "public":
      return {
        label: "Public",
        tone: "danger",
        title: "Anyone with the link can open this report, inside or outside your org.",
      };
    case "password":
      return {
        label: "Password",
        tone: "brand",
        title: "Anyone with the link AND the password can open this report.",
      };
    case "allowlist":
      return {
        label: "Allowlist",
        tone: "brand",
        title: "Only the specific people you invited can open this report.",
      };
    default:
      // `private`/`org` already returned above unless an org-write row exists
      // without org read. Saying "Private" here would be the exact lie
      // `reportSharingState` returns null to prevent.
      return {
        label: "Edit only",
        tone: "danger",
        title:
          "Everyone in your org can edit this report but cannot open it — set its sharing to fix that.",
      };
  }
}

export interface ReportSharingManagement {
  /** Would `setReportSharing` + the `acl:write` gate accept this actor? */
  readonly manageable: boolean;
  /** Why the control is disabled, or null when it isn't. */
  readonly blockedReason: string | null;
  /** The state the report is in now, or null when it's in one the three-state
   *  control cannot express (an advanced mode, or org-write-without-org-read). */
  readonly state: ReportSharingState | null;
  /** What a change would DISCARD, or null when it would discard nothing. Its
   *  presence is exactly what makes the control ask for a confirmation. */
  readonly discardWarning: string | null;
}

export interface SharingActor {
  readonly userId: UserId;
  readonly scopes: readonly string[];
}

/**
 * Would `setReportSharing` accept this actor on this report? Every leg is the
 * rule the use case itself applies, in the same order — the scope gate first
 * (it runs first), then ownership — so a control this module enables is a
 * control the server will accept.
 */
export function reportSharingManagement(
  report: {
    readonly ownerId: UserId;
    readonly aclMode: AclMode;
    readonly hasOrgWrite: boolean;
    readonly allowedEmailCount?: number;
  },
  actor: SharingActor | null,
): ReportSharingManagement {
  const state = reportSharingState(report.aclMode, report.hasOrgWrite);
  // The listing projection carries the mode but not the allowlist roster, so
  // the warning is composed from a minimal Acl of the right shape. It is only
  // ever a WARNING — the use case re-derives it from the real Acl before
  // refusing, so the count the operator sees can never authorize anything.
  const discardWarning = advancedSharingDiscardWarning(
    report.aclMode === "allowlist"
      ? {
          mode: "allowlist",
          allowedEmails: new Array(report.allowedEmailCount ?? 1).fill(""),
          accessTtlSeconds: 0,
        }
      : report.aclMode === "password"
        ? { mode: "password", passwordHash: "" }
        : { mode: report.aclMode },
  );
  const blocked = (blockedReason: string): ReportSharingManagement => ({
    manageable: false,
    blockedReason,
    state,
    discardWarning,
  });
  if (!actor) return blocked(NO_ACTOR_REASON);
  if (!hasFolderManagementScope(actor.scopes)) return blocked(NO_SCOPE_REASON);
  if (report.ownerId !== actor.userId) return blocked(NON_OWNER_REASON);
  return { manageable: true, blockedReason: null, state, discardWarning };
}

/**
 * The identity of a report row's sharing FORM, so a staged action cannot
 * outlive the state it was staged for.
 *
 * This is the #237 hazard, transplanted: an uncontrolled form inside a panel
 * that re-renders in place keeps its DOM nodes, and with them whatever was
 * last selected — so a confirmation ticked for "discard the password" would
 * still be ticked under a panel that had already moved on. Rendered as the
 * React `key`, so a successful action REMOUNTS the form empty while a refusal
 * keeps what was chosen (which is what a retry needs). `autoComplete="off"`
 * covers browser restoration, which no key reaches.
 */
export function reportFormKey(input: {
  readonly aclMode: AclMode;
  readonly hasOrgWrite: boolean;
}): string {
  return `${input.aclMode}:${input.hasOrgWrite ? "orgwrite" : "noorgwrite"}`;
}

/** The three states, as the menu offers them — label + the sentence under it.
 *  Ordered by increasing reach, so the control reads as a ladder. */
export const SHARING_CHOICES: readonly {
  readonly value: ReportSharingState;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "private", label: "Private", hint: "Only you can open it." },
  { value: "org_view", label: "Org can view", hint: "Everyone in your org can open it." },
  {
    value: "org_edit",
    label: "Org can view and edit",
    hint: "Everyone in your org can open AND edit it. Only you can delete it.",
  },
];

// ── The folder bulk apply, as the sidebar panel presents it ────────────────

/** The bulk-apply outcome, in the shape the banner renders. Mirrors
 *  `CascadeOutcome` (ADR-0076) deliberately: same three lists, same refusal to
 *  round a partial result up into a success. */
export interface SharingApplySummaryInput {
  readonly sharing: ReportSharingState;
  readonly total: number;
  readonly changed: readonly { readonly title: string }[];
  readonly skipped: readonly { readonly title: string; readonly reason: string }[];
  readonly failed: readonly { readonly title: string; readonly reason: string }[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const reports = (n: number) => `${n} ${plural(n, "report", "reports")}`;

const STATE_WORDS: Record<ReportSharingState, string> = {
  private: "private",
  org_view: "visible to your org",
  org_edit: "visible and editable by your org",
};

/** The one sentence the dashboard shows after a bulk apply. Every report that
 *  did NOT change is named with the server's own reason — a bulk action that
 *  reported only its successes would be the lie this surface exists to avoid. */
export function sharingApplySummary(outcome: SharingApplySummaryInput): string {
  const word = STATE_WORDS[outcome.sharing];
  if (outcome.total === 0) return "There are no reports in this folder to share.";

  const head =
    outcome.changed.length > 0
      ? `Made ${reports(outcome.changed.length)} ${word}: ${outcome.changed.map((c) => c.title).join(", ")}.`
      : `No reports changed.`;
  const skippedTail =
    outcome.skipped.length > 0
      ? ` ${outcome.skipped.length} left alone: ${outcome.skipped.map((s) => `${s.title} (${s.reason})`).join(", ")}.`
      : "";
  const failedTail =
    outcome.failed.length > 0
      ? ` ${outcome.failed.length} ${plural(outcome.failed.length, "report", "reports")} FAILED: ${outcome.failed.map((f) => `${f.title} (${f.reason})`).join(", ")}.`
      : "";
  return `${head}${skippedTail}${failedTail}`;
}

/** v1 covers the ORG direction only (ADR-0078 §5). A person-level folder share
 *  stays visibility-only exactly as it is today, and the panel has to SAY so —
 *  an operator who has just added a colleague by email would otherwise
 *  reasonably assume the reports came with it. */
export const PERSON_SHARE_LIMIT_NOTICE =
  "Sharing this folder with one person shows them the folder only — not the reports inside. " +
  "Use the org options above, or share individual reports from their row.";
