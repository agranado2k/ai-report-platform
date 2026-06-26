// Acl — per-Report sharing configuration (ADR-0056). An aggregate member of
// `Report` (ADR-0036); one `Acl` per report, defaulting to `public`. A pure value
// object: no I/O. The argon2id password hash is supplied by the setAcl use case
// (hashing is an adapter concern); the wire mapper never serializes it (ADR-0053 §12).
import { type AppError, validationError } from "./errors";
import { err, ok, type Result } from "./result";
import type { AclMode } from "./value-objects";

/** Owner-set access duration for `allowlist` mode (ADR-0056): how long a verified
 *  viewer stays unlocked after redeeming a magic link. Bounds + default; the UI
 *  offers presets within this range. */
export const DEFAULT_ACCESS_TTL_SECONDS = 604_800; // 7 days
export const MIN_ACCESS_TTL_SECONDS = 60; // 1 minute
export const MAX_ACCESS_TTL_SECONDS = 7_776_000; // 90 days

/** The four sharing modes as a discriminated union (carries only mode-relevant data). */
export type Acl =
  | { readonly mode: "public" }
  | { readonly mode: "org" }
  | { readonly mode: "password"; readonly passwordHash: string }
  | {
      readonly mode: "allowlist";
      readonly allowedEmails: readonly string[];
      /** Owner-configured access TTL (seconds) for redeemed magic-link grants. */
      readonly accessTtlSeconds: number;
    };

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
  /** Access TTL (seconds) for `allowlist` mode; defaults to 7 days when omitted. */
  readonly accessTtlSeconds?: number;
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
      const accessTtlSeconds = input.accessTtlSeconds ?? DEFAULT_ACCESS_TTL_SECONDS;
      if (
        !Number.isInteger(accessTtlSeconds) ||
        accessTtlSeconds < MIN_ACCESS_TTL_SECONDS ||
        accessTtlSeconds > MAX_ACCESS_TTL_SECONDS
      ) {
        return err(
          validationError(
            `access_ttl_seconds must be an integer between ${MIN_ACCESS_TTL_SECONDS} and ${MAX_ACCESS_TTL_SECONDS}`,
            "access_ttl_seconds",
          ),
        );
      }
      return ok({ mode: "allowlist", allowedEmails: emails, accessTtlSeconds });
    }
    default:
      return err(validationError(`unknown acl mode: ${String(input.mode)}`, "mode"));
  }
}
