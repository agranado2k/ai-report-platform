// Magic-link token — the `allowlist` email link (ADR-0056). The link carries only an
// HMAC-signed **nonce id**; the real payload (`{slug,email}`) + the 15-min expiry live
// in the NonceStore (Redis), keyed by that id. The HMAC lets the app reject a forged/
// tampered link before touching the store; single-use is enforced by the store's GETDEL.
// Pure computation (like the access-token codec); the app mints + verifies (same trust
// domain), reusing the app↔view secret.
import { createHmac, timingSafeEqual } from "node:crypto";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a signed magic-link token carrying the nonce id. */
export function mintMagicLinkToken(nonceId: string, secret: string): string {
  const payload = Buffer.from(nonceId, "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify the signature and return the nonce id, or null if forged/tampered/malformed.
 *  (Expiry + single-use are enforced by the NonceStore, not here.) */
export function verifyMagicLinkToken(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
