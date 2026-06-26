// resolveAccessDecision — the viewer's access gate for a private report (ADR-0056).
// A public report always serves; a private one (password/org/allowlist) serves only with
// a valid slug-bound access token (the `?access` hand-off from the app → grant: set the
// unlock cookie; or an already-set unlock cookie → serve). No valid token → unlock. The
// app is where mode-specific auth happens; the viewer never holds Clerk creds.
//
// For `allowlist` (revocation-C): a valid token is necessary but NOT sufficient — the
// token carries the redeemed email and the viewer checks a LIVE `report_grants` row for it
// on EVERY request, so removing the email (or switching mode) denies on the next request,
// even though the long-lived token/cookie hasn't expired. This is the whole point of C.

import type { AppError, Result } from "arp-domain";
import { type Acl, isPrivateAcl, ok, type ReportId, readAccessToken } from "arp-domain";
import type { GrantStore } from "../ports";

export type AccessDecision =
  | { readonly kind: "serve" }
  | { readonly kind: "grant"; readonly token: string; readonly maxAgeSeconds: number }
  | { readonly kind: "unlock" };

export async function resolveAccessDecision(
  acl: Acl,
  reportId: ReportId,
  tokens: { readonly cookie?: string; readonly query?: string },
  slug: string,
  secret: string,
  nowSeconds: number,
  grants: GrantStore,
): Promise<Result<AccessDecision, AppError>> {
  if (!isPrivateAcl(acl)) return ok({ kind: "serve" });
  // Fail closed when the secret is unset (previews/dev): Node's HMAC accepts an empty key,
  // so without this an attacker could forge `payload.HMAC("",payload)` (claude-review #100).
  if (!secret) return ok({ kind: "unlock" });

  // Prefer the one-time `?access` hand-off (→ grant); fall back to the unlock cookie (→ serve).
  const fromQuery = tokens.query ? readAccessToken(tokens.query, slug, secret, nowSeconds) : null;
  const claims =
    fromQuery ?? (tokens.cookie ? readAccessToken(tokens.cookie, slug, secret, nowSeconds) : null);
  if (!claims) return ok({ kind: "unlock" });

  // Revocation-C, defense-in-depth: serve only if the email is BOTH currently allowlisted
  // AND holds a live grant. The allowlist check (the live source of truth, already loaded
  // with the report) makes removal revoke on the very next request — independent of setAcl
  // pruning the grant (5e). The grant proves redemption (allowlisted ≠ redeemed) + bounds
  // expiry. Either failing → unlock.
  if (acl.mode === "allowlist") {
    if (!claims.email || !acl.allowedEmails.includes(claims.email)) return ok({ kind: "unlock" });
    const live = await grants.isGranted(reportId, claims.email);
    if (!live.ok) return live;
    if (!live.value) return ok({ kind: "unlock" });
  }

  if (fromQuery && tokens.query) {
    // The cookie lives as long as the token (= the grant's TTL for allowlist), so a
    // long-lived grant isn't re-prompted every 15 min — revocation stays immediate via
    // the per-request grant check above, not via a short cookie.
    return ok({
      kind: "grant",
      token: tokens.query,
      maxAgeSeconds: Math.max(0, claims.exp - nowSeconds),
    });
  }
  return ok({ kind: "serve" });
}
