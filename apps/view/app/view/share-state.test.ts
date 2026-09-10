// The share-state label is the one thing the owner view claims about ACCESS,
// and it claims it in prose to the person who can act on it (ADR-0089 §1).
//
// The failure mode this file exists to catch is not a crash: it is a MAPPING
// that still type-checks. Swap `private` and `public` in the table and every
// other test in the repo stays green while the chrome tells an owner their
// private report is readable by anyone with the link — an owner who then shares
// the link, or declines to lock down a report that was never locked down. The
// label is display-only (the gate decides access, and this route never consults
// the Acl to authorize anything), which is exactly why nothing downstream would
// notice the lie.
//
// So every mode is spelled out individually rather than looped over the table:
// a test that derived its expectations from `LABELS` would agree with any
// mapping, including a swapped one.
import { ACL_MODES } from "arp-domain";
import { describe, expect, it } from "vitest";
import { shareStateLabel } from "./share-state";

describe("shareStateLabel — what the owner is told about who can see this", () => {
  it("says Private for a report only its owner can open", () => {
    expect(shareStateLabel("private")).toBe("Private");
  });

  it("says 'Anyone with the link' for public — the mode with real blast radius", () => {
    // The pair `private`/`public` is the one worth naming: they are adjacent in
    // the table, opposite in consequence, and a transposition between them is
    // the mistake that costs an owner a leak rather than a confusing word.
    expect(shareStateLabel("public")).toBe("Anyone with the link");
  });

  it("says Password for a passphrase-gated report", () => {
    expect(shareStateLabel("password")).toBe("Password");
  });

  it("says 'Your organization' for an org-scoped report", () => {
    expect(shareStateLabel("org")).toBe("Your organization");
  });

  it("says 'Invited people' for an allowlisted report", () => {
    expect(shareStateLabel("allowlist")).toBe("Invited people");
  });

  it("is TOTAL over AclMode, and every label is distinct", () => {
    // Totality is a type-level property of the `Record<AclMode, string>`, but
    // only if the enumeration this iterates is the domain's own. Driving it
    // from `ACL_MODES` means a sixth mode added in `packages/domain` fails HERE
    // — the pill going blank in production is the alternative.
    const labels = ACL_MODES.map(shareStateLabel);
    for (const label of labels) expect(label).not.toBe("");
    // Distinct, because two modes sharing one label is the same lie as a
    // swapped one: the owner cannot tell which report they are looking at.
    expect(new Set(labels).size).toBe(ACL_MODES.length);
  });
});
