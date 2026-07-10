// Auth seam for GET /<slug>/edit (ADR-0063 Decisions 3-4, implementation).
// Pure decision logic factored out of the route so it's unit-testable without
// a Request/Response — mirrors resolveAccessDecision's role for the public
// unlock flow (packages/application/src/use-cases/resolve-access.ts) and
// $slug.tsx's readUnlockCookie/unlockCookie pair, adapted for the edit token
// (arp-domain's readEditToken/EditClaims) instead of the Access token.
//
// The `arp_edit` cookie is DELIBERATELY narrower-scoped than the unlock
// cookie: Path=/${slug}/edit (not /${slug}) — an edit capability must never
// ride along on the public GET /<slug> read request, even for the same
// report. HttpOnly + Secure + SameSite=Lax, same posture as the unlock
// cookie (never readable by report-embedded JS, never sent cross-site).
import { type EditClaims, readEditToken } from "arp-domain";

export const EDIT_COOKIE_NAME = "arp_edit";

/** Parse the `arp_edit` value out of a raw `Cookie` request header. */
export function readEditCookieValue(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === EDIT_COOKIE_NAME) return rest.join("=") || undefined;
  }
  return undefined;
}

/** Build the `Set-Cookie` header value for the `arp_edit` cookie. `maxAgeSeconds`
 *  should be the token's remaining life (`claims.exp - nowSeconds`) so the cookie
 *  never outlives the capability it carries — there is no independent expiry. */
export function buildEditCookie(slug: string, token: string, maxAgeSeconds: number): string {
  return `${EDIT_COOKIE_NAME}=${token}; Path=/${slug}/edit; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export interface EditAccessInput {
  /** The `?et=` query-string token, if present (the fresh app-minted hand-off). */
  readonly queryToken: string | undefined;
  /** The `arp_edit` cookie's value, if present (a prior hand-off already redeemed). */
  readonly cookieToken: string | undefined;
  readonly slug: string;
  /** `viewerAccessConfig().secret` — undefined in previews/dev without the env wired. */
  readonly secret: string | undefined;
  readonly nowSeconds: number;
}

export type EditAccessDecision =
  // No usable token (missing, malformed, forged, expired, wrong-slug, or no
  // secret configured) → the route falls back to the public, read-only viewer.
  | { readonly kind: "denied" }
  // A valid `?et=` hand-off → mint the cookie and 303 to the clean URL,
  // dropping the token out of the address bar/history/referer (mirrors the
  // unlock flow's `grant` outcome in resolve-access.ts).
  | { readonly kind: "set-cookie"; readonly token: string; readonly maxAgeSeconds: number }
  // A valid `arp_edit` cookie, already redeemed → render the editor.
  | { readonly kind: "render"; readonly claims: EditClaims; readonly token: string };

/**
 * Decide what GET /<slug>/edit should do, given the two possible token
 * sources. The query token takes precedence when both are present — a fresh
 * mint always wins over whatever cookie is already sitting there (same
 * precedence resolveAccessDecision uses for the unlock cookie). Fails closed
 * (denied) when `secret` is unset: an HMAC accepts an empty key, so without
 * this an unset secret would let a forged `payload.HMAC("",payload)` token
 * through (same posture as resolveAccessDecision's own fail-closed check).
 */
export function resolveEditAccess(input: EditAccessInput): EditAccessDecision {
  if (!input.secret) return { kind: "denied" };

  if (input.queryToken) {
    const claims = readEditToken(input.queryToken, input.slug, input.secret, input.nowSeconds);
    if (!claims) return { kind: "denied" };
    return {
      kind: "set-cookie",
      token: input.queryToken,
      maxAgeSeconds: Math.max(0, claims.exp - input.nowSeconds),
    };
  }

  if (input.cookieToken) {
    const claims = readEditToken(input.cookieToken, input.slug, input.secret, input.nowSeconds);
    if (!claims) return { kind: "denied" };
    return { kind: "render", claims, token: input.cookieToken };
  }

  return { kind: "denied" };
}
