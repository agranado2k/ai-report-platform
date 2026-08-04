import { userId } from "arp-domain";
import { describe, expect, it } from "vitest";
import type { SharingApplySummaryInput } from "./report-sharing.server";
import {
  confirmDiscardFromForm,
  confirmDiscardFromJson,
  NO_ACTOR_REASON,
  NO_SCOPE_REASON,
  NON_OWNER_REASON,
  reportFormKey,
  reportSharingBadge,
  reportSharingManagement,
  sharingApplyIsPartial,
  sharingApplySummary,
} from "./report-sharing.server";

const OWNER = userId("00000000-0000-7000-8000-0000000000d1");
const COLLEAGUE = userId("00000000-0000-7000-8000-0000000000d2");
const ACL_WRITE = { userId: OWNER, scopes: ["acl:write"] };

describe("reportSharingBadge (ADR-0078 §12)", () => {
  it("distinguishes the three states, and says what each one means", () => {
    expect(reportSharingBadge({ aclMode: "private", hasOrgWrite: false }).label).toBe("Private");
    expect(reportSharingBadge({ aclMode: "org", hasOrgWrite: false }).label).toBe("Org");
    expect(reportSharingBadge({ aclMode: "org", hasOrgWrite: true }).label).toBe("Org + edit");
  });

  it("says DELETE stays yours on both org states — the thing the coarse control must not hide", () => {
    expect(reportSharingBadge({ aclMode: "org", hasOrgWrite: false }).title).toContain(
      "Only you can edit or delete it",
    );
    expect(reportSharingBadge({ aclMode: "org", hasOrgWrite: true }).title).toContain(
      "Only you can delete it",
    );
  });

  it("gives each advanced mode its OWN label — never folded into a generic 'shared'", () => {
    // A password-protected report and an org-visible one are not the same
    // thing; a control that displayed them identically would be one click from
    // overwriting one with the other.
    expect(reportSharingBadge({ aclMode: "public", hasOrgWrite: false }).label).toBe("Public");
    expect(reportSharingBadge({ aclMode: "password", hasOrgWrite: false }).label).toBe("Password");
    expect(reportSharingBadge({ aclMode: "allowlist", hasOrgWrite: false }).label).toBe(
      "Allowlist",
    );
  });

  it("refuses to call an org-EDITABLE report 'Private' (the API-only combination)", () => {
    // The exact lie `reportSharingState` returns null to prevent. This row is
    // editable by the whole org and openable by none of them.
    const badge = reportSharingBadge({ aclMode: "private", hasOrgWrite: true });
    expect(badge.label).not.toBe("Private");
    expect(badge.title).toContain("cannot open it");
  });
});

describe("reportSharingManagement — the server decides, the client renders (ADR-0078 §12)", () => {
  const own = {
    ownerId: OWNER,
    aclMode: "private" as const,
    hasOrgWrite: false,
    allowedEmailCount: 0,
  };

  it("enables the control for the owner with acl:write", () => {
    const m = reportSharingManagement(own, ACL_WRITE);
    expect(m).toMatchObject({ manageable: true, blockedReason: null, state: "private" });
  });

  it("blocks a non-owner with the SERVER's own reason", () => {
    // Derived from the application layer's constant, so what a member reads is
    // what the server would have told them.
    const m = reportSharingManagement({ ...own, ownerId: COLLEAGUE }, ACL_WRITE);
    expect(m.manageable).toBe(false);
    expect(m.blockedReason).toBe(NON_OWNER_REASON);
    expect(NON_OWNER_REASON).toContain("own this report");
  });

  it("blocks a session without acl:write, BEFORE the ownership check", () => {
    // An edit-token actor holds `reports:write` only (ADR-0063). Rendering the
    // control live for one would POST straight into a 403.
    const m = reportSharingManagement(own, { userId: OWNER, scopes: ["reports:write"] });
    expect(m.blockedReason).toBe(NO_SCOPE_REASON);
  });

  it("degrades to a read-only render with no actor at all", () => {
    expect(reportSharingManagement(own, null).blockedReason).toBe(NO_ACTOR_REASON);
  });

  it("still reports the STATE on a blocked row — the badge must stay truthful", () => {
    // A colleague may not change the sharing, but the badge above the disabled
    // control still has to be truthful about what the sharing IS.
    const m = reportSharingManagement(
      { ownerId: COLLEAGUE, aclMode: "org", hasOrgWrite: true, allowedEmailCount: 0 },
      ACL_WRITE,
    );
    expect(m.state).toBe("org_edit");
  });

  it("withholds the discard warning on a row the actor cannot change (L-1)", () => {
    // The warning is the CONFIRMATION's sentence, and a row nobody can change
    // has no confirmation to offer. Serializing it anyway put "shared with N
    // addresses by invitation" into a non-owner's loader payload.
    const blocked = reportSharingManagement(
      { ownerId: COLLEAGUE, aclMode: "allowlist", hasOrgWrite: false, allowedEmailCount: 4 },
      ACL_WRITE,
    );
    expect(blocked.manageable).toBe(false);
    expect(blocked.discardWarning).toBeNull();
    // …while the owner still gets it, with the REAL count.
    const owned = reportSharingManagement(
      { ownerId: OWNER, aclMode: "allowlist", hasOrgWrite: false, allowedEmailCount: 4 },
      ACL_WRITE,
    );
    expect(owned.discardWarning).toContain("4 addresses");
  });

  it("names the REAL roster size, never a fabricated default (ADR-0078 §4)", () => {
    // The old `?? 1` fallback made every allowlisted report warn about "1
    // address" while the server's 422 carried the true N.
    for (const n of [1, 2, 7]) {
      const m = reportSharingManagement(
        { ownerId: OWNER, aclMode: "allowlist", hasOrgWrite: false, allowedEmailCount: n },
        ACL_WRITE,
      );
      expect(m.discardWarning).toContain(n === 1 ? "1 address" : `${n} addresses`);
    }
  });

  it("carries a discard warning for an advanced mode, and none for the plain ones", () => {
    expect(
      reportSharingManagement(
        { ownerId: OWNER, aclMode: "password", hasOrgWrite: false, allowedEmailCount: 0 },
        ACL_WRITE,
      ).discardWarning,
    ).toContain("remove the password");
    expect(reportSharingManagement(own, ACL_WRITE).discardWarning).toBeNull();
    expect(
      reportSharingManagement(
        { ownerId: OWNER, aclMode: "org", hasOrgWrite: false, allowedEmailCount: 0 },
        ACL_WRITE,
      ).discardWarning,
    ).toBeNull();
  });
});

describe("confirmDiscardFromJson / confirmDiscardFromForm (ADR-0078 §4)", () => {
  // The guard whose own comment names the hazard: `Boolean(...)` would let
  // "false" and "0" through, and a client would delete a password by sending a
  // string it thought meant no.
  it("the JSON door accepts ONLY the boolean true", () => {
    expect(confirmDiscardFromJson(true)).toBe(true);
    for (const truthyButNotTrue of ["true", "false", "0", "yes", 1, {}, []]) {
      expect(confirmDiscardFromJson(truthyButNotTrue)).toBe(false);
    }
  });

  it("the JSON door refuses absence and every falsy value", () => {
    for (const v of [undefined, null, false, 0, ""]) {
      expect(confirmDiscardFromJson(v)).toBe(false);
    }
  });

  it("the FORM door accepts ONLY the exact string the hidden input posts", () => {
    expect(confirmDiscardFromForm("true")).toBe(true);
    for (const v of [true, "false", "0", "TRUE", " true", "on", null, undefined]) {
      expect(confirmDiscardFromForm(v)).toBe(false);
    }
  });
});

describe("reportFormKey — a staged action must not outlive its state (#237)", () => {
  it("changes when the acl mode moves", () => {
    expect(reportFormKey({ aclMode: "private", hasOrgWrite: false })).not.toBe(
      reportFormKey({ aclMode: "org", hasOrgWrite: false }),
    );
  });

  it("changes when ONLY the org-write row moves", () => {
    // org_view → org_edit keeps acl=org, so a key that watched the mode alone
    // would leave the form mounted across a real state change.
    expect(reportFormKey({ aclMode: "org", hasOrgWrite: false })).not.toBe(
      reportFormKey({ aclMode: "org", hasOrgWrite: true }),
    );
  });

  it("is stable when nothing moved, so a REFUSAL keeps what was chosen", () => {
    expect(reportFormKey({ aclMode: "org", hasOrgWrite: true })).toBe(
      reportFormKey({ aclMode: "org", hasOrgWrite: true }),
    );
  });
});

describe("sharingApplySummary — the bulk apply never rounds up (ADR-0078 §5)", () => {
  const base = { sharing: "org_view" as const, total: 3, changed: [], skipped: [], failed: [] };

  it("names every report that changed", () => {
    const s = sharingApplySummary({ ...base, changed: [{ title: "Q3" }, { title: "Q4" }] });
    expect(s).toContain("2 reports");
    expect(s).toContain("Q3, Q4");
  });

  it("names every report it LEFT ALONE, with the reason", () => {
    const s = sharingApplySummary({
      ...base,
      changed: [{ title: "Mine" }],
      skipped: [{ title: "Theirs", reason: "not owned by you" }],
    });
    expect(s).toContain("Theirs (not owned by you)");
  });

  it("names every FAILURE separately and loudly", () => {
    const s = sharingApplySummary({
      ...base,
      failed: [{ title: "Broken", reason: "db down" }],
    });
    expect(s).toContain("FAILED");
    expect(s).toContain("Broken (db down)");
  });

  it("says plainly that nothing changed rather than implying success", () => {
    const s = sharingApplySummary({
      ...base,
      skipped: [{ title: "A", reason: "already public" }],
    });
    expect(s).toContain("No reports changed");
  });

  it("says the folder was empty rather than reporting an empty success", () => {
    expect(sharingApplySummary({ ...base, total: 0 })).toContain("no reports in this folder");
  });
});

describe("sharingApplyIsPartial — the banner's success/warning switch", () => {
  // The SAME predicate the API mapper serializes as `partial` and the use case
  // asserts on a real failed run — re-exported here, never re-implemented.
  const base: SharingApplySummaryInput = {
    sharing: "org_view",
    total: 1,
    changed: [],
    skipped: [],
    failed: [],
  };

  it("a clean run is not a warning", () => {
    const outcome: SharingApplySummaryInput = { ...base, changed: [{ title: "A" }] };
    expect(sharingApplyIsPartial(outcome)).toBe(false);
  });

  it("a SKIP is not a warning — the candidate rule working is not a failure", () => {
    const outcome: SharingApplySummaryInput = {
      ...base,
      skipped: [{ title: "A", reason: "already public" }],
    };
    expect(sharingApplyIsPartial(outcome)).toBe(false);
  });

  it("a FAILURE is", () => {
    const outcome: SharingApplySummaryInput = {
      ...base,
      failed: [{ title: "A", reason: "db down" }],
    };
    expect(sharingApplyIsPartial(outcome)).toBe(true);
  });
});
