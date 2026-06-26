// Access token — the app↔view sharing capability (ADR-0056). A compact,
// HMAC-signed, slug-bound, exp-bounded token: the app mints it after authorizing
// a private report (by Acl mode); the credential-free view origin verifies the
// signature only (never holds Clerk creds). Pure computation given its inputs
// (like the base62 external-id codec) — `nowSeconds` is injected for testability.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface AccessClaims {
  readonly slug: string;
  readonly exp: number; // epoch seconds
  /** Allowlist only — the address the link was redeemed for; the viewer checks a live
   *  `report_grants` row for it per request (revocation-C, ADR-0056). Absent otherwise. */
  readonly email?: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a slug-bound token valid for `ttlSeconds` from `nowSeconds`. `email` is carried
 *  for `allowlist` reports so the viewer can check a live grant; omit for other modes. */
export function mintAccessToken(
  slug: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number,
  email?: string,
): string {
  const claims: AccessClaims = {
    slug,
    exp: nowSeconds + ttlSeconds,
    ...(email ? { email } : {}),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify + return the claims (incl. `email`), or null if the signature is invalid, it
 *  has expired, or it was minted for a different slug. Constant-time compare; never throws. */
export function readAccessToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): AccessClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
  } catch {
    return null;
  }
  if (typeof claims?.slug !== "string" || typeof claims?.exp !== "number") return null;
  if (claims.email !== undefined && typeof claims.email !== "string") return null;
  if (claims.exp <= nowSeconds) return null;
  return claims.slug === expectedSlug ? claims : null;
}

/** True iff the token's signature is valid, it hasn't expired, and it was minted
 *  for `expectedSlug`. Thin boolean wrapper over `readAccessToken`. */
export function verifyAccessToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): boolean {
  return readAccessToken(token, expectedSlug, secret, nowSeconds) !== null;
}
