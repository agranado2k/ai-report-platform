// Access token — the app↔view sharing capability (ADR-0056). A compact,
// HMAC-signed, slug-bound, exp-bounded token: the app mints it after authorizing
// a private report (by Acl mode); the credential-free view origin verifies the
// signature only (never holds Clerk creds). Pure computation given its inputs
// (like the base62 external-id codec) — `nowSeconds` is injected for testability.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface AccessClaims {
  readonly slug: string;
  readonly exp: number; // epoch seconds
  /** The `Acl` mode this token was minted under — the viewer rejects it if the report's
   *  mode has since changed (e.g. `allowlist`→`password`), so a stale long-lived cookie
   *  can't survive a mode switch (revocation-C, ADR-0056). */
  readonly mode?: string;
  /** Allowlist only — the address the link was redeemed for; the viewer checks a live
   *  `report_grants` row for it per request (revocation-C, ADR-0056). Absent otherwise. */
  readonly email?: string;
  /** Owner access (ADR-0056): minted by the app ONLY for the authenticated owner of the
   *  report. The viewer trusts the signed claim and serves regardless of share mode —
   *  the owner isn't subject to their own report's password/allowlist gate. */
  readonly owner?: boolean;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a slug-bound token valid for `ttlSeconds` from `nowSeconds`. `mode` binds it to the
 *  Acl mode it authorizes; `email` is carried for `allowlist` so the viewer can check a grant. */
export function mintAccessToken(
  slug: string,
  ttlSeconds: number,
  secret: string,
  nowSeconds: number,
  extra: { readonly mode?: string; readonly email?: string; readonly owner?: boolean } = {},
): string {
  const claims: AccessClaims = {
    slug,
    exp: nowSeconds + ttlSeconds,
    ...(extra.mode ? { mode: extra.mode } : {}),
    ...(extra.email ? { email: extra.email } : {}),
    ...(extra.owner ? { owner: true } : {}),
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
  if (claims.mode !== undefined && typeof claims.mode !== "string") return null;
  if (claims.email !== undefined && typeof claims.email !== "string") return null;
  if (claims.owner !== undefined && typeof claims.owner !== "boolean") return null;
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
