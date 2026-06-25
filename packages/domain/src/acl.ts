// Acl — per-Report sharing configuration (ADR-0056). An aggregate member of
// `Report` (ADR-0036); one `Acl` per report, defaulting to `public`. A pure value
// object: no I/O. The argon2id password hash is supplied by the setAcl use case
// (hashing is an adapter concern); the wire mapper never serializes it (ADR-0053 §12).
import { type AppError, validationError } from "./errors";
import { err, ok, type Result } from "./result";
import type { AclMode } from "./value-objects";

/** The four sharing modes as a discriminated union (carries only mode-relevant data). */
export type Acl =
  | { readonly mode: "public" }
  | { readonly mode: "org" }
  | { readonly mode: "password"; readonly passwordHash: string }
  | { readonly mode: "allowlist"; readonly allowedEmails: readonly string[] };

/** The default: a report with no `acls` row is public (ADR-0056). */
export const PUBLIC_ACL: Acl = { mode: "public" };

/** Private modes require the app to authorize before the viewer serves (ADR-0056). */
export function isPrivateAcl(acl: Acl): boolean {
  return acl.mode !== "public";
}

/** Minimal email check — non-empty local + domain with a dot. Light by design. */
function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** Trim + lowercase + drop empties + dedupe (order-preserving). */
function normalizeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (e && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

export interface MakeAclInput {
  readonly mode: AclMode;
  /** Pre-hashed (argon2id) password — required for `password` mode. */
  readonly passwordHash?: string;
  /** Allowed emails — required (≥1) for `allowlist` mode. */
  readonly allowedEmails?: readonly string[];
}

/** Validate + construct an `Acl` from already-resolved inputs (the use case hashes
 *  the plaintext password before calling this). Pure. */
export function makeAcl(input: MakeAclInput): Result<Acl, AppError> {
  switch (input.mode) {
    case "public":
      return ok({ mode: "public" });
    case "org":
      return ok({ mode: "org" });
    case "password":
      if (!input.passwordHash?.trim()) {
        return err(validationError("password mode requires a password", "password"));
      }
      return ok({ mode: "password", passwordHash: input.passwordHash });
    case "allowlist": {
      const emails = normalizeEmails(input.allowedEmails ?? []);
      if (emails.length === 0) {
        return err(validationError("allowlist requires at least one email", "allowed_emails"));
      }
      const bad = emails.find((e) => !isEmail(e));
      if (bad) {
        return err(validationError(`invalid email: ${bad}`, "allowed_emails"));
      }
      return ok({ mode: "allowlist", allowedEmails: emails });
    }
    default:
      return err(validationError(`unknown acl mode: ${String(input.mode)}`, "mode"));
  }
}
