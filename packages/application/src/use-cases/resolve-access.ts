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
import {
  type Acl,
  isPrivateAcl,
  ok,
  type ReportId,
  readAccessToken,
  readGranteeReadToken,
} from "arp-domain";
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

  // The Grantee read token (ADR-0091) — checked FIRST, and in its own branch, so
  // the Access-token chain below is untouched by it.
  //
  // WHO CARRIES ONE: a write-grantee, i.e. a `canWrite` NON-owner (ADR-0060).
  // They are deliberately never minted an `owner: true` Access token — that
  // claim for a non-owner is the ADR-0063 review-#146 privilege escalation — so
  // without this they got ADR-0089's first-party chrome wrapped around the
  // unlock wall, because the framed `GET /<slug>` is gated on its own merits.
  //
  // WHY IT IGNORES THE MODE: mode-independence is the capability, not a
  // shortcut (ADR-0091 §6). A share mode gates readers the owner did not
  // choose; a write-grantee is a collaborator the owner chose explicitly, and
  // can already read — and overwrite — every byte through the editor. Requiring
  // them to clear the reader gate protects nothing and would make the owner
  // view the one surface where `canWrite` does not imply read. So there is no
  // `claims.mode !== acl.mode` check here and no allowlist grant probe: both
  // belong to the Access token's revocation-C machinery, and this is not one.
  //
  // WHAT BOUNDS IT: `exp` alone, at 15 minutes (the Edit token's own TTL, NOT
  // the owner token's 24h — ownership cannot be revoked, a write grant can).
  // The grantee's whole session lapses together and repairs through `/open`,
  // the app's one mint, which re-runs the LIVE `canWrite` check. A live grant
  // check HERE was considered and rejected (ADR-0091 §5): it would make the
  // credential-free viewer origin authorize rather than verify, put the
  // user-email identity mirror on the untrusted-content origin, and bill the
  // platform's hottest route.
  //
  // It cannot be confused with an owner token in either direction: these claims
  // have no `owner` field at all, and `parseAccessClaims` rejects any payload
  // carrying a `scope` (ADR-0091 §1).
  const granteeFromQuery = tokens.query
    ? readGranteeReadToken(tokens.query, slug, secret, nowSeconds)
    : null;
  const granteeClaims =
    granteeFromQuery ??
    (tokens.cookie ? readGranteeReadToken(tokens.cookie, slug, secret, nowSeconds) : null);
  if (granteeClaims) {
    // A query-borne token is redeemed into the unlock cookie and bounced, so it
    // leaves the address bar / history / referer — the same one-time hand-off
    // shape every other token on this path gets. A cookie-borne one is already
    // where it belongs and simply serves.
    return granteeFromQuery && tokens.query
      ? ok({
          kind: "grant",
          token: tokens.query,
          maxAgeSeconds: Math.max(0, granteeClaims.exp - nowSeconds),
        })
      : ok({ kind: "serve" });
  }

  // Prefer the one-time `?access` hand-off (→ grant); fall back to the unlock cookie (→ serve).
  const fromQuery = tokens.query ? readAccessToken(tokens.query, slug, secret, nowSeconds) : null;
  const claims =
    fromQuery ?? (tokens.cookie ? readAccessToken(tokens.cookie, slug, secret, nowSeconds) : null);
  if (!claims) return ok({ kind: "unlock" });

  // Owner access (ADR-0056): an `owner` token is minted by the app ONLY for the
  // authenticated owner of the report, so it bypasses the mode-bound + allowlist/grant
  // gates below — the owner is not subject to their own report's share gate. It is still
  // signature-checked + slug-bound + exp-bounded (readAccessToken, above) and fails closed
  // on an unset secret. A `?access` hand-off still becomes `grant` (sets the unlock cookie).
  if (claims.owner === true) {
    return fromQuery && tokens.query
      ? ok({
          kind: "grant",
          token: tokens.query,
          maxAgeSeconds: Math.max(0, claims.exp - nowSeconds),
        })
      : ok({ kind: "serve" });
  }

  // Bind the token to the Acl mode it was minted under: a stale long-lived cookie (an
  // allowlist token lives as long as its grant, up to 90d) must NOT survive the owner
  // switching modes — e.g. allowlist→password would otherwise serve for months on the old
  // cookie since the membership/grant checks below only run for allowlist (claude-review #117).
  if (claims.mode !== acl.mode) return ok({ kind: "unlock" });

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
