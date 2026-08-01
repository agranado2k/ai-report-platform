// Scope — the closed API-key scope vocabulary (ADR-0016). Previously scopes
// were untyped strings duplicated at every enforcement site (four local
// `ACL_WRITE_SCOPE` copies, a `WRITE_SCOPE`, ad-hoc lists in the actor
// resolvers) and NOTHING validated issuance — any arbitrary string persisted
// verbatim onto `api_keys.scopes`. This module is the ONE home: the `Scope`
// union, the full vocabulary, the key-issuable subset the settings picker
// offers, and the `makeScopes` smart constructor (Slug/EmailAddress pattern)
// that boundary code uses to decode untrusted scope selections.
import type { AppError } from "./errors";
import { validationError } from "./errors";
import { err, ok, type Result } from "./result";

/** The full ADR-0016 scope vocabulary. Closed by design — a new scope is an
 *  ADR-level decision, not a string literal at a call site. */
export type Scope = "reports:write" | "reports:read" | "folders:write" | "acl:write";

/** Upload / update / rename / move reports (ADR-0039). */
export const REPORTS_WRITE_SCOPE: Scope = "reports:write";
/** Manage sharing: set ACLs, grant/revoke/list write access (ADR-0056/0060). */
export const ACL_WRITE_SCOPE: Scope = "acl:write";

/** Every scope ADR-0016 defines. `reports:read` and `folders:write` are
 *  documented but enforced nowhere yet — no use case gates on them. */
export const API_KEY_SCOPES: readonly Scope[] = [
  "reports:write",
  "reports:read",
  "folders:write",
  "acl:write",
];

/** The subset an API key may be minted with — exactly the scopes that are
 *  actually enforced today. Offering the unenforced pair would sell a
 *  least-privilege promise the gates don't keep (a `reports:read`-only key
 *  could still mutate folders), so issuance stays narrower than the
 *  vocabulary until those gates are wired. */
export const KEY_ISSUABLE_SCOPES: readonly Scope[] = [REPORTS_WRITE_SCOPE, ACL_WRITE_SCOPE];

/** Validating smart constructor for an untrusted scope selection (e.g. the
 *  settings form, a raw API body): trims entries, dedupes (order-preserving),
 *  then requires a non-empty selection where every member is in `allowed`.
 *  Pass `KEY_ISSUABLE_SCOPES` when minting a key, `API_KEY_SCOPES` to accept
 *  the full vocabulary. */
export function makeScopes(
  input: readonly string[],
  allowed: readonly Scope[],
): Result<readonly Scope[], AppError> {
  const seen = new Set<string>();
  const out: Scope[] = [];
  for (const raw of input) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    if (!(allowed as readonly string[]).includes(s)) {
      return err(validationError(`unknown scope: ${s}`, "scopes"));
    }
    seen.add(s);
    out.push(s as Scope);
  }
  if (out.length === 0) return err(validationError("select at least one scope", "scopes"));
  return ok(out);
}
