// Access token — the app↔view sharing capability (ADR-0056). A compact,
// HMAC-signed, slug-bound, exp-bounded token: the app mints it after authorizing
// a private report (by Acl mode); the credential-free view origin verifies the
// signature only (never holds Clerk creds). Pure computation given its inputs
// (like the base62 external-id codec) — `nowSeconds` is injected for testability.
import { createHmac, timingSafeEqual } from "node:crypto";

interface AccessClaims {
  readonly slug: string;
  readonly exp: number; // epoch seconds
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a slug-bound token valid for `ttlSeconds` from `nowSeconds`. */
export function mintAccessToken(
  slug: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number,
): string {
  const claims: AccessClaims = { slug, exp: nowSeconds + ttlSeconds };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** True iff the token's signature is valid, it hasn't expired, and it was minted
 *  for `expectedSlug`. Constant-time signature compare; never throws. */
export function verifyAccessToken(
  token: string,
  expectedSlug: string,
  secret: string,
  nowSeconds: number,
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
  } catch {
    return false;
  }
  if (typeof claims?.slug !== "string" || typeof claims?.exp !== "number") return false;
  if (claims.exp <= nowSeconds) return false;
  return claims.slug === expectedSlug;
}
