import { describe, expect, it } from "vitest";
import type { UserId } from "./brand";
import {
  ADVANCED_ACL_MODES,
  isAdvancedAclMode,
  makeReportSharingState,
  REPORT_SHARING_STATES,
  reportSharingState,
  sharingCandidacy,
  sharingStateTarget,
} from "./report-sharing";

const owner = "11111111-1111-1111-1111-111111111111" as UserId;
const colleague = "22222222-2222-2222-2222-222222222222" as UserId;

describe("ReportSharingState (ADR-0078 §3)", () => {
  it("has exactly three states, in increasing order of reach", () => {
    expect(REPORT_SHARING_STATES).toEqual(["private", "org_view", "org_edit"]);
  });

  it("parses a wire value and refuses anything else — including an empty one", () => {
    expect(makeReportSharingState("org_edit")).toEqual({ ok: true, value: "org_edit" });
    // Neither door may default a sharing state the caller didn't state.
    expect(makeReportSharingState("").ok).toBe(false);
    expect(makeReportSharingState("org").ok).toBe(false);
    expect(makeReportSharingState("public").ok).toBe(false);
  });

  it("names the field on a refusal so the API reports it (ADR-0040)", () => {
    const r = makeReportSharingState("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "ValidationError", field: "sharing" });
  });
});

describe("sharingStateTarget — read and write are always paired (ADR-0078 §3)", () => {
  it("maps each state to the Acl mode + org-write row it requires", () => {
    expect(sharingStateTarget("private")).toEqual({ aclMode: "private", orgWrite: false });
    expect(sharingStateTarget("org_view")).toEqual({ aclMode: "org", orgWrite: false });
    expect(sharingStateTarget("org_edit")).toEqual({ aclMode: "org", orgWrite: true });
  });

  it("NEVER produces org-write without org-read", () => {
    // ADR-0060 §6's separation, honored at the scale where violating it would
    // matter most: an org-wide write-without-read would let every member
    // publish into a report none of them can open.
    for (const state of REPORT_SHARING_STATES) {
      const target = sharingStateTarget(state);
      if (target.orgWrite) expect(target.aclMode).toBe("org");
    }
  });
});

describe("reportSharingState — classifying what a report is today", () => {
  it("recognizes the three canonical combinations", () => {
    expect(reportSharingState("private", false)).toBe("private");
    expect(reportSharingState("org", false)).toBe("org_view");
    expect(reportSharingState("org", true)).toBe("org_edit");
  });

  it("returns null for an advanced mode — not expressible as one of the three", () => {
    expect(reportSharingState("password", false)).toBeNull();
    expect(reportSharingState("allowlist", false)).toBeNull();
    expect(reportSharingState("public", false)).toBeNull();
  });

  it("returns null for the API-only org-write-without-org-read combination", () => {
    // The three-state control can never produce this, but the API can (the
    // grant and the Acl are separate resources). Claiming it is one of the
    // three states would be a lie; the listing predicate carries its own
    // org-write leg so such a report is still listed honestly.
    expect(reportSharingState("private", true)).toBeNull();
    expect(reportSharingState("password", true)).toBeNull();
  });
});

describe("advanced Acl modes are protected, not clobbered (ADR-0078 §4)", () => {
  it("names exactly the three modes that carry deliberate owner intent", () => {
    expect(ADVANCED_ACL_MODES).toEqual(["password", "allowlist", "public"]);
  });

  it("does not treat the two states the control can produce as advanced", () => {
    expect(isAdvancedAclMode("private")).toBe(false);
    expect(isAdvancedAclMode("org")).toBe(false);
    expect(isAdvancedAclMode("password")).toBe(true);
    expect(isAdvancedAclMode("allowlist")).toBe(true);
    expect(isAdvancedAclMode("public")).toBe(true);
  });
});

describe("sharingCandidacy — the bulk-apply rule (ADR-0078 §5)", () => {
  const asOwner = (aclMode: Parameters<typeof sharingCandidacy>[0]["aclMode"]) =>
    sharingCandidacy({ ownerId: owner, aclMode }, owner, "org");

  it("accepts a report the actor OWNS that is currently private (org direction)", () => {
    expect(asOwner("private")).toEqual({ kind: "candidate" });
  });

  it("skips a report someone else owns, and says so", () => {
    // The loop asks rather than decides (the ADR-0076 cascade principle):
    // the actor cannot set_acl a colleague's report, so it is named, not tried.
    const r = sharingCandidacy({ ownerId: colleague, aclMode: "private" }, owner, "org");
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toBe("not owned by you");
  });

  it("skips each advanced mode with its OWN reason, never a generic one", () => {
    expect(asOwner("password")).toEqual({ kind: "skip", reason: "password-protected" });
    expect(asOwner("allowlist")).toEqual({ kind: "skip", reason: "allowlisted" });
    expect(asOwner("public")).toEqual({ kind: "skip", reason: "already public" });
  });

  it("skips a report already at the destination state rather than counting it as changed", () => {
    expect(asOwner("org")).toEqual({ kind: "skip", reason: "already shared with your org" });
  });

  describe("the private direction mirrors it", () => {
    const asOwnerPrivate = (aclMode: Parameters<typeof sharingCandidacy>[0]["aclMode"]) =>
      sharingCandidacy({ ownerId: owner, aclMode }, owner, "private");

    it("accepts an owned, currently org-shared report", () => {
      expect(asOwnerPrivate("org")).toEqual({ kind: "candidate" });
    });

    it("skips one that is already private", () => {
      expect(asOwnerPrivate("private")).toEqual({ kind: "skip", reason: "already private" });
    });

    it("still refuses to trample an advanced mode, in EITHER direction", () => {
      // Making a password-protected report "private" would silently discard
      // the password — the same destruction §4 forbids on the single-report
      // control, and a bulk loop is the worst place to do it silently.
      expect(asOwnerPrivate("password")).toEqual({ kind: "skip", reason: "password-protected" });
      expect(asOwnerPrivate("allowlist")).toEqual({ kind: "skip", reason: "allowlisted" });
      expect(asOwnerPrivate("public")).toEqual({ kind: "skip", reason: "already public" });
    });

    it("skips a colleague's report here too", () => {
      const r = sharingCandidacy({ ownerId: colleague, aclMode: "org" }, owner, "private");
      expect(r).toEqual({ kind: "skip", reason: "not owned by you" });
    });
  });

  it("checks ownership BEFORE the mode, so a colleague's password report reads as theirs", () => {
    // Ownership is the fact the actor can act on; the mode of a report they
    // don't own is not their business to have described back to them.
    const r = sharingCandidacy({ ownerId: colleague, aclMode: "password" }, owner, "org");
    expect(r).toEqual({ kind: "skip", reason: "not owned by you" });
  });
});
