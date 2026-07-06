// EmailAddress — a normalized (trim + lowercase) email address Value Object
// (ADR-0056). The ONE normalization home for the `Acl`'s `allowlist`
// (`allowedEmails`) and the `GrantStore`'s `(report, email)` key — previously
// implemented independently in three places (`acl.ts` `normalizeEmails`,
// `grant-store.ts` `normEmail`, and `resolve-access.ts` relying on both already
// agreeing), including a documented drift bug between the first two
// (claude-review #114). Follows the `Slug`/`ReportId` branded-type pattern:
// a bare normalizer for trusted call sites, a validating smart constructor for
// untrusted input.
import type { Brand } from "./brand";
import type { AppError } from "./errors";
import { validationError } from "./errors";
import { err, ok, type Result } from "./result";

export type EmailAddress = Brand<string, "EmailAddress">;

// Minimal structural check — non-empty local + domain with a dot. Light by design.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Trim + lowercase only — no format validation. Use for values that are
 *  already known-shaped (e.g. a stored grant's email being compared against an
 *  allowlist entry) so both sides normalize identically. */
export function normalizeEmailAddress(raw: string): EmailAddress {
  return raw.trim().toLowerCase() as EmailAddress;
}

/** Trim + lowercase + drop empties + dedupe (order-preserving). Does NOT
 *  validate format — callers that need format validation call
 *  `isValidEmailFormat` per entry (e.g. `Acl`'s allowlist, which reports the
 *  first invalid entry with its own field-specific error). */
export function normalizeEmailAddresses(emails: readonly string[]): readonly EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const raw of emails) {
    const e = normalizeEmailAddress(raw);
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/** True iff `value` has a plausible email shape (non-empty local + domain with a dot). */
export function isValidEmailFormat(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** Validating smart constructor: normalize, then require a plausible email shape.
 *  No production caller yet — forward-looking boundary-decode API; current
 *  callers normalize + format-check separately (`Acl` reports the first
 *  invalid allowlist entry with its own field error). */
export function makeEmailAddress(raw: string): Result<EmailAddress, AppError> {
  const normalized = normalizeEmailAddress(raw);
  return isValidEmailFormat(normalized)
    ? ok(normalized)
    : err(validationError(`invalid email: ${normalized}`, "email"));
}
