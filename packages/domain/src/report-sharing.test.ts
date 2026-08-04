import { describe, expect, it } from "vitest";
import type { UserId } from "./brand";
import {
  ADVANCED_ACL_MODES,
  advancedSharingDiscardWarning,
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

describe("advancedSharingDiscardWarning — the confirmation copy (ADR-0078 §4)", () => {
  it("says nothing for the two states the control can produce", () => {
    expect(advancedSharingDiscardWarning({ mode: "private" })).toBeNull();
    expect(advancedSharingDiscardWarning({ mode: "org" })).toBeNull();
  });

  it("names the PASSWORD, not a generic 'your settings'", () => {
    const w = advancedSharingDiscardWarning({ mode: "password", passwordHash: "x" });
    expect(w).toContain("remove the password");
  });

  it("counts the allowlist, and agrees with itself in the singular", () => {
    const one = advancedSharingDiscardWarning({
      mode: "allowlist",
      allowedEmails: ["a@x.com"],
      accessTtlSeconds: 60,
    });
    expect(one).toContain("1 address");
    expect(one).toContain("remove it");

    const many = advancedSharingDiscardWarning({
      mode: "allowlist",
      allowedEmails: ["a@x.com", "b@x.com"],
      accessTtlSeconds: 60,
    });
    expect(many).toContain("2 addresses");
    expect(many).toContain("remove them");
  });

  it("says what going away from PUBLIC costs", () => {
    const w = advancedSharingDiscardWarning({ mode: "public" });
    expect(w).toContain("existing links will stop working");
  });
});

describe("sharingCandidacy — the bulk-apply rule (ADR-0078 §5)", () => {
  const ownedAt = (
    aclMode: Parameters<typeof sharingCandidacy>[0]["aclMode"],
    hasOrgWrite = false,
  ) => ({ ownerId: owner, aclMode, hasOrgWrite }) as const;

  // The three sharing states, spelled as the two facts that compose them —
  // exactly what the listing projection carries.
  const STATE_FACTS = {
    private: ownedAt("private"),
    org_view: ownedAt("org"),
    org_edit: ownedAt("org", true),
  } as const;

  it("skips a report someone else owns, and says so", () => {
    // The loop asks rather than decides (the ADR-0076 cascade principle):
    // the actor cannot set_acl a colleague's report, so it is named, not tried.
    const r = sharingCandidacy(
      { ownerId: colleague, aclMode: "private", hasOrgWrite: false },
      owner,
      "org_view",
    );
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toBe("not owned by you");
  });

  it("checks ownership BEFORE the state, so a colleague's password report reads as theirs", () => {
    // Ownership is the fact the actor can act on; the state of a report they
    // don't own is not their business to have described back to them.
    const r = sharingCandidacy(
      { ownerId: colleague, aclMode: "password", hasOrgWrite: false },
      owner,
      "org_view",
    );
    expect(r).toEqual({ kind: "skip", reason: "not owned by you" });
  });

  it("skips each advanced mode with its OWN reason, towards EVERY target", () => {
    // Advanced modes are deliberate owner intent (§4). Moving one to `private`
    // would silently discard the password just as surely as moving it to `org`
    // would publish it — a bulk loop is the worst place to do either silently.
    for (const target of REPORT_SHARING_STATES) {
      expect(sharingCandidacy(ownedAt("password"), owner, target)).toEqual({
        kind: "skip",
        reason: "password-protected",
      });
      expect(sharingCandidacy(ownedAt("allowlist"), owner, target)).toEqual({
        kind: "skip",
        reason: "allowlisted",
      });
      expect(sharingCandidacy(ownedAt("public"), owner, target)).toEqual({
        kind: "skip",
        reason: "already public",
      });
    }
  });

  // ── THE SIX TRANSITIONS ────────────────────────────────────────────────
  //
  // Three states, both directions between each pair. The rule is "composed
  // state ≠ target", not "acl mode ≠ direction": collapsing `org_view` and
  // `org_edit` into one `org` direction made `org_edit → org_view` (an access
  // REDUCTION) skip every report as "already shared with your org" while
  // reporting success and revoking nothing.
  const TRANSITIONS = [
    ["private", "org_view"],
    ["private", "org_edit"],
    ["org_view", "private"],
    ["org_view", "org_edit"],
    ["org_edit", "private"],
    ["org_edit", "org_view"],
  ] as const;

  for (const [from, to] of TRANSITIONS) {
    it(`accepts ${from} → ${to}`, () => {
      expect(sharingCandidacy(STATE_FACTS[from], owner, to)).toEqual({ kind: "candidate" });
    });
  }

  it("skips a report already AT the target state rather than counting it as changed", () => {
    for (const state of REPORT_SHARING_STATES) {
      const r = sharingCandidacy(STATE_FACTS[state], owner, state);
      expect(r.kind).toBe("skip");
    }
  });

  it("names the state a skipped report is already in, distinguishing view from edit", () => {
    // "already shared with your org" said the same thing about `org_view` and
    // `org_edit`, so an operator reducing edit → view read a refusal as a
    // success. The reason must name which one it is.
    expect(sharingCandidacy(STATE_FACTS.private, owner, "private")).toEqual({
      kind: "skip",
      reason: "already private",
    });
    expect(sharingCandidacy(STATE_FACTS.org_view, owner, "org_view")).toEqual({
      kind: "skip",
      reason: "already shared with your org to view",
    });
    expect(sharingCandidacy(STATE_FACTS.org_edit, owner, "org_edit")).toEqual({
      kind: "skip",
      reason: "already shared with your org to view and edit",
    });
  });

  it("treats the API-only org-write-without-org-read combination as a candidate", () => {
    // `reportSharingState` returns null there, so it can never equal a target:
    // the report is in no expressible state, and applying one REPAIRS the pair
    // rather than trampling anything. It is not an advanced mode, so §4's
    // protection does not apply.
    for (const target of REPORT_SHARING_STATES) {
      expect(sharingCandidacy(ownedAt("private", true), owner, target)).toEqual({
        kind: "candidate",
      });
    }
  });
});
