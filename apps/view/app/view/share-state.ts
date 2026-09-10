// The share state the owner view's chrome shows, resolved from the report's
// `Acl` mode. Pure and display-only: this decides nothing about ACCESS — the
// gate does that, and this route never consults the Acl to authorize anything
// (ADR-0089 §3). It exists so the chrome can answer "who can see this?" at a
// glance, which is one of the questions the canonical URL has nowhere to put.
//
// Deliberately NOT the `Report sharing state` value object (ADR-0078): that
// one composes the Acl mode WITH an org write grant to answer a
// read-and-write question, which needs a second lookup this route does not
// make. This is the read half only, named for what it is.
import type { AclMode } from "arp-domain";

const LABELS: Record<AclMode, string> = {
  private: "Private",
  public: "Anyone with the link",
  password: "Password",
  org: "Your organization",
  allowlist: "Invited people",
};

/** Display copy for a report's share mode. Total over `AclMode`, so a new mode
 *  is a type error here rather than a blank pill in production. */
export function shareStateLabel(mode: AclMode): string {
  return LABELS[mode];
}
