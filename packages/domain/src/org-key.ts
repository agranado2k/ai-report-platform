// OrgKey — the domain-keyed single-org membership rule (ADR-0068 §1). A user
// belongs to exactly ONE Org, derived deterministically from their email: a
// public-provider address (gmail.com, outlook.com, …) resolves to a `personal`
// org keyed by the full normalized address (today's ADR-0048 behavior,
// unchanged); any other domain resolves to that domain's `team` org, keyed by
// the domain itself (multi-member by design — every same-domain sign-up joins
// the same org). Pure Value Object; no I/O.
//
// Matching rule (deliberately simple + exact, not suffix/eTLD+1-aware): the
// domain is everything after the LAST '@', lowercased. It is looked up as an
// EXACT match against `PUBLIC_PROVIDER_DOMAINS` — no substring or suffix
// matching, so "notgmail.com" and "gmail.com.evil.com" are both `team` domains,
// and an unlisted subdomain of a public provider (e.g. "mail.yahoo.co.jp") is
// its own team org rather than being folded into "yahoo.com". A two-level-TLD
// corporate domain (e.g. "acme.co.uk") is keyed by the FULL domain string, not
// an eTLD+1 guess — this matches the Clerk org identifier 1:1 with the email
// domain and keeps the rule a one-line addition per new provider.
import type { AppError } from "./errors";
import { makeEmailAddress } from "./email-address";
import { ok, type Result } from "./result";
import type { OrgKind } from "./value-objects";

/** Public email providers → always a `personal` org (1:1, ADR-0048), never a
 *  `team` org. Extend this list to add a provider — no other change needed. */
export const PUBLIC_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
]);

export interface OrgKeyResolution {
  readonly kind: OrgKind;
  /** `personal` → the full normalized email address (unique per user).
   *  `team` → the lowercased email domain (shared by every user at that domain). */
  readonly key: string;
}

/** Derive the org key for an email address (ADR-0068 §1). Validates the email
 *  shape via `makeEmailAddress` (trims + lowercases + requires a plausible
 *  `local@domain.tld` shape) before splitting the domain. */
export function resolveOrgKey(email: string): Result<OrgKeyResolution, AppError> {
  const made = makeEmailAddress(email);
  if (!made.ok) return made;
  const normalized = made.value;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return ok(
    PUBLIC_PROVIDER_DOMAINS.has(domain)
      ? { kind: "personal", key: normalized }
      : { kind: "team", key: domain },
  );
}
