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

import { makeEmailAddress } from "./email-address";
import type { AppError } from "./errors";
import { ok, type Result } from "./result";
import type { OrgKind } from "./value-objects";

/** Public email providers → always a `personal` org (1:1, ADR-0048), never a
 *  `team` org. Extend this list to add a provider — no other change needed.
 *
 *  SECURITY (review #158 H-1): a MISSED provider here creates a shared "team
 *  org" that every stranger on that provider silently auto-joins — the same
 *  cross-tenant failure the exact-match rule prevents for lookalike domains.
 *  The list is therefore deliberately broad (major global + regional consumer
 *  providers and their country variants), and additions are one-line +
 *  zero-risk. NEVER remove an entry once any org exists for it (kind is frozen
 *  at first provision — reclassifying a domain splits users across orgs). */
export const PUBLIC_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Microsoft
  "outlook.com",
  "outlook.de",
  "outlook.fr",
  "outlook.es",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.es",
  "hotmail.it",
  "live.com",
  "live.co.uk",
  "live.fr",
  "live.de",
  "msn.com",
  // Yahoo
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.com.br",
  "yahoo.ca",
  "yahoo.co.in",
  "ymail.com",
  "rocketmail.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // Proton
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  // AOL / Verizon
  "aol.com",
  "verizon.net",
  // GMX / United Internet
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "mail.com",
  // Other majors / regionals
  "fastmail.com",
  "fastmail.fm",
  "zoho.com",
  "zohomail.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "inbox.ru",
  "bk.ru",
  "list.ru",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "tutanota.com",
  "tutamail.com",
  "tuta.io",
  "hey.com",
  "duck.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "btinternet.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "t-online.de",
  "freenet.de",
  "libero.it",
  "virgilio.it",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "rediffmail.com",
  "seznam.cz",
  "wp.pl",
  "o2.pl",
  "onet.pl",
  "interia.pl",
  "abv.bg",
  "ukr.net",
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
  // Strip a trailing dot from the FQDN form ("domain.com." ≡ "domain.com") so
  // the two spellings can't split one company across two orgs (review #158 L-2).
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1).replace(/\.$/, "");
  return ok(
    PUBLIC_PROVIDER_DOMAINS.has(domain)
      ? { kind: "personal", key: normalized }
      : { kind: "team", key: domain },
  );
}
