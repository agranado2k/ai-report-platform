// Magic-link token — the `allowlist` email link (ADR-0056). The link carries only an
// HMAC-signed **nonce id**; the real payload (`{slug,email}`) + the 15-min expiry live
// in the NonceStore (Redis), keyed by that id. The HMAC lets the app reject a forged/
// tampered link before touching the store; single-use is enforced by the store's GETDEL.
// Built on the shared signed-token codec (signed-token.ts) — the nonce id is the raw
// (non-JSON) payload, so this module is a thin, claims-free wrapper. The app mints +
// verifies (same trust domain), reusing the app↔view secret.
import { mintSignedToken, readSignedTokenPayload } from "./signed-token";

/** Mint a signed magic-link token carrying the nonce id. */
export function mintMagicLinkToken(nonceId: string, secret: string): string {
  return mintSignedToken(nonceId, secret);
}

/** Verify the signature and return the nonce id, or null if forged/tampered/malformed.
 *  (Expiry + single-use are enforced by the NonceStore, not here.) */
export function verifyMagicLinkToken(token: string, secret: string): string | null {
  return readSignedTokenPayload(token, secret);
}
